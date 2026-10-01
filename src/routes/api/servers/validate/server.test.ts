import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { rmSync, writeFileSync } from 'node:fs';
import { POST } from './+server.js';

// Per-suite scratch config, set before this file's $lib/config import: sibling
// suites sharing one file would delete each other's config mid-test.
vi.hoisted(() => {
	process.env.LITECHAT_CONFIG = `${process.cwd()}/data/test-config-validate.json`;
});
const configPath = process.env.LITECHAT_CONFIG!;

function validateRequest(body: Record<string, unknown>) {
	return new Request('http://localhost/api/servers/validate', {
		method: 'POST',
		body: JSON.stringify(body)
	});
}

beforeAll(() => {
	writeFileSync(
		configPath,
		JSON.stringify({
			servers: [{ id: 'stored', name: 'S', baseUrl: 'http://stored/v1', apiKey: 'stored-key', models: [] }],
			activeServerId: 'stored'
		})
	);
});
afterAll(() => {
	rmSync(configPath, { force: true });
});

describe('POST /api/servers/validate', () => {
	it('returns models + modelContext and a conclusive-only vision map', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				// /models
				.mockResolvedValueOnce(
					new Response(
						JSON.stringify({ data: [{ id: 'm1', max_model_len: 8192 }, { id: 'm2' }, { id: 'm3' }] }),
						{ status: 200 }
					)
				)
				// vision probes (worker order = model order): m1 200, m2 400, m3 500 (inconclusive → omitted)
				.mockResolvedValueOnce(new Response('ok', { status: 200 }))
				.mockResolvedValueOnce(new Response('nope', { status: 400 }))
				.mockResolvedValueOnce(new Response('down', { status: 500 }))
		);
		const res = await POST({ request: validateRequest({ baseUrl: 'http://up/v1', apiKey: 'k' }) });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			models: ['m1', 'm2', 'm3'],
			modelContext: { m1: 8192 },
			vision: { m1: true, m2: false }
		});
	});

	it('502s when the upstream rejects (auth)', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 })));
		const res = await POST({ request: validateRequest({ baseUrl: 'http://up/v1' }) });
		expect(res.status).toBe(502);
		expect((await res.json()).error).toContain('401');
	});

	it('502s on network failure', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
		const res = await POST({ request: validateRequest({ baseUrl: 'http://up/v1' }) });
		expect(res.status).toBe(502);
	});

	it('400s without a baseUrl', async () => {
		const res = await POST({ request: validateRequest({}) });
		expect(res.status).toBe(400);
	});

	it('inherits the stored key for a known serverId', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'm1' }] }), { status: 200 }))
			.mockResolvedValueOnce(new Response('ok', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const res = await POST({ request: validateRequest({ baseUrl: 'http://stored/v1', serverId: 'stored' }) });
		expect(res.status).toBe(200);
		const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
		expect(headers.authorization).toBe('Bearer stored-key');
	});
});
