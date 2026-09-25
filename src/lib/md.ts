import { Marked } from 'marked';
import hljs from 'highlight.js';

const md = new Marked({ gfm: true, breaks: true });

md.use({
	renderer: {
		code(token) {
			const { text, lang } = token;
			const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
			const highlighted = hljs.highlight(text, { language }).value;
			return `<pre class="code-block"><button class="copy-btn" type="button" title="Copy code">copy</button><code class="hljs language-${language}">${highlighted}</code></pre>\n`;
		}
	}
});

export function renderMarkdown(source: string): string {
	return md.parse(source ?? '') as string;
}
