import { json } from '@sveltejs/kit';
import { loadConfig, saveConfig } from '$lib/config';
import type { EndpointConfig } from '$lib/types';

function strip(cfg: EndpointConfig) {
	const { apiKey: _apiKey, ...rest } = cfg;
	return rest;
}

export function GET() {
	return json(strip(loadConfig()));
}

export async function PUT({ request }: { request: Request }) {
	// Partial merge: present fields overwrite, absent fields keep their current
	// value — onboarding step 1 sends only baseUrl+apiKey and must not wipe the
	// cached model list.
	const patch = (await request.json().catch(() => ({}))) as Partial<EndpointConfig>;
	const next = { ...loadConfig(), ...patch };
	if (typeof next.baseUrl !== 'string' || !next.baseUrl.trim()) {
		return json({ error: 'baseUrl must be a non-empty string' }, { status: 400 });
	}
	if (patch.theme !== undefined && patch.theme !== 'light' && patch.theme !== 'dark') {
		return json({ error: 'theme must be "light" or "dark"' }, { status: 400 });
	}
	if (
		patch.sidebarWidth !== undefined &&
		(typeof patch.sidebarWidth !== 'number' || patch.sidebarWidth < 180 || patch.sidebarWidth > 480)
	) {
		return json({ error: 'sidebarWidth must be a number between 180 and 480' }, { status: 400 });
	}
	if (patch.composerHeight !== undefined && (typeof patch.composerHeight !== 'number' || patch.composerHeight < 0)) {
		return json({ error: 'composerHeight must be a non-negative number' }, { status: 400 });
	}
	saveConfig(next);
	return json(strip(next));
}
