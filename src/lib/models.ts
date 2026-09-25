// Context keys servers use to report a model's window: vLLM/ninfer first, then the
// OpenAI-compatible conventions. First finite positive value wins.
const CONTEXT_KEYS = [
	'max_model_len',
	'max_context',
	'context_length',
	'max_context_length',
	'max_tokens',
	'max_input_tokens'
];

import type { EndpointConfig } from '$lib/types.js';

// Working limit = ceiling × (1 − reserve). Ceiling: the active model's detected
// context, then the configured whole-model ceiling, then a 160K default.
// Pure so both the client (indicator) and server (trim) share one formula.
export function workingContext(cfg: EndpointConfig, model: string): number {
	const ceiling = cfg.modelContext?.[model] ?? cfg.contextWindow ?? 160000;
	return Math.round(ceiling * (1 - (cfg.contextReserve ?? 0.11)));
}

// Pure, so it's unit-testable. Tolerates non-conforming bodies (returns empty).
export function parseModels(body: unknown): { ids: string[]; context: Record<string, number> } {
	const out: { ids: string[]; context: Record<string, number> } = { ids: [], context: {} };
	if (typeof body !== 'object' || body === null) return out;
	const data = (body as { data?: unknown }).data;
	if (!Array.isArray(data)) return out;
	for (const m of data) {
		if (typeof m !== 'object' || m === null) continue;
		const rec = m as Record<string, unknown>;
		if (typeof rec.id !== 'string' || !rec.id) continue;
		out.ids.push(rec.id);
		for (const k of CONTEXT_KEYS) {
			const v = rec[k];
			if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
				out.context[rec.id] = v;
				break;
			}
		}
	}
	return out;
}
