<script lang="ts">
	import { api } from '$lib/api.js';
	import { getAccent, setAccent } from '$lib/accent.svelte.js';
	import { workingContext } from '$lib/models.js';
	import type { EndpointConfig } from '$lib/types.js';
	import pkg from '../../../package.json';

	let {
		config,
		onsaved,
		onclose
	}: {
		config: EndpointConfig;
		onsaved: (cfg: EndpointConfig) => void;
		onclose: () => void;
	} = $props();

	let tab = $state<'server' | 'visual'>('server');

	$effect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onclose();
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	});

	// Seeds local state once from the config snapshot it opens with.
	// svelte-ignore state_referenced_locally
	const cfg = config;
	let baseUrl = $state(cfg.baseUrl);
	let apiKey = $state(cfg.apiKey);
	let models = $state<string[]>(cfg.models ?? []);
	let modelContext = $state<Record<string, number>>(cfg.modelContext ?? {});
	let defaultModel = $state(cfg.defaultModel ?? '');
	let reservePct = $state(Math.round((cfg.contextReserve ?? 0.11) * 100));
	let fetchError = $state('');
	let saved = $state(false);
	let busy = $state(false);

	// Context window: ceiling detected from /models for the selected model, reserve
	// is user-tunable, working limit derived — same formula the server trims against.
	const contextCeiling = $derived(modelContext[defaultModel] ?? cfg.contextWindow ?? 160000);
	const contextWorking = $derived(
		workingContext({ ...cfg, modelContext, contextReserve: reservePct / 100 }, defaultModel)
	);

	async function fetchModels() {
		busy = true;
		fetchError = '';
		try {
			const res = await api<{ models: string[]; modelContext: Record<string, number> }>('/api/models');
			models = res.models;
			modelContext = res.modelContext ?? {};
		} catch (e) {
			fetchError = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function save() {
		if (!baseUrl.trim() || busy) return;
		busy = true;
		try {
			// PUT strips apiKey from its response; keep the local value for the parent.
			const cfg = await api<EndpointConfig>('/api/config', {
				method: 'PUT',
				body: JSON.stringify({
					// no `name`: the server-name field was dropped; the key stays inert server-side
					baseUrl: baseUrl.trim(),
					apiKey,
					defaultModel: defaultModel.trim(),
					contextReserve: reservePct / 100
				})
			});
			onsaved({ ...cfg, apiKey });
			saved = true;
			setTimeout(() => (saved = false), 1200);
		} catch (e) {
			fetchError = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	// Visual: 3×5 rainbow-ish grid; includes the default terracotta so a selection is always visible.
	const ACCENTS = [
		'#ff5252', '#ff7a1a', '#ffc93c', '#a3e635', '#22c55e',
		'#2dd4bf', '#38bdf8', '#3b82f6', '#6366f1', '#a855f7',
		'#ec4899', '#ff2d95', '#00ffa3', '#00e5ff', '#d97757'
	];
	let selected = $state(getAccent());

	function pick(hex: string) {
		setAccent(hex);
		selected = hex;
		// persist server-side: survives restarts and new browsers (partial merge keeps the rest)
		void api('/api/config', { method: 'PUT', body: JSON.stringify({ accent: hex }) });
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="modal-overlay" onclick={onclose}>
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="modal" role="dialog" aria-label="Settings" onclick={(e) => e.stopPropagation()}>
		<div class="modal-tabs">
			<button class="tab-btn" class:active={tab === 'server'} onclick={() => (tab = 'server')}>Server</button>
			<button class="tab-btn" class:active={tab === 'visual'} onclick={() => (tab = 'visual')}>Visual</button>
			<button class="icon-btn" aria-label="Close settings" onclick={onclose}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
			</button>
		</div>

		{#if tab === 'server'}
			<div class="modal-panel">
				<label class="field">
					Base URL
					<input bind:value={baseUrl} placeholder="http://localhost:8080/v1" spellcheck="false" />
				</label>
				<label class="field">
					API key <span class="hint">(optional)</span>
					<input type="password" bind:value={apiKey} placeholder="not required" />
				</label>

				<div class="models-section">
					<div class="models-head">
						<span>Models</span>
						<button class="btn-ghost small" disabled={busy} onclick={fetchModels}>
							{busy ? 'Fetching…' : 'Fetch models'}
						</button>
					</div>
					{#if models.length}
						<div class="models-list">
							{#each models as m (m)}
								<button class="model-row" class:current={m === defaultModel} onclick={() => (defaultModel = m)}>{m}</button>
							{/each}
						</div>
					{:else}
						<p class="sub">No cached models — fetch them.</p>
					{/if}
					{#if fetchError}
						<p class="onboard-error">{fetchError}</p>
					{/if}
				</div>

				<div class="models-section">
					<span class="models-head">Context window</span>
					<p class="sub">
						Detected {contextCeiling.toLocaleString('en-US')} tokens — working limit
						{contextWorking.toLocaleString('en-US')}
					</p>
					<label class="field">
						Reserve for output <span class="hint">(%, trimmed automatically above this)</span>
						<input type="number" min="0" max="90" bind:value={reservePct} />
					</label>
				</div>

				<div class="onboard-actions">
					<button class="btn-ghost" onclick={onclose}>Cancel</button>
					<button class="btn-primary" disabled={!baseUrl.trim() || busy} onclick={save}>
						{saved ? '✓ Saved' : 'Save'}
					</button>
				</div>
			</div>
		{:else}
			<div class="modal-panel">
				<label class="field">
					Accent color
					<div class="accent-grid">
						{#each ACCENTS as hex (hex)}
							<button
								class="accent-dot"
								class:selected={hex === selected}
								style="background:{hex}"
								aria-label="Accent {hex}"
								title={hex}
								onclick={() => pick(hex)}
							></button>
						{/each}
					</div>
				</label>
				<p class="version">Litechat v{pkg.version}</p>
			</div>
		{/if}
	</div>
</div>
