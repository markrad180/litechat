import { json } from '@sveltejs/kit';
import { loadConfig } from '$lib/config.js';
import { parseModels } from '$lib/models.js';
import { probeAllVision } from '$lib/probe.js';

// Pure test + probe, no persistence: fetch /models (the "validate a successful
// response" step) and force-reprobe vision for every model — cache or no cache.
// The caller (the Servers flow) persists via PUT /api/config. Body:
// { baseUrl, apiKey?, serverId? } — key: explicit → stored key of serverId → none.
export async function POST({ request }: { request: Request }) {
	const body = (await request.json().catch(() => ({}))) as { baseUrl?: string; apiKey?: string; serverId?: string };
	if (typeof body.baseUrl !== 'string' || !body.baseUrl.trim())
		return json({ error: 'baseUrl is required' }, { status: 400 });
	const stored = body.serverId ? loadConfig().servers.find((s) => s.id === body.serverId) : undefined;
	const apiKey = (typeof body.apiKey === 'string' && body.apiKey) || stored?.apiKey || '';
	const base = body.baseUrl.replace(/\/+$/, '');
	let parsed: { ids: string[]; context: Record<string, number> };
	try {
		const res = await fetch(`${base}/models`, {
			headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
			signal: AbortSignal.timeout(10_000)
		});
		if (!res.ok) return json({ error: `Server returned HTTP ${res.status}` }, { status: 502 });
		parsed = parseModels(await res.json());
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
	}
	const vision = await probeAllVision(base, apiKey, parsed.ids);
	return json({ models: parsed.ids, modelContext: parsed.context, vision });
}
