import { json } from '@sveltejs/kit';
import { activeServer, loadConfig, saveConfig } from '$lib/config.js';
import { probeVision } from '$lib/probe.js';
import type { ReasoningLevel } from '$lib/types.js';

// Probed individually — the template's accepted set is arbitrary, not a
// prefix: real templates reject 'high' while accepting 'xhigh'. 400/422 =
// that effort isn't in the set; anything else is inconclusive. 'none' is the
// thinking-disabling value 'off' maps to — only sent when probed-accepted.
const EFFORTS: ReasoningLevel[] = ['xhigh', 'high', 'medium', 'low', 'none'];

const PROBE_TIMEOUT_MS = 5000;

// POST { model } → { model, vision, reasoning }. Runs against the active
// server's record. Each capability is probed only when its entry is missing;
// both known → no fetch. Only 200 and 400/422 are conclusive; anything else
// (auth, rate limit, 5xx, timeout) stays null — a transient 4xx must not mark
// a capable model as incapable, and a null is simply re-probed on the next
// model selection. Force re-probes (e.g. after the upstream server changes)
// are the Servers flow's job via /api/servers/validate.
export async function POST({ request }: { request: Request }) {
	const { model } = (await request.json().catch(() => ({}))) as { model?: string };
	if (typeof model !== 'string' || !model) return json({ error: 'model is required' }, { status: 400 });
	const cfg = loadConfig();
	const srv = activeServer(cfg);
	if (!srv) return json({ model, vision: null, reasoning: null }); // no active server — inconclusive
	const visionKnown = !!(srv.vision && model in srv.vision);
	const reasoningKnown = !!(srv.reasoning && model in srv.reasoning);
	if (visionKnown && reasoningKnown)
		return json({ model, vision: srv.vision![model], reasoning: srv.reasoning![model] });

	const probe = async (body: Record<string, unknown>): Promise<number | null> => {
		const ac = new AbortController();
		const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
		try {
			const res = await fetch(`${srv.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					...(srv.apiKey ? { authorization: `Bearer ${srv.apiKey}` } : {})
				},
				signal: ac.signal,
				body: JSON.stringify(body)
			});
			return res.status;
		} catch {
			return null; // network error / timeout → inconclusive
		} finally {
			clearTimeout(timer);
		}
	};

	let vision: boolean | null = null;
	if (!visionKnown) {
		const v = await probeVision(srv.baseUrl, srv.apiKey, model);
		vision = v === undefined ? null : v;
	}

	let reasoning: ReasoningLevel[] | null = null;
	if (!reasoningKnown) {
		const statuses: (number | null)[] = [];
		for (const effort of EFFORTS)
			statuses.push(
				await probe({
					model,
					max_tokens: 1,
					messages: [{ role: 'user', content: '.' }],
					reasoning_effort: effort
				})
			);
		// One non-conclusive probe (auth, 5xx, timeout) taints the whole set —
		// a missing 'low' might just be a 500, and a false [] disables reasoning.
		reasoning = statuses.some((s) => s !== 200 && s !== 400 && s !== 422)
			? null
			: EFFORTS.filter((e, i) => statuses[i] === 200);
	}

	if (vision !== null || reasoning !== null)
		saveConfig({
			...cfg,
			servers: cfg.servers.map((s) =>
				s.id === srv.id
					? {
							...s,
							...(vision !== null ? { vision: { ...s.vision, [model]: vision } } : {}),
							...(reasoning !== null ? { reasoning: { ...s.reasoning, [model]: reasoning } } : {})
						}
					: s
			)
		});
	return json({
		model,
		vision: vision ?? srv.vision?.[model] ?? null,
		reasoning: reasoning ?? srv.reasoning?.[model] ?? null
	});
}
