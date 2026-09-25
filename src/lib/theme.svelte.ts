// Module-scope state in a .svelte.ts file (runes enabled). Exposed via a getter
// because the module reassigns it — an exported state binding can't.
// The on-disk config is the source of truth: +page.ts applies the stored theme
// before first render, and callers persist changes with PUT /api/config.
export type Theme = 'light' | 'dark';

let current = $state<Theme>('light');

export function getTheme(): Theme {
	return current;
}

export function setTheme(t: Theme) {
	current = t;
	document.documentElement.dataset.theme = t;
}
