import { describe, expect, it, vi } from 'vitest';
import {
	accumulateToolCalls,
	estimateTokens,
	extractReasoning,
	filterTools,
	runAgent,
	stuffAttachments,
	trimHistory,
	toWire
} from './agent.js';
import type { Message, ToolCall } from '$lib/types.js';

vi.mock('$lib/config', () => ({
	loadConfig: () => ({ baseUrl: 'http://localhost:9999/v1', apiKey: '', models: [] })
}));
// agent.ts imports workingContext from $lib/models (this mock previously pointed at
// $lib/config, so the tests silently ran against the real 160K default)
vi.mock('$lib/models.js', () => ({ workingContext: () => 142400 }));

// SSE response body for one upstream stream: a tool-call round or a plain answer.
function sseResponse(sse: string) {
	return new Response(
		new ReadableStream({
			start(c) {
				c.enqueue(new TextEncoder().encode(sse));
				c.close();
			}
		})
	);
}

const TOOL_SSE =
	'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"calculator","arguments":"{\\"expression\\": \\"6*7\\"}"}}]}}]}\n\ndata: [DONE]\n\n';
const ANSWER_SSE = 'data: {"choices":[{"delta":{"content":"42, from what I gathered"}}]}\n\ndata: [DONE]\n\n';

describe('runAgent tool-round limit', () => {
	it('forces a final no-tool answer instead of stopping silent', async () => {
		const requests: { tools?: unknown[]; messages?: { role: string; content: string }[] }[] = [];
		globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
			const body = JSON.parse(init!.body as string);
			requests.push(body);
			// rounds 1-5: the model keeps calling tools; the final (no-tool) round answers
			return sseResponse(body.tools?.length ? TOOL_SSE : ANSWER_SSE);
		}) as typeof fetch;
		const out = await runAgent({ model: 'm', messages: [{ role: 'user', content: 'hi' }], emit: () => {} });
		expect(out.at(-1)?.content).toBe('42, from what I gathered'); // a real answer, not a "stopped" note
		expect(requests).toHaveLength(6); // 5 tool rounds + 1 forced answer round
		expect(requests[5].tools).toEqual([]);
		expect(requests[5].messages?.at(-1)?.content).toMatch(/answer the user/i); // nudge on the wire
	});
});

describe('estimateTokens / trimHistory', () => {
	const turn = (n: number): Message[] => [
		{ role: 'user', content: 'x'.repeat(n * 4) }, // n tokens at chars/4
		{ role: 'assistant', content: '', tool_calls: [{ id: `c${n}`, name: 'calculator', arguments: '{}' }] },
		{ role: 'tool', content: '42', tool_call_id: `c${n}` },
		{ role: 'assistant', content: 'done' }
	];

	it('estimates chars÷4 plus the fixed overhead', () => {
		expect(estimateTokens([{ role: 'user', content: 'abcd' }])).toBe(1501);
	});

	it('drops whole turns from the front, keeping the newest user message and tool pairs intact', () => {
		const msgs = [...turn(1000), ...turn(1000), ...turn(1000)];
		const { messages, trimmed } = trimHistory(msgs, 1500 + 1000 + 10); // fits exactly one turn
		expect(trimmed).toBe(8); // both older turns (4 messages each)
		expect(messages).toEqual(turn(1000)); // the surviving turn is byte-identical, pairs intact
	});

	it('never drops the newest user message', () => {
		const msgs = turn(100000);
		const { messages, trimmed } = trimHistory(msgs, 10);
		expect(trimmed).toBe(0);
		expect(messages).toEqual(msgs);
	});
});

describe('estimateTokens with content blocks', () => {
	it('sums text blocks and image-URL lengths', () => {
		const msg: Message = {
			role: 'user',
			content: [{ type: 'text', text: 'abcd' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }]
		};
		// 4 + 26 = 30 chars ÷ 4 = 7.5 → 8
		expect(estimateTokens([msg])).toBe(1508);
	});
});

describe('stuffAttachments', () => {
	const docs = [
		{ name: 'a.md', text: 'A'.repeat(100) },
		{ name: 'b.md', text: 'B'.repeat(100) }
	];

	it('stuffs whole docs when they fit', () => {
		const s = stuffAttachments(docs, 1000);
		expect(s.truncated).toBe(false);
		expect(s.text).toBe('=== a.md ===\n' + 'A'.repeat(100) + '\n\n=== b.md ===\n' + 'B'.repeat(100));
	});

	it('cuts at a doc boundary and marks the omission when they don’t', () => {
		const s = stuffAttachments(docs, 150); // fits a.md (≈109 chars) + part of the b.md header
		expect(s.truncated).toBe(true);
		expect(s.omitted).toBeGreaterThan(0);
		expect(s.text).toContain('=== a.md ===');
		expect(s.text).not.toContain('=== b.md ==='); // whole docs stay intact
		expect(s.text).toMatch(/\[truncated — \d+ characters of attached documents omitted/);
	});
});

describe('runAgent attachments', () => {
	// mocked upstream answers in one round
	function capture() {
		const requests: { messages?: unknown[] }[] = [];
		const events: [string, unknown][] = [];
		globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
			const body = JSON.parse(init!.body as string);
			requests.push(body);
			return sseResponse(ANSWER_SSE);
		}) as typeof fetch;
		return {
			requests,
			events,
			emit: (event: string, data: unknown) => events.push([event, data])
		};
	}

	it('stuffs a leading wire-only system message and never persists it', async () => {
		const { requests, emit } = capture();
		const out = await runAgent({
			model: 'm',
			messages: [{ role: 'user', content: 'summarize' }],
			attachments: [{ name: 'a.md', text: 'alpha content', isImage: false }],
			emit
		});
		const first = requests[0].messages?.[0] as { role: string; content: string };
		expect(first.role).toBe('system');
		expect(first.content).toContain('=== a.md ===\nalpha content');
		expect(out.every((m) => m.role !== 'system')).toBe(true); // appended excludes the stuffing
	});

	it('truncates oversized docs and reports it via a context event', async () => {
		const { requests, events, emit } = capture();
		// working = 160000*0.89 = 142400 → doc budget = 56960 tokens = 227840 chars
		const huge = 'x'.repeat(300_000);
		await runAgent({
			model: 'm',
			messages: [{ role: 'user', content: 'hi' }],
			attachments: [{ name: 'big.md', text: huge, isImage: false }],
			emit
		});
		const stuffed = requests[0].messages?.[0] as { content: string };
		expect(stuffed.content).toMatch(/\[truncated — \d+ characters/);
		expect(events.some(([e, d]) => e === 'context' && (d as { docsTruncated?: boolean }).docsTruncated)).toBe(true);
	});

	it('puts images on the sending turn as content blocks', async () => {
		const { requests, emit } = capture();
		await runAgent({
			model: 'm',
			messages: [{ role: 'user', content: 'what is this?' }],
			attachments: [{ name: 'a.png', isImage: true, dataUri: 'data:image/png;base64,AAA' }],
			emit
		});
		const last = requests[0].messages?.at(-1) as { content: unknown[] };
		expect(last.content).toEqual([
			{ type: 'text', text: 'what is this?' },
			{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }
		]);
	});
});

describe('trimHistory with a stuffed system message', () => {
	it('keeps the leading attachment context and trims user turns around it', () => {
		const stuffed: Message = { role: 'system', content: 'Attached files…' };
		const turn = (n: number): Message[] => [
			{ role: 'user', content: 'x'.repeat(n * 4) },
			{ role: 'assistant', content: 'done' }
		];
		const msgs: Message[] = [stuffed, ...turn(1000), ...turn(1000), ...turn(1000)];
		const { messages } = trimHistory(msgs, 1500 + 1000 + 300); // room for stuffing + one turn
		expect(messages[0]).toBe(stuffed);
		expect(messages.filter((m) => m.role === 'user')).toHaveLength(1);
	});
});

describe('accumulateToolCalls', () => {
	it('reassembles fragmented tool-call deltas', () => {
		const acc = new Map<number, ToolCall>();
		accumulateToolCalls(acc, [{ index: 0, id: 'call_1', function: { name: 'web_' } }]);
		accumulateToolCalls(acc, [{ index: 0, function: { name: 'search', arguments: '{"que' } }]);
		accumulateToolCalls(acc, [{ index: 0, function: { arguments: 'ry": "llama"}' } }]);
		expect([...acc.values()]).toEqual([
			{ id: 'call_1', name: 'web_search', arguments: '{"query": "llama"}' }
		]);
	});

	it('tracks multiple concurrent calls by index', () => {
		const acc = new Map<number, ToolCall>();
		accumulateToolCalls(acc, [
			{ index: 0, id: 'a', function: { name: 'calculator', arguments: '{"expression": "6*7"}' } },
			{ index: 1, id: 'b', function: { name: 'web_search', arguments: '{}' } }
		]);
		expect(acc.size).toBe(2);
	});
});

describe('toWire', () => {
	it('converts flat tool_calls to the OpenAI wire shape', () => {
		const msgs: Message[] = [
			{ role: 'user', content: 'hi' },
			{
				role: 'assistant',
				content: '',
				tool_calls: [{ id: 'c1', name: 'calculator', arguments: '{"expression": "6*7"}' }]
			},
			{ role: 'tool', content: '42', tool_call_id: 'c1' }
		];
		const wire = toWire(msgs);
		expect(wire[1].tool_calls).toEqual([
			{ id: 'c1', type: 'function', function: { name: 'calculator', arguments: '{"expression": "6*7"}' } }
		]);
		expect(wire[0]).toEqual(msgs[0]); // messages without tool_calls pass through untouched
	});

	it('drops display-only reasoning, level, and stats from the wire', () => {
		const wire = toWire([
			{
				role: 'assistant',
				content: 'done',
				reasoning: 'thought about it',
				reasoningLevel: 'high',
				stats: { prompt: 100, completion: 200, wallMs: 3000 }
			}
		]);
		expect(wire[0]).toEqual({ role: 'assistant', content: 'done' });
	});
});

describe('extractReasoning', () => {
	it('autodetects reasoning field variants', () => {
		expect(extractReasoning({ reasoning: 'a' })).toBe('a');
		expect(extractReasoning({ reasoning_content: 'b' })).toBe('b');
		expect(extractReasoning({})).toBe('');
		expect(extractReasoning(undefined)).toBe('');
	});
});

describe('filterTools', () => {
	it('keeps only the requested tool names', () => {
		expect(filterTools(['calculator']).map((s) => s.function.name)).toEqual(['calculator']);
		expect(filterTools([])).toEqual([]);
	});
});
