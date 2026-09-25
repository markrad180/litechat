import type { PageLoad } from './$types';
import type { EndpointConfig } from '$lib/types.js';
import { setTheme } from '$lib/theme.svelte.js';
import { setAccent } from '$lib/accent.svelte.js';

export const ssr = false;

// The on-disk config is the single source of truth for all settings. load() runs
// client-side (ssr = false) before the first render, so the stored theme/accent
// apply with no flash and no browser-storage cache.
export const load: PageLoad = async ({ fetch }) => {
	// A corrupt config.json 500s with an HTML body — don't brick the page:
	// fall through to onboarding, where the endpoint can be re-entered.
	let cfg: EndpointConfig;
	try {
		const res = await fetch('/api/config');
		cfg = (await res.json()) as EndpointConfig;
	} catch {
		return { config: null };
	}

	// One-time migration: prefs that used to live in browser localStorage are
	// seeded into the config once, then the legacy keys are dropped. (The server
	// can't read localStorage, so this runs here.)
	const migrated: Partial<EndpointConfig> = {};
	try {
		const lt = localStorage.getItem('theme');
		if (!cfg.theme && (lt === 'light' || lt === 'dark')) migrated.theme = lt;
		const la = localStorage.getItem('accent');
		if (!cfg.accent && la) migrated.accent = la;
	} catch {
		/* storage blocked */
	}
	if (Object.keys(migrated).length) {
		await fetch('/api/config', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(migrated)
		}).catch(() => {});
		Object.assign(cfg, migrated);
	}
	try {
		for (const k of ['theme', 'accent', 'litechat.sidebarWidth', 'litechat.composerHeight'])
			localStorage.removeItem(k);
	} catch {
		/* storage blocked */
	}

	setTheme(cfg.theme === 'dark' ? 'dark' : 'light');
	setAccent(cfg.accent ?? '');

	return { config: cfg };
};
