// ponytail: DuckDuckGo's keyless non-JS HTML endpoint — no API key, no config.
// Upgrade path: a keyed provider (Brave) if DDG ever rate-limits.

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

export function parseDdg(html: string): SearchResult[] {
	const results: SearchResult[] = [];
	// Each organic result: <a class="result__a" href="…">Title</a>, with the
	// snippet in a <a class="result__snippet"> anchor inside the same result div.
	for (const block of html.split(/class="result__a"/).slice(1)) {
		const href = block.match(/href="([^"]+)"/);
		if (!href) continue;
		const title = block.match(/>([\s\S]*?)<\/a>/);
		const snip = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
		results.push({
			title: stripTags(title?.[1] ?? ''),
			url: decodeDdgUrl(href[1]),
			snippet: snip ? stripTags(snip[1]) : ''
		});
	}
	return results;
}

// DDG wraps result URLs in a redirect whose `uddg` param is the URL-encoded target.
export function decodeDdgUrl(href: string): string {
	try {
		const clean = href.replaceAll('&amp;', '&');
		const u = new URL(clean, 'https://duckduckgo.com');
		if (u.hostname.endsWith('duckduckgo.com') && u.pathname === '/l/') {
			const target = u.searchParams.get('uddg');
			if (target) return target;
		}
		return u.toString();
	} catch {
		return href;
	}
}

function stripTags(s: string): string {
	return s
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&#x27;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&nbsp;/g, ' ')
		.replace(/&#183;/g, '·')
		.trim();
}

// Display-only: reverse the model-facing format (numbered blocks joined by a blank line)
// into structured rows for the UI. Returns null when the content doesn't match (error
// strings, provider notes) so the caller can fall back to the raw text.
export function parseSearchContent(content: string): SearchResult[] | null {
	const out: SearchResult[] = [];
	for (const block of content.split('\n\n')) {
		const m = block.match(/^\d+\.\s(.+?)\n   (\S+)\n   ([\s\S]*)$/);
		if (!m) return null;
		out.push({ title: m[1], url: m[2], snippet: m[3].trim() });
	}
	return out.length ? out : null;
}

// Search can stall forever — cap it, and honor the turn's stop signal.
const SEARCH_TIMEOUT_MS = 30_000;

export async function webSearch(
	query: string,
	fetchImpl: typeof fetch = fetch,
	signal?: AbortSignal
): Promise<{ summary: string; content: string }> {
	const res = await fetchImpl(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
		headers: {
			// A full browser header set — DDG's anomaly detection 202s bare requests.
			'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Version/17.4 Safari/537.36',
			accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			'accept-language': 'en-US,en;q=0.9',
			referer: 'https://duckduckgo.com/'
		},
		signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]) : AbortSignal.timeout(SEARCH_TIMEOUT_MS)
	});
	if (!res.ok) throw new Error(`search failed with HTTP ${res.status}`);
	const html = await res.text();
	const results = parseDdg(html).slice(0, 5);
	if (results.length === 0) {
		// A block/challenge page also parses to zero results — don't report a false "no results".
		if (/anomaly|challenge|captcha/i.test(html)) throw new Error('search provider blocked the request');
		return { summary: `no results for "${query}"`, content: `No results found for "${query}".` };
	}
	const content = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n');
	return { summary: `${results.length} results for "${query}"`, content };
}
