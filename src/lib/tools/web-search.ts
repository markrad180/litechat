// ponytail: regex-scraping Bing's HTML results page — fragile if Bing changes its markup.
// Upgrade path: a keyed provider (Brave/Serper) selected from config.json.

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

export function parseBing(html: string): SearchResult[] {
	const results: SearchResult[] = [];
	// Each organic result is an <li class="b_algo"> block: title in the <h2><a>,
	// snippet in a b_lineclamp paragraph.
	for (const block of html.split(/<li class="b_algo"/).slice(1)) {
		const h2 = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
		if (!h2) continue;
		const snip = block.match(/<p class="b_lineclamp\d*"[^>]*>([\s\S]*?)<\/p>/i);
		results.push({
			title: stripTags(h2[2]),
			url: decodeBingUrl(h2[1]),
			snippet: snip ? stripTags(snip[1]) : ''
		});
	}
	return results;
}

// Bing wraps result URLs in a redirect whose `u` param is base64url of the real URL.
export function decodeBingUrl(href: string): string {
	try {
		const clean = href.replaceAll('&amp;', '&');
		const u = new URL(clean).searchParams.get('u');
		if (u?.startsWith('a1')) {
			const b64 = u.slice(2).replace(/-/g, '+').replace(/_/g, '/');
			const decoded = Buffer.from(b64, 'base64').toString('utf8');
			if (decoded) return decoded;
		}
		return new URL(clean).toString();
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

export async function webSearch(
	query: string,
	fetchImpl: typeof fetch = fetch
): Promise<{ summary: string; content: string }> {
	const res = await fetchImpl(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
		headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
	});
	if (!res.ok) throw new Error(`search failed with HTTP ${res.status}`);
	const results = parseBing(await res.text()).slice(0, 5);
	if (results.length === 0) {
		return { summary: `no results for "${query}"`, content: `No results found for "${query}".` };
	}
	const content = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n');
	return { summary: `${results.length} results for "${query}"`, content };
}
