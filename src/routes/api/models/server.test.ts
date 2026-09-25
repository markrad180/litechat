import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { rmSync, writeFileSync } from 'node:fs';
import { GET } from './+server.js';

// Per-suite scratch config, set before this file's $lib/config import: sibling
// suites sharing one file would delete each other's config mid-test. GET() also
// caches model results into it.
vi.hoisted(() => {
	process.env.LITECHAT_CONFIG = `${process.cwd()}/data/test-config-models.json`;
});
const testConfig = process.env.LITECHAT_CONFIG!;

beforeAll(() => {
	writeFileSync(testConfig, JSON.stringify({ name: '', baseUrl: 'http://test/v1', apiKey: '', models: [], defaultModel: '' }));
});
afterAll(() => {
	rmSync(testConfig, { force: true });
});

describe('GET /api/models', () => {
	it('maps upstream /models to a model list', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'm1' }] }), { status: 200 }))
		);
		const res = await GET();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ models: ['m1'], modelContext: {} });
	});

	it('502s when the upstream fetch rejects', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
		const res = await GET();
		expect(res.status).toBe(502);
	});
});
