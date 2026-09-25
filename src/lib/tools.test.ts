import { describe, expect, it } from 'vitest';
import { calculator } from './tools/calculator.js';
import { parseBing, webSearch } from './tools/web-search.js';
import { htmlToText, webFetch } from './tools/web-fetch.js';

describe('calculator', () => {
	it('evaluates arithmetic', () => {
		expect(calculator('6*7').content).toBe('42');
		expect(calculator('(2+3)*4').content).toBe('20');
	});

	it('rejects non-arithmetic input and non-finite results', () => {
		expect(() => calculator('Math.sin(1)')).toThrow();
		expect(() => calculator('process.exit(1)')).toThrow();
		expect(() => calculator('1/0')).toThrow();
	});
});

// u= param is base64url of "https://example.com/page".
const BING_HTML = `<li class="b_algo" data-id="x"><h2 class=""><a target="_blank" href="https://www.bing.com/ck/a?!&amp;ptn=3&amp;u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9wYWdl&amp;ntb=1"><b>Example</b> Title</a></h2><div class="b_caption"><p class="b_lineclamp2" data-rslinkclamp-iid="">A <b>snippet</b> &amp; more</p></div></li>`;

describe('web search', () => {
	it('parses Bing html results and decodes the u= redirect', () => {
		const results = parseBing(BING_HTML);
		expect(results).toHaveLength(1);
		expect(results[0].title).toBe('Example Title');
		expect(results[0].url).toBe('https://example.com/page');
		expect(results[0].snippet).toBe('A snippet & more');
	});

	it('formats results into model content', async () => {
		const fakeFetch = async () => new Response(BING_HTML);
		const r = await webSearch('test query', fakeFetch);
		expect(r.content).toContain('Example Title');
		expect(r.content).toContain('https://example.com/page');
	});
});

describe('web fetch', () => {
	it('strips scripts and tags, decodes entities', () => {
		const text = htmlToText(
			'<script>var x=1</script><p>Hello <b>world</b></p><p>Line 2 &amp; more</p>'
		);
		expect(text).toContain('Hello world');
		expect(text).toContain('Line 2 & more');
		expect(text).not.toContain('var x');
	});

	it('compacts pretty-printed JSON endpoint responses', async () => {
		const fakeFetch = async () => new Response('{\n  "temp": 72,\n  "city": "Philly"\n}');
		const r = await webFetch('https://api.example.com/latest', fakeFetch);
		expect(r.content).toBe('{"temp":72,"city":"Philly"}');
	});

	it('blocks localhost, private and non-http URLs (SSRF guard)', async () => {
		let called = false;
		const fakeFetch = async () => {
			called = true;
			return new Response('x');
		};
		const privateUrls = [
			'http://localhost:3000',
			'http://127.0.0.1/',
			'http://0.0.0.0/',
			'http://[::1]/',
			'http://10.0.0.5/',
			'http://172.16.0.1/',
			'http://192.168.1.1/',
			'http://169.254.169.254/latest',
			'http://[fd12::1]/',
			'file:///etc/passwd',
			'ftp://example.com/x'
		];
		for (const url of privateUrls) {
			called = false;
			await expect(webFetch(url, fakeFetch)).rejects.toThrow();
			expect(called).toBe(false);
		}
		// a public https URL still goes through
		const r = await webFetch('https://example.com/', fakeFetch);
		expect(called).toBe(true);
		expect(r.content).toBeTruthy();
	});
});
