import { loadConfig } from '$lib/config';
import { workingContext } from '$lib/models.js';
import { executeTool, toolSchemas } from '$lib/tools';
import type { ContentBlock, EndpointConfig, Message, ReasoningLevel, ToolCall } from '$lib/types';

// What the chat route hands runAgent for each conversation attachment.
export interface AttachmentInput {
	id: string; // matches Message.attachmentIds
	name: string;
	text?: string; // extracted text (docs)
	dataUri?: string; // images, data:<mime>;base64,…
	isImage: boolean;
}

const MAX_TOOL_ROUNDS = 5;

export type Emit = (event: string, data: unknown) => void;

export interface ToolCallDelta {
	index?: number;
	id?: string;
	function?: { name?: string; arguments?: string };
}

// Reassembles fragmented tool-call deltas from a streamed response. Pure, so it's unit-testable.
export function accumulateToolCalls(acc: Map<number, ToolCall>, deltas: ToolCallDelta[] | undefined) {
	if (!deltas) return;
	for (const d of deltas) {
		const i = d.index ?? 0;
		const cur = acc.get(i) ?? { id: '', name: '', arguments: '' };
		if (d.id) cur.id = d.id;
		if (d.function?.name) cur.name += d.function.name;
		if (d.function?.arguments) cur.arguments += d.function.arguments;
		acc.set(i, cur);
	}
}

// Pure: only the requested tools reach the wire (web toggle); undefined/absent = all.
export function filterTools(names: string[]) {
	return toolSchemas.filter((s) => names.includes(s.function.name));
}

// Autodetect thinking: OpenAI `reasoning` or llama.cpp `reasoning_content`. Pure.
export function extractReasoning(d?: { reasoning?: unknown; reasoning_content?: unknown }): string {
	if (!d) return '';
	const r = d.reasoning ?? d.reasoning_content;
	return typeof r === 'string' ? r : '';
}

const REASONING_RANK: Record<ReasoningLevel, number> = { off: 0, low: 1, medium: 2, high: 3, xhigh: 4 };

// Clamp the requested effort to the model's probed accepted set so a template
// that rejects e.g. 'high' never 400s mid-turn. Closest supported level below
// the request wins; with nothing below (e.g. requested 'low', only 'medium'
// accepted) the smallest upgrade goes — degrading further is impossible.
// Unprobed models (no set) pass through. Pure.
export function clampReasoning(requested?: ReasoningLevel, supported?: ReasoningLevel[]): ReasoningLevel | undefined {
	if (!requested || requested === 'off') return requested; // 'off' is a client choice, never sent upstream
	if (!supported?.length) return supported ? 'off' : requested; // [] = probed, none accepted
	if (supported.includes(requested)) return requested;
	const r = REASONING_RANK[requested];
	const below = supported.filter((l) => REASONING_RANK[l] < r).sort((a, b) => REASONING_RANK[b] - REASONING_RANK[a]);
	if (below.length) return below[0];
	return [...supported].sort((a, b) => REASONING_RANK[a] - REASONING_RANK[b])[0];
}

interface StreamDelta {
	content?: string | null;
	tool_calls?: ToolCallDelta[];
	reasoning?: unknown;
	reasoning_content?: unknown;
}

// Internal ToolCalls are flat {id, name, arguments}; OpenAI-compatible servers
// want {id, type: 'function', function: {name, arguments}}. Normalize at the
// wire so multi-round loops and persisted history (old shape) both work.
interface WireToolCall {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
}

type WireMessage = Omit<Message, 'tool_calls'> & { tool_calls?: WireToolCall[] };

export function toWire(messages: Message[]): WireMessage[] {
	return messages.map((m): WireMessage => {
		const { reasoning, reasoningLevel, stats, attachmentIds, ...rest } = m; // display-only, stays off the wire
		if (m.tool_calls) {
			return {
				...rest,
				tool_calls: m.tool_calls.map((tc) => ({
					id: tc.id,
					type: 'function' as const,
					function: { name: tc.name, arguments: tc.arguments }
				}))
			};
		}
		return rest as WireMessage;
	});
}

// ponytail: chars÷4 + fixed overhead for the system prompt and tool schemas;
// swap in a real tokenizer if 400s persist.
export function estimateTokens(msgs: Message[]): number {
	let chars = 0;
	for (const m of msgs) {
		// ponytail: data-URI chars÷4 — overcounts real image-token cost, safe direction
		chars += typeof m.content === 'string' ? m.content.length : m.content.reduce((s, b) => s + (b.type === 'text' ? b.text.length : b.image_url.url.length), 0);
		for (const tc of m.tool_calls ?? []) chars += tc.name.length + tc.arguments.length;
	}
	return Math.ceil(chars / 4) + 1500;
}

// Join attachment text into one stuffed block; on overflow, cut at the last doc
// boundary before the cap so whole docs stay intact. Pure, so it's unit-testable.
export function stuffAttachments(
	docs: { name: string; text: string }[],
	budgetChars: number
): { text: string; truncated: boolean; omitted: number } {
	const full = docs.map((d) => `=== ${d.name} ===\n${d.text}`).join('\n\n');
	if (full.length <= budgetChars) return { text: full, truncated: false, omitted: 0 };
	const out = full.slice(0, budgetChars);
	const cut = out.lastIndexOf('\n\n=== ');
	const kept = cut > 0 ? out.slice(0, cut) : out;
	const omitted = full.length - kept.length;
	return {
		text: `${kept}\n[truncated — ${omitted} characters of attached documents omitted to fit the context window]`,
		truncated: true,
		omitted
	};
}

// Drop the oldest whole turns (a user message plus the assistant/tool messages that
// answered it) until the estimate fits the budget. Never drops the newest user
// message, so tool-call/result pairs stay intact. Pure, so it's unit-testable.
export function trimHistory(
	msgs: Message[],
	budget: number
): { messages: Message[]; trimmed: number } {
	const out = msgs.slice();
	let trimmed = 0;
	for (;;) {
		if (estimateTokens(out) <= budget) break;
		const starts = out.map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i >= 0);
		if (starts.length < 2) break; // only the newest user message remains
		const from = starts[0];
		const to = starts[1];
		out.splice(from, to - from);
		trimmed += to - from;
	}
	return { messages: out, trimmed };
}

async function streamUpstream(
	endpoint: EndpointConfig,
	body: unknown,
	emit: Emit,
	reasoningLevel?: ReasoningLevel,
	signal?: AbortSignal
): Promise<{
	content: string;
	toolCalls: ToolCall[];
	reasoning: string;
	promptTokens: number;
	completionTokens: number;
}> {
	const url = `${endpoint.baseUrl.replace(/\/+$/, '')}/chat/completions`;
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : {})
		},
		body: JSON.stringify(body),
		signal
	});

	if (!res.ok || !res.body) {
		const detail = (await res.text().catch(() => '')).slice(0, 300);
		throw new Error(
			`Model server returned HTTP ${res.status} from ${url}${detail ? `: ${detail}` : ' — is it running?'}`
		);
	}

	let content = '';
	let reasoning = '';
	let promptTokens = 0;
	let completionTokens = 0;
	const calls = new Map<number, ToolCall>();
	let buffer = '';
	const decoder = new TextDecoder();
	const reader = res.body.getReader();

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed.startsWith('data:')) continue;
				const payload = trimmed.slice(5).trim();
				if (payload === '[DONE]') continue;
				let json: {
					choices?: { delta?: StreamDelta; message?: StreamDelta }[];
					usage?: { prompt_tokens?: number; completion_tokens?: number };
				};
				try {
					json = JSON.parse(payload);
				} catch {
					continue; // partial frame; the rest arrives in the next chunk
				}
				const delta = json.choices?.[0]?.delta;
				if (delta?.content) {
					content += delta.content;
					emit('token', { content: delta.content });
				}
				if (delta?.tool_calls) accumulateToolCalls(calls, delta.tool_calls);
				// llama.cpp emits a trailing frame with usage (stream_options.include_usage).
				if (json.usage) {
					promptTokens += json.usage.prompt_tokens ?? 0;
					completionTokens += json.usage.completion_tokens ?? 0;
				}
				// Thinking can arrive in the delta or in a non-delta message frame.
				// 'off' suppresses it: servers may think anyway, the display contract is off ⇒ none.
				const r =
					reasoningLevel === 'off'
						? ''
						: extractReasoning(delta) || extractReasoning(json.choices?.[0]?.message);
				if (r) {
					reasoning += r;
					emit('reasoning', { content: r });
				}
			}
		}
	} catch (e) {
		// User stop: keep what streamed so far instead of failing the turn.
		if (!signal?.aborted) throw e;
	}

	return {
		content,
		reasoning,
		promptTokens,
		completionTokens,
		toolCalls: [...calls.values()].filter((tc) => tc.id && tc.name)
	};
}

export async function runAgent(opts: {
	model: string;
	messages: Message[]; // full history including the new user message
	tools?: string[]; // tool names to enable; undefined = all
	reasoning?: ReasoningLevel;
	attachments?: AttachmentInput[]; // conversation attachments to stuff in
	signal?: AbortSignal; // user stop: resolve with the partial turn instead of throwing
	emit: Emit;
}): Promise<Message[]> {
	const endpoint = loadConfig();
	if (!endpoint.baseUrl) throw new Error('Model server not configured — set the base URL in Settings');
	const messages: Message[] = [...opts.messages];
	const appended: Message[] = [];
	// No detected/configured ceiling → Infinity: don't trim against an assumed window.
	const working = workingContext(endpoint, opts.model) ?? Infinity;

	// Context stuffing: docs get 40% of the working window, history keeps ≥60% before
	// trimming. The stuffed system message is wire-only (like the tool nudge below) —
	// re-injected every round, never persisted. As a leading system message it survives
	// trimHistory, which only splices between user turns.
	if (opts.attachments?.length) {
		const docs = opts.attachments.filter((a) => !a.isImage && a.text).map((a) => ({ name: a.name, text: a.text! }));
		if (docs.length) {
			const stuffed = stuffAttachments(docs, Math.floor(working * 0.4) * 4);
			messages.unshift({
				role: 'system',
				content: `Attached files in this conversation (extracted text):\n\n${stuffed.text}`
			});
			if (stuffed.truncated) opts.emit('context', { trimmed: 0, docsTruncated: true, docsOmittedChars: stuffed.omitted });
		}
		// Images ride the user message that added them (stamped attachmentIds): trimHistory
		// can evict them with old turns, each image ships once, and the history prefix stays
		// byte-stable for prompt caching. Dedup in message order also covers legacy
		// conversations stamped with all ids on every message.
		// ponytail: config `vision` map (tiny-image probe) is the gate — a confirmed
		// non-vision model gets text-only; unprobed models are optimistic.
		if (endpoint.vision?.[opts.model] !== false) {
			const byId = new Map(opts.attachments.filter((a) => a.isImage && a.dataUri).map((a) => [a.id, a]));
			const seen = new Set<string>();
			let ordinal = 0; // attachment order across the conversation — highest is the newest
			let shipped = 0;
			for (let i = 0; i < messages.length; i++) {
				const m = messages[i];
				if (m.role !== 'user' || typeof m.content !== 'string' || !m.attachmentIds?.length) continue;
				const imgs = m.attachmentIds.filter((id) => byId.has(id) && !seen.has(id)).map((id) => byId.get(id)!);
				if (!imgs.length) continue;
				for (const a of imgs) seen.add(a.id);
				shipped += imgs.length;
				const labels = imgs.map((a) => `[Picture ${++ordinal}: ${a.name}]`).join('\n');
				messages[i] = {
					...m,
					content: [
						{ type: 'text', text: m.content ? `${m.content}\n\n${labels}` : labels },
						...imgs.map((a): ContentBlock => ({ type: 'image_url', image_url: { url: a.dataUri! } }))
					]
				};
			}
			// A lone "the picture" in a new turn is ambiguous once 2+ pictures ship — pin it
			// to the newest (highest ordinal) so a weak model doesn't default to the first.
			// Wire-only and constant: the stable prefix survives past the one-time rewrite
			// when the 2nd image lands, and the note never changes after.
			if (shipped >= 2)
				messages.unshift({
					role: 'system',
					content:
						'Images are labeled [Picture N: name] in the order they were attached. ' +
						'When the user refers to a single image ("this image", "the picture", "that photo") ' +
						'without naming which, they mean the most recently attached one (the highest N). ' +
						'When they ask about several images, use all of them.'
				});
		}
	}
	const t0 = Date.now();
	let promptTokens = 0;
	let completionTokens = 0;
	// Clamp to the model's probed max — unprobed models (no config entry) pass through.
	const level = clampReasoning(opts.reasoning, endpoint.reasoning?.[opts.model]);

	// round MAX_TOOL_ROUNDS is the guaranteed final answer: tools stripped, so the model
	// can't burn another round — the user always gets a reply, not a "stopped" note.
	for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
		const final = round === MAX_TOOL_ROUNDS;
		// tool results grow the context mid-turn, so trim before every round. The trim
		// is wire-only — the persisted history keeps the full turns.
		const { messages: fit, trimmed } = trimHistory(messages, working);
		if (trimmed) opts.emit('context', { trimmed });
		const wire = toWire(fit);
		if (final) {
			// nudge goes on the wire only — it isn't part of the persisted history
			wire.push({ role: 'system', content: 'Tool-round limit reached. Answer the user now with the information gathered so far.' });
		}
		let stream: Awaited<ReturnType<typeof streamUpstream>>;
		try {
			stream = await streamUpstream(
				endpoint,
				{
					model: opts.model,
					messages: wire,
					tools: final ? [] : opts.tools ? filterTools(opts.tools) : toolSchemas,
					// Already clamped to the model's probed max; unprobed models pass through
					...(level && level !== 'off' ? { reasoning_effort: level } : {}),
					stream_options: { include_usage: true }, // per-turn stats; servers that ignore it just omit usage
					stream: true
				},
				opts.emit,
				level,
				opts.signal
			);
		} catch (e) {
			if (!opts.signal?.aborted) throw e;
			// stop landed between rounds — keep what the earlier rounds produced
			return appended;
		}
		const { content, reasoning, toolCalls, promptTokens: pt, completionTokens: ct } = stream;
		promptTokens += pt;
		completionTokens += ct;

		if (opts.signal?.aborted) {
			// Stop mid-stream: keep the partial answer. Unanswered tool calls get a
			// synthetic result — servers reject a tool_calls message with no results.
			if (content || toolCalls.length) {
				appended.push({
					role: 'assistant',
					content,
					...(toolCalls.length ? { tool_calls: toolCalls } : {}),
					...(reasoning && level && level !== 'off'
						? { reasoning, reasoningLevel: level }
						: {})
				});
				for (const tc of toolCalls)
					appended.push({ role: 'tool', tool_call_id: tc.id, name: tc.name, content: 'Stopped.' } as Message);
			}
			return appended;
		}

		if (toolCalls.length === 0) {
			const msg: Message = {
				role: 'assistant',
				content,
				...(reasoning && level && level !== 'off'
					? { reasoning, reasoningLevel: level }
					: {}),
				...(promptTokens || completionTokens
					? { stats: { prompt: promptTokens, completion: completionTokens, wallMs: Date.now() - t0 } }
					: {})
			};
			messages.push(msg);
			appended.push(msg);
			if (msg.stats) opts.emit('stats', msg.stats);
			return appended;
		}

		const assistant: Message = {
			role: 'assistant',
			content,
			tool_calls: toolCalls,
			...(reasoning && level && level !== 'off' ? { reasoning, reasoningLevel: level } : {})
		};
		messages.push(assistant);
		appended.push(assistant);

		let results: Message[];
		try {
			results = await Promise.all(
				toolCalls.map(async (tc) => {
					let args: Record<string, unknown>;
					try {
						args = JSON.parse(tc.arguments || '{}');
					} catch {
						args = {};
					}
					opts.emit('tool_call', { id: tc.id, name: tc.name, args });
					const result = await executeTool(tc.name, args, opts.signal);
					opts.emit('tool_result', { id: tc.id, summary: result.summary });
					return { role: 'tool', tool_call_id: tc.id, name: tc.name, content: result.content } as Message;
				})
			);
		} catch (e) {
			if (!opts.signal?.aborted) throw e;
			// Stop mid-tool-round: the assistant tool_calls message above needs results
			// or the next turn 400s — answer every call with a stub.
			results = toolCalls.map(
				(tc) => ({ role: 'tool', tool_call_id: tc.id, name: tc.name, content: 'Stopped.' } as Message)
			);
		}
		messages.push(...results);
		appended.push(...results);
	}

	return appended;
}
