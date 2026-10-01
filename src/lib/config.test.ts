import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { activeServer, defaultConfig, loadConfig, saveConfig } from './config.js';
import { workingContext } from './models.js';
import type { AppConfig, ServerConfig } from './types.js';

let dir: string;
const cfgPath = () => path.join(dir, 'config.json');
const legacyPath = () => path.join(dir, 'legacy.json');

beforeAll(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'harness-cfg-'));
});
beforeEach(() => {
	rmSync(cfgPath(), { force: true });
	rmSync(legacyPath(), { force: true });
});
afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe('loadConfig', () => {
	it('seeds an empty config when no file exists', () => {
		const cfg = loadConfig(cfgPath(), legacyPath());
		expect(cfg.servers).toEqual([]);
		expect(cfg.activeServerId).toBeNull();
		expect(readFileSync(cfgPath(), 'utf8')).toContain('"servers"');
	});

	it('migrates a v2 single-endpoint config into servers[]', () => {
		writeFileSync(
			cfgPath(),
			JSON.stringify({
				name: 'My box',
				baseUrl: 'http://localhost:8080/v1',
				apiKey: 'k',
				models: ['m1'],
				modelContext: { m1: 8192 },
				vision: { m1: true },
				accent: '#a855f7',
				contextReserve: 0.2
			})
		);
		const cfg = loadConfig(cfgPath(), legacyPath());
		expect(cfg.servers).toHaveLength(1);
		const s = cfg.servers[0];
		expect(s.name).toBe('My box');
		expect(s.baseUrl).toBe('http://localhost:8080/v1');
		expect(s.apiKey).toBe('k');
		expect(s.models).toEqual(['m1']);
		expect(s.vision).toEqual({ m1: true });
		expect(s).not.toHaveProperty('contextReserve'); // reserve is app-level now
		expect(cfg.contextReserve).toBe(0.2);
		expect(cfg.activeServerId).toBe(s.id);
		expect(cfg.accent).toBe('#a855f7');
	});

	it('falls back to the host of baseUrl when name is missing', () => {
		writeFileSync(
			cfgPath(),
			JSON.stringify({ baseUrl: 'http://10.0.0.5:1234/v1', apiKey: '', models: [] })
		);
		const cfg = loadConfig(cfgPath(), legacyPath());
		expect(cfg.servers[0].name).toBe('10.0.0.5:1234');
	});

	it('migrates an unconfigured v2 seed to zero servers', () => {
		writeFileSync(cfgPath(), JSON.stringify({ baseUrl: '', apiKey: '', models: [] }));
		const cfg = loadConfig(cfgPath(), legacyPath());
		expect(cfg.servers).toEqual([]);
		expect(cfg.activeServerId).toBeNull();
	});

	it('is idempotent: a migrated file keeps its server id on reload', () => {
		writeFileSync(cfgPath(), JSON.stringify({ baseUrl: 'http://a/v1', apiKey: '', models: ['m'] }));
		const first = loadConfig(cfgPath(), legacyPath());
		const second = loadConfig(cfgPath(), legacyPath());
		expect(second.servers[0].id).toBe(first.servers[0].id);
	});

	it('migrates a v1 root config.json to the default endpoint', () => {
		writeFileSync(
			legacyPath(),
			JSON.stringify({
				endpoints: [
					{ id: 'llamacpp', name: 'llama.cpp', baseUrl: 'http://localhost:8080/v1', apiKey: '', models: ['m1'] },
					{ id: 'ninfer', name: 'Ninfer', baseUrl: 'http://localhost:8000/v1', apiKey: '', models: [] }
				],
				defaultEndpoint: 'ninfer'
			})
		);
		const cfg = loadConfig(cfgPath(), legacyPath());
		expect(cfg.servers).toHaveLength(1);
		expect(cfg.servers[0].name).toBe('Ninfer');
		expect(cfg.servers[0].baseUrl).toBe('http://localhost:8000/v1');
		expect(cfg.activeServerId).toBe(cfg.servers[0].id);
	});

	it('falls back to the first endpoint when defaultEndpoint is unknown', () => {
		writeFileSync(
			legacyPath(),
			JSON.stringify({
				endpoints: [{ id: 'a', name: 'A', baseUrl: 'http://a/v1', apiKey: '', models: ['only'] }],
				defaultEndpoint: 'missing'
			})
		);
		const cfg = loadConfig(cfgPath(), legacyPath());
		expect(cfg.servers[0].baseUrl).toBe('http://a/v1');
	});

	it('round-trips saveConfig', () => {
		const cfg: AppConfig = {
			servers: [
				{
					id: 's1',
					name: 'x',
					baseUrl: 'http://u/v1',
					apiKey: 'k',
					models: ['a'],
					accent: undefined
				} as ServerConfig
			],
			activeServerId: 's1',
			accent: '',
			theme: 'light',
			contextReserve: 0.11
		};
		saveConfig(cfg, cfgPath());
		expect(loadConfig(cfgPath(), legacyPath())).toEqual({ ...cfg, servers: [cfg.servers[0]] });
	});

	it('workingContext scales the detected ceiling by the reserve', () => {
		const srv: ServerConfig = {
			id: 's',
			name: 's',
			baseUrl: 'http://x/v1',
			apiKey: '',
			models: ['m'],
			modelContext: { m: 180224 }
		};
		expect(workingContext(srv, 'm')).toBe(160399); // default 0.11 reserve
		expect(workingContext(srv, 'm', 0.25)).toBe(135168);
		// no detected ceiling → the configured contextWindow, and null when unknown (no assumed default)
		expect(workingContext({ ...srv, modelContext: undefined, contextWindow: 32000 }, 'm')).toBe(28480);
		expect(workingContext({ ...srv, modelContext: undefined }, 'm')).toBeNull();
	});

	it('hoists a per-server contextReserve to the app level on load', () => {
		writeFileSync(
			cfgPath(),
			JSON.stringify({
				servers: [{ id: 's1', name: 'x', baseUrl: 'http://u/v1', apiKey: 'k', models: ['a'], contextReserve: 0.3 }],
				activeServerId: 's1',
				accent: '',
				theme: 'light'
			})
		);
		const cfg = loadConfig(cfgPath(), legacyPath());
		expect(cfg.contextReserve).toBe(0.3);
		expect(cfg.servers[0]).not.toHaveProperty('contextReserve');
	});

	it('persists accent and defaults it to unset', () => {
		expect(loadConfig(cfgPath(), legacyPath()).accent).toBe('');
		saveConfig({ ...loadConfig(cfgPath(), legacyPath()), accent: '#a855f7' }, cfgPath());
		expect(loadConfig(cfgPath(), legacyPath()).accent).toBe('#a855f7');
	});

	it('throws on corrupt JSON', () => {
		writeFileSync(cfgPath(), '{nope');
		expect(() => loadConfig(cfgPath(), legacyPath())).toThrow();
	});
});

describe('activeServer', () => {
	const base: AppConfig = {
		servers: [{ id: 'a', name: 'A', baseUrl: 'http://a/v1', apiKey: '', models: [] }],
		activeServerId: 'a',
		accent: '',
		theme: 'light'
	};

	it('resolves the active server', () => {
		expect(activeServer(base)?.id).toBe('a');
	});

	it('returns null for a null activeServerId', () => {
		expect(activeServer({ ...base, activeServerId: null })).toBeNull();
	});

	it('returns null for a dangling activeServerId', () => {
		expect(activeServer({ ...base, activeServerId: 'gone' })).toBeNull();
	});
});
