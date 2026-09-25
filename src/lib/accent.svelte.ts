// Module-scope state in a .svelte.ts file (runes enabled), mirroring theme.svelte.ts.
// Exposed via a getter because the module reassigns it. Applied to :root pre-hydration,
// so there's no flash. Reads localStorage directly: the page is ssr=false.
export function getAccent(): string {
	return current;
}

let current = $state(initial());

function initial(): string {
	try {
		return localStorage.getItem('accent') ?? '';
	} catch {
		return '';
	}
}

// WCAG relative luminance → readable text color for the accent bubble.
function contrastFor(hex: string): string {
	const m = hex.replace('#', '');
	const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
	const l =
		0.2126 * lin(parseInt(m.slice(0, 2), 16) / 255) +
		0.7152 * lin(parseInt(m.slice(2, 4), 16) / 255) +
		0.0722 * lin(parseInt(m.slice(4, 6), 16) / 255);
	return l > 0.4 ? '#1a1a1a' : '#ffffff';
}

export function setAccent(hex: string) {
	current = hex;
	try {
		if (hex) localStorage.setItem('accent', hex);
		else localStorage.removeItem('accent');
	} catch {
		/* storage blocked */
	}
	const root = document.documentElement;
	if (hex) {
		root.style.setProperty('--accent', hex);
		root.style.setProperty('--accent-contrast', contrastFor(hex));
	} else {
		root.style.removeProperty('--accent'); // fall back to the :root default
		root.style.removeProperty('--accent-contrast');
	}
}
