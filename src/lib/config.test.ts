import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultConfig, loadConfig, saveConfig } from './config.js';
import { workingContext } from './models.js';

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
		expect(cfg.baseUrl).toBe('');
		expect(readFileSync(cfgPath(), 'utf8')).toContain('"baseUrl"');
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
		expect(cfg.baseUrl).toBe('http://localhost:8000/v1');
		expect(cfg.name).toBe('Ninfer');
		expect(cfg.defaultModel).toBe('');
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
		expect(cfg.baseUrl).toBe('http://a/v1');
		expect(cfg.defaultModel).toBe('only');
	});

	it('round-trips saveConfig', () => {
		const cfg = {
			name: 'x',
			baseUrl: 'http://u/v1',
			apiKey: 'k',
			models: ['a'],
			defaultModel: 'a',
			accent: '',
			contextReserve: 0.11
		};
		saveConfig(cfg, cfgPath());
		expect(loadConfig(cfgPath(), legacyPath())).toEqual(cfg);
	});

	it('workingContext scales the detected ceiling by the reserve', () => {
		expect(workingContext({ ...loadConfig(cfgPath(), legacyPath()), modelContext: { m: 180224 } }, 'm')).toBe(
			160399
		);
		// no detected ceiling → contextWindow, then the 160K default
		expect(workingContext({ ...defaultConfig, contextWindow: 32000 }, 'm')).toBe(28480);
		expect(workingContext(defaultConfig, 'm')).toBe(142400);
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
