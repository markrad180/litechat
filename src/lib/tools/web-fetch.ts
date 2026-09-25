const MAX_CHARS = 8000;

export function htmlToText(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|h[1-6]|li|tr|pre)>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&#x27;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

// The model decides which URLs to fetch, so a page we fetched earlier can
// prompt-inject it into probing the local network (SSRF). Block non-http(s)
// schemes and localhost / private / link-local addresses.
function assertPublicUrl(url: string): void {
	const u = new URL(url);
	if (u.protocol !== 'http:' && u.protocol !== 'https:') {
		throw new Error(`unsupported URL scheme: ${u.protocol}`);
	}
	let h = u.hostname; // IPv6 literals may arrive bracketed, e.g. "[::1]"
	if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
	if (h === 'localhost' || h === '0.0.0.0' || h === '::' || h === '::1') {
		throw new Error('fetching localhost is blocked');
	}
	const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
	if (m) {
		const a = Number(m[1]);
		const b = Number(m[2]);
		if (
			a === 127 ||
			a === 10 ||
			a === 0 ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 169 && b === 254)
		) {
			throw new Error('fetching private/link-local addresses is blocked');
		}
	}
	if (h.includes(':') && /^(fc|fd)/i.test(h)) {
		throw new Error('fetching private/link-local addresses is blocked');
	}
}

// A page load can stall forever — cap it, and honor the turn's stop signal.
const FETCH_TIMEOUT_MS = 30_000;

export async function webFetch(
	url: string,
	fetchImpl: typeof fetch = fetch,
	signal?: AbortSignal
): Promise<{ summary: string; content: string }> {
	assertPublicUrl(url);
	const res = await fetchImpl(url, {
		headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
		signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) : AbortSignal.timeout(FETCH_TIMEOUT_MS)
	});
	if (!res.ok) throw new Error(`fetch failed with HTTP ${res.status}`);
	const body = await res.text();
	let text = htmlToText(body);
	// JSON endpoints (api.weather.gov & co) are pretty-printed; the whitespace drowns small
	// models and burns tool rounds — re-serialize compact.
	const t = body.trim();
	if (t.startsWith('{') || t.startsWith('[')) {
		try {
			text = JSON.stringify(JSON.parse(body));
		} catch {
			/* not JSON — keep the stripped text */
		}
	}
	if (!text) throw new Error('page had no readable text');
	const truncated = text.length > MAX_CHARS;
	return {
		summary: `fetched ${url}${truncated ? ` (first ${MAX_CHARS} chars)` : ''}`,
		content: truncated ? text.slice(0, MAX_CHARS) : text
	};
}
