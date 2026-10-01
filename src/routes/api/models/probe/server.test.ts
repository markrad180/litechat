import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { POST } from './+server.js';

// Per-suite scratch config, set before this file's $lib/config import: sibling
// suites sharing one file would delete each other's config mid-test.
vi.hoisted(() => {
	process.env.LITECHAT_CONFIG = `${process.cwd()}/data/test-config-probe.json`;
});
const testConfig = process.env.LITECHAT_CONFIG!;

function writeCfg(vision?: Record<string, boolean>, reasoning?: Record<string, string[]>, active = true) {
	writeFileSync(
		testConfig,
		JSON.stringify({
			servers: [
				{
					id: 's1',
					name: 'test',
					baseUrl: 'http://test/v1',
					apiKey: '',
					models: [],
					...(vision ? { vision } : {}),
					...(reasoning ? { reasoning } : {})
				}
			],
			activeServerId: active ? 's1' : null
		})
	);
}

function readCfg() {
	return JSON.parse(readFileSync(testConfig, 'utf8'));
}

function probeRequest(model = 'm1') {
	return new Request('http://localhost/api/models/probe', {
		method: 'POST',
		body: JSON.stringify({ model })
	});
}

// fetch mock returning one status per call, in order (vision probe first).
function stubStatuses(...statuses: number[]) {
	const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
		Promise.resolve(new Response('x', { status: statuses[fetchMock.mock.calls.length - 1] ?? 500 }))
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

beforeAll(() => writeCfg());
afterAll(() => {
	rmSync(testConfig, { force: true });
});

describe('POST /api/models/probe', () => {
	it('records vision=true on 200 and sends the minimal tiny-image request', async () => {
		writeCfg();
		const fetchMock = stubStatuses(200, 200, 200, 200, 200, 200); // vision probe, then all five effort probes
		const res = await POST({ request: probeRequest() });
		expect(await res.json()).toEqual({ model: 'm1', vision: true, reasoning: ['xhigh', 'high', 'medium', 'low', 'none'] });
		const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
		expect(body).toMatchObject({ model: 'm1', max_tokens: 1 });
		expect(body.messages[0].content).toEqual([
			{ type: 'text', text: '.' },
			{ type: 'image_url', image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) } }
		]);
		expect(JSON.parse(readFileSync(testConfig, 'utf8')).servers[0].vision).toEqual({ m1: true });
	});

	it('records vision=false on 400 and 422 (and no effort support when all efforts 4xx)', async () => {
		for (const status of [400, 422]) {
			writeCfg();
			stubStatuses(status, status, status, status, status, status);
			const res = await POST({ request: probeRequest() });
			expect(await res.json()).toEqual({ model: 'm1', vision: false, reasoning: [] });
		}
		expect(readCfg().servers[0].vision).toEqual({ m1: false });
		expect(readCfg().servers[0].reasoning).toEqual({ m1: [] });
	});

	it('writes nothing on other 4xx, 5xx, or network failure', async () => {
		const impls: (() => Promise<Response>)[] = [
			() => Promise.resolve(new Response('auth', { status: 401 })),
			() => Promise.resolve(new Response('slow down', { status: 429 })),
			() => Promise.resolve(new Response('down', { status: 500 })),
			() => Promise.reject(new Error('ECONNREFUSED'))
		];
		for (const impl of impls) {
			writeCfg();
			vi.stubGlobal('fetch', vi.fn().mockImplementation(impl));
			const res = await POST({ request: probeRequest() });
			expect(await res.json()).toEqual({ model: 'm1', vision: null, reasoning: null });
		}
		expect(readCfg().servers[0].vision).toBeUndefined();
		expect(readCfg().servers[0].reasoning).toBeUndefined();
	});

	it('never overwrites existing entries (and doesn’t fetch)', async () => {
		writeCfg({ m1: true }, { m1: ['high', 'medium'] });
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const res = await POST({ request: probeRequest() });
		expect(await res.json()).toEqual({ model: 'm1', vision: true, reasoning: ['high', 'medium'] });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns inconclusive nulls with no active server (and doesn’t fetch)', async () => {
		writeCfg(undefined, undefined, false);
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const res = await POST({ request: probeRequest() });
		expect(await res.json()).toEqual({ model: 'm1', vision: null, reasoning: null });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('400s without a model', async () => {
		const res = await POST({
			request: new Request('http://localhost/api/models/probe', {
				method: 'POST',
				body: JSON.stringify({})
			})
		});
		expect(res.status).toBe(400);
	});
});

describe('reasoning effort set', () => {
	it('records the exact accepted set, including non-monotonic holes', async () => {
		// The real-world case: a template that rejects 'high' while accepting
		// 'xhigh' — a max-based probe would record 'xhigh' and pass 'high' through.
		writeCfg({ m1: true }); // vision known — only effort probes run
		const fetchMock = stubStatuses(200, 400, 200, 200, 400); // xhigh, high, medium, low, none (rejected)
		const res = await POST({ request: probeRequest() });
		expect(await res.json()).toEqual({ model: 'm1', vision: true, reasoning: ['xhigh', 'medium', 'low'] });
		expect(fetchMock).toHaveBeenCalledTimes(5); // every effort probed, no early stop
		const efforts = fetchMock.mock.calls.map((c) =>
			JSON.parse((c[1] as RequestInit).body as string).reasoning_effort
		);
		expect(efforts).toEqual(['xhigh', 'high', 'medium', 'low', 'none']);
		expect(readCfg().servers[0].reasoning).toEqual({ m1: ['xhigh', 'medium', 'low'] });
	});

	it('records an empty set when every effort is rejected', async () => {
		writeCfg({ m1: true });
		stubStatuses(400, 400, 400, 400, 400);
		const res = await POST({ request: probeRequest() });
		expect(await res.json()).toEqual({ model: 'm1', vision: true, reasoning: [] });
		expect(readCfg().servers[0].reasoning).toEqual({ m1: [] });
	});

	it('bails with null on a mid-probe 5xx (re-probed next time)', async () => {
		writeCfg({ m1: true });
		stubStatuses(400, 500, 200, 200);
		const res = await POST({ request: probeRequest() });
		expect(await res.json()).toEqual({ model: 'm1', vision: true, reasoning: null });
		expect(readCfg().servers[0].reasoning).toBeUndefined();
	});

	it('skips the image probe when vision is already known', async () => {
		writeCfg({ m1: true });
		const fetchMock = stubStatuses(200);
		await POST({ request: probeRequest() });
		const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
		expect(body.messages[0].content).toBe('.');
	});
});
