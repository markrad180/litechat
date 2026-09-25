import { loadConfig } from '$lib/config';
import { workingContext } from '$lib/models.js';
import { executeTool, toolSchemas } from '$lib/tools';
import type { ContentBlock, EndpointConfig, Message, ReasoningLevel, ToolCall } from '$lib/types';

// What the chat route hands runAgent for each conversation attachment.
export interface AttachmentInput {
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
		const { reasoning, reasoningLevel, stats, ...rest } = m; // display-only, stays off the wire
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
	reasoningLevel?: ReasoningLevel
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
		body: JSON.stringify(body)
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
		// Images ride on the sending turn only; older turns were trimmed or already saw them.
		const images = opts.attachments.filter((a) => a.isImage && a.dataUri);
		const last = messages[messages.length - 1];
		if (images.length && last?.role === 'user' && typeof last.content === 'string') {
			const blocks: ContentBlock[] = [
				{ type: 'text', text: last.content },
				...images.map((a): ContentBlock => ({ type: 'image_url', image_url: { url: a.dataUri! } }))
			];
			messages[messages.length - 1] = { ...last, content: blocks };
		}
	}
	const t0 = Date.now();
	let promptTokens = 0;
	let completionTokens = 0;
	const level = opts.reasoning;

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
		const {
			content,
			reasoning,
			toolCalls,
			promptTokens: pt,
			completionTokens: ct
		} = await streamUpstream(
			endpoint,
			{
				model: opts.model,
				messages: wire,
				tools: final ? [] : opts.tools ? filterTools(opts.tools) : toolSchemas,
				// ponytail: pass-through; the server decides validity (incl. non-standard 'xhigh')
				...(level && level !== 'off' ? { reasoning_effort: level } : {}),
				stream_options: { include_usage: true }, // per-turn stats; servers that ignore it just omit usage
				stream: true
			},
			opts.emit,
			level
		);
		promptTokens += pt;
		completionTokens += ct;

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

		const results = await Promise.all(
			toolCalls.map(async (tc) => {
				let args: Record<string, unknown>;
				try {
					args = JSON.parse(tc.arguments || '{}');
				} catch {
					args = {};
				}
				opts.emit('tool_call', { id: tc.id, name: tc.name, args });
				const result = await executeTool(tc.name, args);
				opts.emit('tool_result', { id: tc.id, summary: result.summary });
				return { role: 'tool', tool_call_id: tc.id, name: tc.name, content: result.content } as Message;
			})
		);
		messages.push(...results);
		appended.push(...results);
	}

	return appended;
}
