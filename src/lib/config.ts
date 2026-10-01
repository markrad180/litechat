import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AppConfig, ReasoningLevel, ServerConfig } from '$lib/types';

// Run from the project root: `npm run dev` or `node build`. LITECHAT_CONFIG
// overrides the path so tests point at a scratch file, never the user's config.
const CONFIG_PATH = process.env.LITECHAT_CONFIG ?? path.join(process.cwd(), 'data', 'config.json');
const LEGACY_PATH = path.join(process.cwd(), 'config.json');

export const defaultConfig: AppConfig = {
	servers: [],
	activeServerId: null,
	accent: '',
	theme: 'light'
};

// v2 single-endpoint shape — recognized by a top-level baseUrl string.
interface LegacySingle {
	name?: string;
	baseUrl?: string;
	apiKey?: string;
	models?: string[];
	accent?: string;
	contextWindow?: number;
	contextReserve?: number;
	modelContext?: Record<string, number>;
	vision?: Record<string, boolean>;
	reasoning?: Record<string, ReasoningLevel[]>;
	theme?: 'light' | 'dark';
	sidebarWidth?: number;
	composerHeight?: number;
}

function hostOf(baseUrl: string): string {
	try {
		return new URL(baseUrl).host;
	} catch {
		return '';
	}
}

// v2 → v3: wrap the single endpoint in servers[]. The uuid is generated once and
// persisted, so a migrated file is never re-migrated (the Array.isArray(raw.servers)
// guard in loadConfig is the idempotency check). An unconfigured seed (empty
// baseUrl) migrates to zero servers.
function toServers(legacy: LegacySingle): AppConfig {
	const baseUrl = (typeof legacy.baseUrl === 'string' && legacy.baseUrl.trim()) || '';
	const server: ServerConfig | null = baseUrl
		? {
				id: randomUUID(),
				name: legacy.name?.trim() || hostOf(baseUrl) || 'Server',
				baseUrl,
				apiKey: legacy.apiKey ?? '',
				models: Array.isArray(legacy.models) ? legacy.models : [],
				...(legacy.modelContext ? { modelContext: legacy.modelContext } : {}),
				...(legacy.vision ? { vision: legacy.vision } : {}),
				...(legacy.reasoning ? { reasoning: legacy.reasoning } : {}),
				...(legacy.contextWindow !== undefined ? { contextWindow: legacy.contextWindow } : {})
			}
		: null;
	return {
		servers: server ? [server] : [],
		activeServerId: server ? server.id : null,
		accent: legacy.accent ?? '',
		theme: legacy.theme ?? 'light',
		// Reserve is universal (app-level), not per-server.
		...(legacy.contextReserve !== undefined ? { contextReserve: legacy.contextReserve } : {}),
		...(legacy.sidebarWidth !== undefined ? { sidebarWidth: legacy.sidebarWidth } : {}),
		...(legacy.composerHeight !== undefined ? { composerHeight: legacy.composerHeight } : {})
	};
}

interface LegacyEndpoint {
	id?: string;
	name?: string;
	baseUrl?: string;
	apiKey?: string;
	models?: string[];
}

// v1 → v2: pick the default endpoint out of the old repo-root config.json.
function v1ToSingle(legacy: { endpoints?: LegacyEndpoint[]; defaultEndpoint?: string }): LegacySingle {
	const pick = legacy.endpoints?.find((e) => e.id === legacy.defaultEndpoint) ?? legacy.endpoints?.[0];
	return {
		name: pick?.name ?? '',
		baseUrl: pick?.baseUrl ?? '',
		apiKey: pick?.apiKey ?? '',
		models: pick?.models ?? []
	};
}

export function activeServer(cfg: AppConfig): ServerConfig | null {
	return cfg.servers.find((s) => s.id === cfg.activeServerId) ?? null;
}

export function loadConfig(configPath = CONFIG_PATH, legacyPath = LEGACY_PATH): AppConfig {
	if (existsSync(configPath)) {
		let raw: unknown;
		try {
			raw = JSON.parse(readFileSync(configPath, 'utf8'));
		} catch (e) {
			throw new Error(
				`Cannot read ${configPath} (${e instanceof Error ? e.message : e}) — delete the file to reset`
			);
		}
		const rec = (raw ?? {}) as Record<string, unknown>;
		if (Array.isArray(rec.servers)) {
			// v3 — normalize and return. The reserve used to live per-server; hoist it
			// to the universal app-level slot and strip it from the records (idempotent:
			// a top-level value always wins, so this never needs a disk write-back).
			// Older files carry the reserve per-server — read it off the raw shape.
			const rawServers = rec.servers as (ServerConfig & { contextReserve?: number })[];
			const reserve =
				typeof rec.contextReserve === 'number'
					? rec.contextReserve
					: rawServers.find((s) => typeof s.contextReserve === 'number')?.contextReserve;
			const servers = rawServers.map(({ contextReserve: _contextReserve, ...s }) => s);
			return {
				servers,
				activeServerId: typeof rec.activeServerId === 'string' ? rec.activeServerId : null,
				accent: typeof rec.accent === 'string' ? rec.accent : '',
				theme: rec.theme === 'dark' ? 'dark' : 'light',
				...(typeof rec.sidebarWidth === 'number' ? { sidebarWidth: rec.sidebarWidth } : {}),
				...(typeof rec.composerHeight === 'number' ? { composerHeight: rec.composerHeight } : {}),
				...(reserve !== undefined ? { contextReserve: reserve } : {})
			};
		}
		// v2 single-endpoint → wrap, persist the migrated shape, return it.
		const migrated = toServers(rec as LegacySingle);
		saveConfig(migrated, configPath);
		return migrated;
	}
	// v1 upgrade: one-time migration from the old repo-root config.json.
	// Code never deletes the user's file — it just stops reading it once migrated.
	if (existsSync(legacyPath)) {
		try {
			const migrated = toServers(v1ToSingle(JSON.parse(readFileSync(legacyPath, 'utf8'))));
			saveConfig(migrated, configPath);
			return migrated;
		} catch {
			// corrupt legacy file — fall through to a fresh seed (onboarding repairs)
		}
	}
	const seed = { ...defaultConfig };
	saveConfig(seed, configPath);
	return seed;
}

export function saveConfig(cfg: AppConfig, configPath = CONFIG_PATH): void {
	mkdirSync(path.dirname(configPath), { recursive: true });
	writeFileSync(configPath, JSON.stringify(cfg, null, '\t'));
}
