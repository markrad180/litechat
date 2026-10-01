import { json } from '@sveltejs/kit';
import { loadConfig, saveConfig } from '$lib/config';
import type { AppConfig, ServerConfig } from '$lib/types';

// Keys never cross the wire: GET strips them (the key is absent from the JSON),
// PUT inherits the stored key by server id, so the stripped round-trip can't
// wipe a key the client doesn't have.
function strip(cfg: AppConfig): AppConfig {
	return { ...cfg, servers: cfg.servers.map(({ apiKey: _apiKey, ...rest }) => rest as ServerConfig) };
}

export function GET() {
	return json(strip(loadConfig()));
}

// Whole-config write: the client owns the servers list (add = append, delete =
// remove + fix activeServerId, select = set it, refresh = overwrite the
// record's models/modelContext/vision). Missing pieces fall back to the stored
// config, so a partial app-level patch can't wipe the server list.
export async function PUT({ request }: { request: Request }) {
	const patch = (await request.json().catch(() => ({}))) as Partial<AppConfig>;
	const prev = loadConfig();
	const servers: ServerConfig[] = (Array.isArray(patch.servers) ? patch.servers : prev.servers).map((s) => {
		const stored = prev.servers.find((p) => p.id === s?.id);
		return {
			...s,
			// Key inheritance: the client sends '' (it never sees keys) — restore the stored one.
			apiKey: (typeof s.apiKey === 'string' && s.apiKey) || stored?.apiKey || ''
		};
	});
	const next: AppConfig = {
		servers,
		activeServerId: patch.activeServerId === undefined ? (prev.activeServerId ?? null) : patch.activeServerId,
		accent: patch.accent !== undefined ? patch.accent : (prev.accent ?? ''),
		theme: patch.theme !== undefined ? patch.theme : (prev.theme ?? 'light'),
		...(patch.sidebarWidth !== undefined ? { sidebarWidth: patch.sidebarWidth } : {}),
		...(patch.composerHeight !== undefined ? { composerHeight: patch.composerHeight } : {}),
		...(patch.contextReserve !== undefined ? { contextReserve: patch.contextReserve } : {})
	};
	for (const s of next.servers) {
		if (typeof s.id !== 'string' || !s.id.trim())
			return json({ error: 'each server needs a non-empty id' }, { status: 400 });
		if (typeof s.baseUrl !== 'string' || !s.baseUrl.trim())
			return json({ error: 'each server needs a non-empty baseUrl' }, { status: 400 });
	}
	if (new Set(next.servers.map((s) => s.id)).size !== next.servers.length)
		return json({ error: 'server ids must be unique' }, { status: 400 });
	if (next.activeServerId !== null && !next.servers.some((s) => s.id === next.activeServerId))
		return json({ error: 'activeServerId must be a server id or null' }, { status: 400 });
	if (next.theme !== 'light' && next.theme !== 'dark')
		return json({ error: 'theme must be "light" or "dark"' }, { status: 400 });
	if (next.sidebarWidth !== undefined && (typeof next.sidebarWidth !== 'number' || next.sidebarWidth < 180 || next.sidebarWidth > 480))
		return json({ error: 'sidebarWidth must be a number between 180 and 480' }, { status: 400 });
	if (next.composerHeight !== undefined && (typeof next.composerHeight !== 'number' || next.composerHeight < 0))
		return json({ error: 'composerHeight must be a non-negative number' }, { status: 400 });
	if (next.contextReserve !== undefined && (typeof next.contextReserve !== 'number' || next.contextReserve < 0 || next.contextReserve > 0.9))
		return json({ error: 'contextReserve must be a number between 0 and 0.9' }, { status: 400 });
	saveConfig(next);
	return json(strip(next));
}
