import { describe, expect, it, vi } from 'vitest';
import {
	accumulateToolCalls,
	estimateTokens,
	extractReasoning,
	filterTools,
	runAgent,
	trimHistory,
	toWire
} from './agent.js';
import type { Message, ToolCall } from '$lib/types.js';

vi.mock('$lib/config', () => ({
	loadConfig: () => ({ baseUrl: 'http://localhost:9999/v1', apiKey: '', models: [] }),
	workingContext: () => 160000
}));

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
