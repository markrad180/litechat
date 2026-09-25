import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EndpointConfig } from '$lib/types';

// Run from the project root: `npm run dev` or `node build`. LITECHAT_CONFIG
// overrides the path so tests point at a scratch file, never the user's config.
const CONFIG_PATH = process.env.LITECHAT_CONFIG ?? path.join(process.cwd(), 'data', 'config.json');
const LEGACY_PATH = path.join(process.cwd(), 'config.json');

export const defaultConfig: EndpointConfig = {
	name: '',
	baseUrl: '',
	apiKey: '',
	models: [],
	defaultModel: '',
	accent: '',
	contextReserve: 0.11
};

interface LegacyEndpoint {
	id?: string;
	name?: string;
	baseUrl?: string;
	apiKey?: string;
	models?: string[];
}

function migrate(legacy: { endpoints?: LegacyEndpoint[]; defaultEndpoint?: string }): EndpointConfig {
	const pick =
		legacy.endpoints?.find((e) => e.id === legacy.defaultEndpoint) ?? legacy.endpoints?.[0];
	return {
		name: pick?.name ?? '',
		baseUrl: pick?.baseUrl ?? '',
		apiKey: pick?.apiKey ?? '',
		models: pick?.models ?? [],
		defaultModel: pick?.models?.[0] ?? ''
	};
}

export function loadConfig(configPath = CONFIG_PATH, legacyPath = LEGACY_PATH): EndpointConfig {
	if (existsSync(configPath)) {
		let raw: EndpointConfig;
		try {
			raw = JSON.parse(readFileSync(configPath, 'utf8')) as EndpointConfig;
		} catch (e) {
			throw new Error(
				`Cannot read ${configPath} (${e instanceof Error ? e.message : e}) — delete the file to reset`
			);
		}
		if (typeof raw.baseUrl !== 'string') {
			throw new Error(`${configPath}: "baseUrl" must be a string`);
		}
		return { ...defaultConfig, ...raw, models: Array.isArray(raw.models) ? raw.models : [] };
	}
	// v1 upgrade: one-time migration from the old repo-root config.json.
	// Code never deletes the user's file — it just stops reading it once migrated.
	if (existsSync(legacyPath)) {
		try {
			const cfg = migrate(JSON.parse(readFileSync(legacyPath, 'utf8')));
			saveConfig(cfg, configPath);
			return cfg;
		} catch {
			// corrupt legacy file — fall through to a fresh seed (onboarding repairs)
		}
	}
	const seed = { ...defaultConfig };
	saveConfig(seed, configPath);
	return seed;
}

export function saveConfig(cfg: EndpointConfig, configPath = CONFIG_PATH): void {
	mkdirSync(path.dirname(configPath), { recursive: true });
	writeFileSync(configPath, JSON.stringify(cfg, null, '\t'));
}
