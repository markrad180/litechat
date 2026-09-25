import { Marked } from 'marked';
import hljs from 'highlight.js';

const COPY_ICON =
	'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>';

const md = new Marked({ gfm: true, breaks: true });

md.use({
	renderer: {
		code(token) {
			const { text, lang } = token;
			const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
			const highlighted = hljs.highlight(text, { language }).value;
			return `<pre class="code-block"><button class="copy-btn" type="button" aria-label="Copy code">${COPY_ICON}</button><code class="hljs language-${language}">${highlighted}</code></pre>\n`;
		}
	}
});

export function renderMarkdown(source: string): string {
	return md.parse(source ?? '') as string;
}
