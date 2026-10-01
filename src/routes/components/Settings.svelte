<script lang="ts">
	import { api } from '$lib/api.js';
	import { getAccent, setAccent } from '$lib/accent.svelte.js';
	import type { AppConfig } from '$lib/types.js';

	let {
		config,
		onmanage,
		onsaved,
		onclose
	}: {
		config: AppConfig | null;
		onmanage: () => void; // opens the full-screen server flow
		onsaved: (cfg: AppConfig) => void;
		onclose: () => void;
	} = $props();

	$effect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onclose();
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	});

	let tab = $state<'servers' | 'visual'>('servers');

	// Universal context reserve (%), not per-server. Committed on blur/Enter, not
	// per keystroke.
	// svelte-ignore state_referenced_locally
	let reservePct = $state(Math.round((config?.contextReserve ?? 0.11) * 100)); // re-seeded by the effect below
	$effect(() => {
		void config?.contextReserve;
		reservePct = Math.round((config?.contextReserve ?? 0.11) * 100);
	});

	function commitReserve() {
		const pct = Math.round(Math.max(0, Math.min(90, Number.isNaN(reservePct) ? 11 : reservePct)));
		reservePct = pct;
		// The PUT response is the fresh config — hand it up so the app never runs a stale copy.
		void api<AppConfig>('/api/config', { method: 'PUT', body: JSON.stringify({ contextReserve: pct / 100 }) })
			.then((cfg) => onsaved(cfg))
			.catch(() => {});
	}

	// Visual: 3×5 rainbow-ish grid; includes the default azure so a selection is always visible.
	const ACCENTS = [
		{ hex: '#dc143c', name: 'Crimson' },
		{ hex: '#ff5252', name: 'Scarlet' },
		{ hex: '#f43f5e', name: 'Rose' },
		{ hex: '#ff6f61', name: 'Coral' },
		{ hex: '#ff8c7a', name: 'Salmon' },
		{ hex: '#d97757', name: 'Terracotta' },
		{ hex: '#ff7a1a', name: 'Orange' },
		{ hex: '#ff9f43', name: 'Tangerine' },
		{ hex: '#ffc0a1', name: 'Peach' },
		{ hex: '#ffc93c', name: 'Amber' },
		{ hex: '#f5c518', name: 'Gold' },
		{ hex: '#e8f542', name: 'Lemon' },
		{ hex: '#a3e635', name: 'Lime' },
		{ hex: '#7fff00', name: 'Chartreuse' },
		{ hex: '#22c55e', name: 'Green' },
		{ hex: '#10b981', name: 'Emerald' },
		{ hex: '#00ffa3', name: 'Mint' },
		{ hex: '#2dd4bf', name: 'Teal' },
		{ hex: '#40e0d0', name: 'Turquoise' },
		{ hex: '#00e5ff', name: 'Cyan' },
		{ hex: '#38bdf8', name: 'Sky' },
		{ hex: '#007fff', name: 'Azure' },
		{ hex: '#3b82f6', name: 'Blue' },
		{ hex: '#2c3e70', name: 'Navy' },
		{ hex: '#6366f1', name: 'Indigo' },
		{ hex: '#7c3aed', name: 'Violet' },
		{ hex: '#a855f7', name: 'Purple' },
		{ hex: '#c58af9', name: 'Lavender' },
		{ hex: '#ec4899', name: 'Pink' },
		{ hex: '#ff2d95', name: 'Magenta' }
	];
	let selected = $state(getAccent());

	async function pick(hex: string) {
		setAccent(hex);
		selected = hex;
		// The PUT response is the fresh config — hand it up so the app never runs a stale copy.
		const cfg = await api<AppConfig>('/api/config', { method: 'PUT', body: JSON.stringify({ accent: hex }) }).catch(() => null);
		if (cfg) onsaved(cfg);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="modal-overlay" onclick={onclose}>
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="modal" role="dialog" aria-label="Settings" onclick={(e) => e.stopPropagation()}>
		<div class="modal-tabs">
			<span class="modal-title">Settings</span>
			<button class="icon-btn" aria-label="Close settings" onclick={onclose}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
			</button>
		</div>
		<div class="settings-tabs">
			<button class="tab-btn" class:active={tab === 'servers'} onclick={() => (tab = 'servers')}>Servers</button>
			<button class="tab-btn" class:active={tab === 'visual'} onclick={() => (tab = 'visual')}>Visual</button>
		</div>
		{#if tab === 'servers'}
			<div class="modal-panel">
				<button class="btn-primary" onclick={onmanage}>Manage servers</button>
				<label class="field">
					Context reserve
					<span class="reserve-row">
						<input
							type="number"
							min="0"
							max="90"
							bind:value={reservePct}
							onblur={commitReserve}
							onkeydown={(e) => e.key === 'Enter' && commitReserve()}
						/>
						<span class="unit">%</span>
					</span>
				</label>
				<p class="settings-hint">Kept free of every server’s context window for output. Applies to all servers. (Default 11%)</p>
			</div>
		{:else}
			<div class="modal-panel">
				<!-- div, not label: a label wrapping the grid forwards hover/click
				 to its first control (the first dot) in Safari — the whole grid
				 area would hover the first dot. -->
				<div class="field">
					Accent color
					<div class="accent-grid">
						{#each ACCENTS as { hex, name } (hex)}
							<button
								class="accent-dot"
								class:selected={hex === selected}
								style="background:{hex}"
								aria-label="Accent {name}"
								data-tip="{name} ({hex})"
								onclick={() => pick(hex)}
							></button>
						{/each}
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>
