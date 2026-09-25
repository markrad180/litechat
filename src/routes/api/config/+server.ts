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
	saveConfig(next);
	return json(strip(next));
}
