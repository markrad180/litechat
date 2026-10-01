import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { GET, PUT } from './+server.js';

// Per-suite scratch config, set before this file's $lib/config import: sibling
// suites sharing one file would delete each other's config mid-test.
vi.hoisted(() => {
	process.env.LITECHAT_CONFIG = `${process.cwd()}/data/test-config-config.json`;
});
const configPath = process.env.LITECHAT_CONFIG!;

function writeCfg(cfg: unknown) {
	writeFileSync(configPath, JSON.stringify(cfg));
}
function readCfg() {
	return JSON.parse(readFileSync(configPath, 'utf8'));
}
function put(body: unknown) {
	return PUT({
		request: new Request('http://localhost/api/config', { method: 'PUT', body: JSON.stringify(body) })
	});
}

beforeAll(() => {
	writeCfg({ servers: [], activeServerId: null, accent: '', theme: 'light' });
});
afterAll(() => {
	rmSync(configPath, { force: true });
});

describe('GET /api/config', () => {
	it('strips apiKeys from every server', async () => {
		writeCfg({
			servers: [
				{ id: 'a', name: 'A', baseUrl: 'http://a/v1', apiKey: 'secret-a', models: [] },
				{ id: 'b', name: 'B', baseUrl: 'http://b/v1', apiKey: 'secret-b', models: [] }
			],
			activeServerId: 'a'
		});
		const cfg = await (await GET()).json();
		expect(cfg.servers.map((s: { apiKey?: string }) => s.apiKey)).toEqual([undefined, undefined]);
		expect(cfg.servers[0].name).toBe('A');
		expect(cfg.activeServerId).toBe('a');
	});
});

describe('PUT /api/config', () => {
	it('inherits stored apiKeys by server id (the stripped round-trip)', async () => {
		writeCfg({
			servers: [{ id: 'a', name: 'A', baseUrl: 'http://a/v1', apiKey: 'secret-a', models: [] }],
			activeServerId: 'a'
		});
		// the client never sees keys, so it round-trips ''
		const res = await put({
			servers: [{ id: 'a', name: 'A', baseUrl: 'http://a/v1', apiKey: '', models: ['m1'] }],
			activeServerId: 'a'
		});
		expect(res.status).toBe(200);
		expect(((await res.json()).servers[0] as { apiKey?: string }).apiKey).toBeUndefined();
		expect(readCfg().servers[0].apiKey).toBe('secret-a');
		expect(readCfg().servers[0].models).toEqual(['m1']);
	});

	it('stores a new key for a new server id', async () => {
		const res = await put({
			servers: [{ id: 'new', name: 'N', baseUrl: 'http://n/v1', apiKey: 'k', models: [] }],
			activeServerId: 'new'
		});
		expect(res.status).toBe(200);
		expect(readCfg().servers[0].apiKey).toBe('k');
	});

	it('400s on a dangling activeServerId', async () => {
		const res = await put({
			servers: [{ id: 'a', name: 'A', baseUrl: 'http://a/v1', apiKey: '', models: [] }],
			activeServerId: 'gone'
		});
		expect(res.status).toBe(400);
	});

	it('400s on an empty baseUrl', async () => {
		const res = await put({
			servers: [{ id: 'a', name: 'A', baseUrl: '   ', apiKey: '', models: [] }],
			activeServerId: null
		});
		expect(res.status).toBe(400);
	});

	it('keeps app-level field validation', async () => {
		expect((await put({ servers: [], activeServerId: null, theme: 'nope' })).status).toBe(400);
		expect((await put({ servers: [], activeServerId: null, sidebarWidth: 100 })).status).toBe(400);
		expect((await put({ servers: [], activeServerId: null, composerHeight: -1 })).status).toBe(400);
		expect((await put({ servers: [], activeServerId: null, theme: 'dark' })).status).toBe(200);
	});
});
