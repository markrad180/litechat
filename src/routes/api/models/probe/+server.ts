import { json } from '@sveltejs/kit';
import { loadConfig, saveConfig } from '$lib/config.js';
import type { ReasoningLevel } from '$lib/types.js';

// 16×16 solid PNG (79 bytes): the vision probe payload. Servers that accept image
// content answer 200; those that can't reject with 4xx.
const TINY_PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGO4Y2NDEmIY1TCqYfhqAABhl1QQ50OvrwAAAABJRU5ErkJggg==';

// Probed individually — the template's accepted set is arbitrary, not a
// prefix: real templates reject 'high' while accepting 'xhigh'. 400/422 =
// that effort isn't in the set; anything else is inconclusive.
const EFFORTS: ReasoningLevel[] = ['xhigh', 'high', 'medium', 'low'];

const PROBE_TIMEOUT_MS = 5000;

// POST { model } → { model, vision, reasoning }. Each capability is probed only
// when its config entry is missing; both known → no fetch. Only 200 and 400/422
// are conclusive; anything else (auth, rate limit, 5xx, timeout) stays null —
// a transient 4xx must not mark a capable model as incapable, and a null is
// simply re-probed on the next model selection. Each probe is ~100-200 prompt
// tokens + 1 completion token — negligible, run at most once per model per
// endpoint. Hand-edited config values always win (missing entries only).
export async function POST({ request }: { request: Request }) {
	const { model } = (await request.json().catch(() => ({}))) as { model?: string };
	if (typeof model !== 'string' || !model) return json({ error: 'model is required' }, { status: 400 });
	const cfg = loadConfig();
	const visionKnown = !!(cfg.vision && model in cfg.vision);
	const reasoningKnown = !!(cfg.reasoning && model in cfg.reasoning);
	if (visionKnown && reasoningKnown)
		return json({ model, vision: cfg.vision![model], reasoning: cfg.reasoning![model] });
	if (!cfg.baseUrl) return json({ model, vision: null, reasoning: null }); // unconfigured endpoint — inconclusive

	const probe = async (body: Record<string, unknown>): Promise<number | null> => {
		const ac = new AbortController();
		const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
		try {
			const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {})
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
		const status = await probe({
			model,
			max_tokens: 1,
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'text', text: '.' },
						{ type: 'image_url', image_url: { url: TINY_PNG } }
					]
				}
			]
		});
		vision = status === 200 ? true : status === 400 || status === 422 ? false : null;
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
			...(vision !== null ? { vision: { ...cfg.vision, [model]: vision } } : {}),
			...(reasoning !== null ? { reasoning: { ...cfg.reasoning, [model]: reasoning } } : {})
		});
	return json({
		model,
		vision: vision ?? cfg.vision?.[model] ?? null,
		reasoning: reasoning ?? cfg.reasoning?.[model] ?? null
	});
}
