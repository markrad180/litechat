// 16×16 solid PNG (79 bytes): the vision probe payload. Servers that accept image
// content answer 200; those that can't reject with 4xx.
export const TINY_PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGO4Y2NDEmIY1TCqYfhqAABhl1QQ50OvrwAAAABJRU5ErkJggg==';

const PROBE_TIMEOUT_MS = 5000;

// 200 → true, 400/422 → false, anything else (auth, rate limit, 5xx, timeout) →
// undefined: inconclusive. A transient 4xx must not mark a capable model as
// incapable, and an inconclusive result is simply unprobed.
export async function probeVision(baseUrl: string, apiKey: string, model: string): Promise<boolean | undefined> {
	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
	try {
		const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
			},
			signal: ac.signal,
			body: JSON.stringify({
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
			})
		});
		return res.status === 200 ? true : res.status === 400 || res.status === 422 ? false : undefined;
	} catch {
		return undefined; // network error / timeout → inconclusive
	} finally {
		clearTimeout(timer);
	}
}

// ponytail: 4-way parallel, sequential within a worker — raise the batch if the
// upstream rate-limits. Inconclusive models are omitted (missing = unprobed).
export async function probeAllVision(baseUrl: string, apiKey: string, models: string[]): Promise<Record<string, boolean>> {
	const out: Record<string, boolean> = {};
	let i = 0;
	const worker = async () => {
		while (i < models.length) {
			const model = models[i++];
			const v = await probeVision(baseUrl, apiKey, model);
			if (v !== undefined) out[model] = v;
		}
	};
	await Promise.all(Array.from({ length: 4 }, worker));
	return out;
}
