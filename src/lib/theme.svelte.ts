// Module-scope state in a .svelte.ts file (runes enabled). Exposed via a getter
// because the module reassigns it — an exported state binding can't.
// Reads localStorage directly: safe because the page is ssr=false — don't
// enable SSR without moving this.
export type Theme = 'light' | 'dark';

function initial(): Theme {
	try {
		const saved = localStorage.getItem('theme');
		return saved === 'dark' || saved === 'light' ? saved : 'light';
	} catch {
		return 'light';
	}
}

let current = $state<Theme>(initial());

export function getTheme(): Theme {
	return current;
}

export function setTheme(t: Theme) {
	current = t;
	try {
		localStorage.setItem('theme', t);
	} catch {
		/* storage blocked */
	}
	document.documentElement.dataset.theme = t;
}
