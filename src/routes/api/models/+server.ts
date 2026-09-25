import { json } from '@sveltejs/kit';
import { loadConfig, saveConfig } from '$lib/config';
import { parseModels } from '$lib/models.js';
import type { EndpointConfig } from '$lib/types';

async function fetchModels(cfg: EndpointConfig) {
	const res = await fetch(cfg.baseUrl.replace(/\/+$/, '') + '/models', {
		headers: cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {},
		signal: AbortSignal.timeout(10_000)
	});
	if (!res.ok) throw new Error(`upstream returned HTTP ${res.status}`);
	return parseModels(await res.json());
}

export async function GET() {
	const cfg = loadConfig();
	if (!cfg.baseUrl) return json({ error: 'baseUrl not configured' }, { status: 502 });
	try {
		const { ids, context } = await fetchModels(cfg);
		saveConfig({ ...cfg, models: ids, modelContext: context }); // offline picker cache + detected ceilings
		return json({ models: ids, modelContext: context });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
	}
}
