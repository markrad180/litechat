<script lang="ts">
	import { api } from '$lib/api.js';
	import type { AppConfig, ServerConfig } from '$lib/types.js';

	let {
		config,
		required = false,
		onchange,
		onclose
	}: {
		config: AppConfig;
		required?: boolean; // required = full-screen gate (no servers / no active), not closable
		onchange: (cfg: AppConfig) => void; // the parent persists the new config (PUT) and re-renders
		onclose?: () => void;
	} = $props();

	function hostOf(u: string) {
		try {
			return new URL(u).host;
		} catch {
			return '';
		}
	}

	type ValidateResult = { models: string[]; modelContext?: Record<string, number>; vision?: Record<string, boolean> };

	// Add form — validates (upstream /models + vision probes) before the server
	// exists; a failed validate persists nothing, the form just stays open.
	let name = $state('');
	let baseUrl = $state('');
	let apiKey = $state('');
	// Re-arm gate: after a validate (Test or Add) the buttons stay disabled until
	// the baseUrl/apiKey text changes — re-probing an unchanged config is pure
	// probe burn (one vision call per model on the server).
	let validatedKey = $state('');
	const canValidate = $derived(!!baseUrl.trim() && validatedKey !== `${baseUrl.trim()}\u0000${apiKey}`);
	let busy = $state(false);
	// One universal error line: the last failed Test *or* Add. Cleared by a field
	// change (the error's config is stale), a new attempt, or Cancel.
	let formError = $state('');

	// Test: the same validate Add runs, shown inline — nothing is persisted, no
	// default model is set. Editing the URL/key makes the result and error stale.
	let testing = $state(false);
	let testResult = $state<ValidateResult | null>(null);
	$effect(() => {
		void baseUrl;
		void apiKey;
		testResult = null;
		formError = '';
	});

	function fmtCtx(n: number | undefined) {
		if (!n) return '';
		return n >= 1_000_000 ? `${Math.round(n / 1_000_000)}M` : `${Math.round(n / 1000)}k`;
	}

	async function testConfig() {
		if (!baseUrl.trim() || testing) return;
		testing = true;
		testResult = null;
		formError = '';
		try {
			testResult = await api<ValidateResult>('/api/servers/validate', {
				method: 'POST',
				body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey })
			});
		} catch (e) {
			formError = e instanceof Error ? e.message : String(e);
		} finally {
			testing = false;
			validatedKey = `${baseUrl.trim()}\u0000${apiKey}`;
		}
	}

	// Per-tile refresh: force re-probe (the stale-state fix) and overwrite the
	// record's models/modelContext/vision from the live server.
	let refreshing = $state<string | null>(null);
	let tileError = $state<Record<string, string>>({});
	let pendingDelete = $state<string | null>(null);

	const activeSrv = $derived(config.servers.find((s) => s.id === config.activeServerId) ?? null);
	// The add form is hidden behind the “+” tile in panel mode; always open in
	// required mode (first run, nothing to show).
	let adding = $state(false);

	function visionCount(s: ServerConfig) {
		return Object.values(s.vision ?? {}).filter(Boolean).length;
	}

	function visionCountOf(v: ValidateResult) {
		return Object.values(v.vision ?? {}).filter(Boolean).length;
	}

	async function add() {
		if (!baseUrl.trim() || busy) return;
		busy = true;
		formError = '';
		try {
			const v = await api<ValidateResult>('/api/servers/validate', {
				method: 'POST',
				body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey })
			});
			const server: ServerConfig = {
				id: crypto.randomUUID(),
				name: name.trim() || hostOf(baseUrl.trim()) || 'Server',
				baseUrl: baseUrl.trim(),
				apiKey,
				models: v.models,
				...(v.modelContext ? { modelContext: v.modelContext } : {}),
				...(v.vision ? { vision: v.vision } : {})
			};
			onchange({
				...config,
				servers: [...config.servers, server],
				// adding never steals the active server — only an empty selection gets it
				activeServerId: config.activeServerId ?? server.id
			});
			adding = false; // the new tile takes the form's place
			name = '';
			baseUrl = '';
			apiKey = '';
		} catch (e) {
			formError = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
			validatedKey = `${baseUrl.trim()}\u0000${apiKey}`;
		}
	}

	async function refresh(s: ServerConfig) {
		if (refreshing) return;
		refreshing = s.id;
		tileError = { ...tileError, [s.id]: '' };
		try {
			const v = await api<ValidateResult>('/api/servers/validate', {
				// serverId → the server's stored key is used (the client never sees it)
				method: 'POST',
				body: JSON.stringify({ baseUrl: s.baseUrl, serverId: s.id })
			});
			onchange({
				...config,
				servers: config.servers.map((x) => (x.id === s.id ? { ...x, models: v.models, modelContext: v.modelContext, vision: v.vision } : x))
			});
		} catch (e) {
			// the record stays as-is; the tile shows the reason
			tileError = { ...tileError, [s.id]: e instanceof Error ? e.message : String(e) };
		} finally {
			refreshing = null;
		}
	}

	// Cancel hides the form — clear the fields and re-arm the gate so reopening
	// starts clean. (Closing the whole panel unmounts the component and resets
	// everything for free; testResult/formError follow the field clear via the
	// existing $effect.)
	function cancelAdd() {
		name = '';
		baseUrl = '';
		apiKey = '';
		formError = '';
		validatedKey = '';
		adding = false;
	}

	function activate(id: string) {
		onchange({ ...config, activeServerId: id });
	}

	function confirmRemove() {
		const id = pendingDelete!;
		pendingDelete = null;
		onchange({
			...config,
			servers: config.servers.filter((s) => s.id !== id),
			activeServerId: config.activeServerId === id ? null : config.activeServerId
		});
	}

	$effect(() => {
		if (required) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onclose?.();
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="server-flow">
	{#if !required}
		<button class="icon-btn flow-close" aria-label="Close servers" title="Close" onclick={onclose}>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
		</button>
	{/if}
	<div class="server-flow-inner">
		<svg class="logo" viewBox="2000 800 2250 3500" fill="currentColor" aria-hidden="true">
			<path d="M2902.22 4281.01 c-389.40 -53.10 -691.53 -289.92 -811.77 -637.21 -26.25 -76.29 -37.84 -128.17 -43.33 -194.70 l-4.27 -49.44 21.97 0 c16.48 0 23.80 3.66 29.30 14.04 13.43 25.02 62.87 78.74 97.05 104.98 70.80 54.93 167.85 95.83 272.83 117.19 72.63 14.04 224 14.04 361.33 -0.61 122.07 -12.82 261.84 -10.99 317.99 4.88 109.25 30.52 200.81 107.42 238.65 198.97 10.38 26.25 14.65 50.66 17.09 109.86 l3.66 76.29 14.04 -42.72 c25.02 -76.90 16.48 -151.98 -29.30 -244.14 -62.87 -128.78 -178.22 -208.13 -338.75 -235.60 -41.50 -7.32 -171.51 -4.88 -245.36 4.27 l-32.35 4.27 0 -20.75 c0 -19.53 17.09 -38.45 224.61 -246.58 141.60 -142.82 245.36 -242.31 281.98 -269.78 133.06 -101.32 286.25 -150.15 439.45 -139.77 78.13 4.88 126.34 17.09 192.26 48.83 144.04 68.36 249.02 199.58 294.19 367.43 14.65 54.93 16.48 70.80 16.48 173.34 0.61 120.85 -6.10 169.07 -36.01 256.96 -76.29 224.61 -264.89 415.04 -502.93 509.03 -199.58 78.74 -559.69 120.85 -778.81 90.94z m732.42 -785.52 c13.43 -62.26 66.53 -113.53 137.33 -132.45 l27.47 -7.32 -37.23 -13.43 c-67.75 -25.02 -103.76 -59.81 -124.51 -123.29 l-14.04 -41.50 -10.38 31.74 c-23.19 71.41 -64.09 114.14 -128.17 134.89 l-32.35 10.38 36.62 13.43 c48.22 17.70 87.89 53.10 111.08 100.10 10.38 20.75 18.92 40.89 18.92 45.78 0 15.26 10.99 2.44 15.26 -18.31z"/>
			<path d="M2316.89 3509.52 c-126.95 -34.18 -227.05 -131.23 -264.89 -256.35 -29.30 -97.66 -32.35 -232.54 -7.32 -335.69 23.80 -97.66 80.57 -211.18 159.30 -317.99 47 -64.09 151.37 -167.85 217.90 -217.29 45.17 -33.57 49.44 -38.45 36.62 -40.89 -60.42 -12.82 -86.06 -19.53 -117.80 -33.57 -61.65 -26.86 -105.59 -54.93 -147.09 -94.60 -37.23 -35.40 -39.06 -39.06 -39.06 -65.92 0 -26.25 1.83 -29.91 34.79 -59.81 45.17 -41.50 84.23 -62.87 154.42 -86.67 54.32 -17.70 64.70 -19.53 164.79 -21.36 192.87 -4.88 241.70 14.65 433.35 174.56 97.05 80.57 148.32 112.30 182.50 112.30 33.57 0 67.14 -20.75 168.46 -101.32 169.07 -135.50 232.54 -169.07 358.89 -191.04 146.48 -25.63 317.99 13.43 406.49 92.77 27.47 25.02 31.13 30.52 31.13 52.49 0 21.36 -3.66 28.08 -34.79 57.37 -67.14 64.70 -171.51 122.68 -272.22 151.98 -73.24 20.75 -119.02 27.47 -187.38 27.47 l-57.98 0 31.74 21.36 c79.35 53.71 151.37 137.94 177 208.74 15.87 43.95 24.41 133.67 15.26 163.57 l-4.88 18.31 -79.35 4.27 c-133.06 6.71 -231.32 31.74 -353.39 90.33 -134.89 64.70 -225.83 139.77 -372.92 308.23 -153.81 175.78 -180.05 203.86 -227.05 241.70 -54.32 43.95 -142.82 88.50 -199.58 100.10 -59.81 12.21 -155.03 10.99 -206.91 -3.05z"/>
			<path d="M3081.05 2125.24 c-36.01 -23.80 -44.56 -42.72 -44.56 -97.05 0 -41.50 -2.44 -51.88 -12.82 -64.09 -6.71 -7.93 -39.06 -48.22 -70.80 -90.33 -68.36 -89.72 -118.41 -138.55 -167.85 -162.96 -61.65 -29.91 -148.93 -21.97 -200.20 18.92 -11.60 8.54 -8.54 9.16 39.67 9.77 113.53 0 197.14 42.11 234.38 117.80 9.16 17.09 15.87 41.50 15.87 54.93 l0 23.80 -22.58 -2.44 c-12.82 -1.83 -46.39 -9.77 -75.07 -18.31 -206.30 -62.26 -480.35 -5.49 -612.18 126.34 -21.97 21.97 -31.74 27.47 -48.83 27.47 -20.14 0 -20.75 -0.61 -25.02 -28.08 -14.65 -109.25 11.60 -200.81 92.16 -321.66 l39.67 -59.81 -23.80 -31.74 c-95.21 -126.95 -136.11 -259.40 -136.11 -440.06 0 -95.83 4.88 -135.50 28.08 -229.49 18.31 -76.29 36.62 -115.97 57.37 -126.95 9.77 -4.88 29.30 -6.71 54.32 -4.88 33.57 1.83 51.88 8.54 119.02 42.11 204.47 102.54 397.95 272.83 443.12 388.79 4.27 11.60 8.54 21.97 9.77 23.19 0.61 1.22 22.58 -3.66 48.83 -10.38 113.53 -28.08 170.29 -34.18 319.82 -34.18 147.71 0.61 189.21 4.88 297.85 32.35 42.72 10.99 43.95 10.99 43.95 0 0 -33.57 53.10 -105.59 137.94 -188.60 95.21 -91.55 192.87 -160.52 302.73 -213.01 111.69 -53.10 159.30 -60.42 191.04 -30.52 15.87 15.26 47.61 112.92 61.04 191.65 12.21 72.63 12.21 240.48 0 312.50 -18.31 101.93 -57.37 194.09 -117.19 273.44 l-31.74 42.72 12.21 15.26 c89.11 115.97 115.36 186.77 115.36 310.06 l0 75.07 -21.97 0 c-17.70 0 -28.08 -5.49 -54.32 -29.30 -154.42 -141.60 -387.57 -183.11 -619.51 -111.08 -21.97 6.71 -48.83 12.21 -59.20 12.21 -18.92 0 -20.14 -1.22 -20.14 -21.36 0 -31.13 13.43 -59.20 43.33 -91.55 48.83 -53.10 91.55 -69.58 194.70 -75.68 l64.09 -3.66 -42.72 -21.36 c-37.23 -18.92 -48.22 -21.36 -88.50 -21.36 -37.23 0 -52.49 3.05 -81.18 16.48 -48.83 23.19 -112.30 86.06 -192.26 190.43 l-65.31 84.84 2.44 40.89 c1.83 47 -6.71 68.97 -36.01 93.99 -23.80 19.53 -72.63 21.97 -98.88 4.88z"/>
		</svg>
		<h1>{required ? 'Connect a model server' : 'Servers'}</h1>

		{#if required || adding}
			<div class="onboard-card">
				<h2 class="card-title">Add a server</h2>
				<label class="field">
					Name
					<input bind:value={name} placeholder={hostOf(baseUrl) || 'Defaults to the host'} spellcheck="false" />
				</label>
				<label class="field">
					Base URL
					<input bind:value={baseUrl} placeholder="http://localhost:8080/v1" spellcheck="false" />
				</label>
				<label class="field">
					API key
					<input type="password" bind:value={apiKey} placeholder="Optional • unless your provider/server requires one" />
				</label>
				{#if testing}
					<p class="onboard-status">Testing…</p>
				{:else if testResult}
					<div class="test-result">
						<span class="test-line">
							{testResult.models.length} model{testResult.models.length === 1 ? '' : 's'}
							{#if visionCountOf(testResult)} · {visionCountOf(testResult)} of {testResult.models.length} accept images{/if}
						</span>
						{#if testResult.models.length}
							<div class="test-chips">
								{#each testResult.models.slice(0, 8) as m (m)}
									<span class="test-chip">{m}{fmtCtx(testResult.modelContext?.[m]) ? ` · ${fmtCtx(testResult.modelContext?.[m])}` : ''}</span>
								{/each}
								{#if testResult.models.length > 8}
									<span class="test-chip">+{testResult.models.length - 8} more</span>
								{/if}
							</div>
						{/if}
					</div>
				{/if}
				{#if formError}
					<p class="onboard-error">{formError}</p>
				{/if}
				<div class="onboard-actions">
					{#if !required}
						<button class="btn-ghost" onclick={cancelAdd}>Cancel</button>
					{/if}
					<button class="btn-ghost" disabled={!canValidate || testing || busy} onclick={testConfig}>
						{testing ? 'Testing…' : 'Test'}
					</button>
					<button class="btn-primary" disabled={!canValidate || busy} onclick={add}>
						{busy ? 'Validating…' : 'Add'}
					</button>
				</div>
			</div>
		{/if}

		{#if config.servers.length && !adding}
			<div class="server-tiles">
				<!-- the add tile sits last: servers flow from top-left in added order
				     (new servers are array-appended), and the + never pushes them right -->
				{#each config.servers as s (s.id)}
					<div class="server-tile" class:active={s.id === config.activeServerId}>
						<div class="tile-head">
							<span class="tile-name">{s.name}</span>
							{#if s.id === config.activeServerId}
								<span class="active-tag">Active</span>
							{:else}
								<button class="btn-ghost small" onclick={() => activate(s.id)}>Activate</button>
							{/if}
						</div>
						<span class="tile-url">{s.baseUrl}</span>
						<span class="tile-sub">
							{s.models.length} model{s.models.length === 1 ? '' : 's'}
							{#if visionCount(s)} · {visionCount(s)} with vision{/if}
						</span>
						{#if tileError[s.id]}
							<p class="onboard-error tile-error">{tileError[s.id]}</p>
						{/if}
						<div class="tile-actions">
							<button class="btn-ghost small" disabled={refreshing === s.id} onclick={() => refresh(s)}>
								{refreshing === s.id ? 'Refreshing…' : 'Refresh'}
							</button>
							<button class="btn-ghost small" onclick={() => (pendingDelete = s.id)}>Delete</button>
						</div>
					</div>
				{/each}
				{#if !required && !adding}
					<button class="server-tile add" onclick={() => (adding = true)} aria-label="Add a server">
						<span class="add-glyph" aria-hidden="true">+</span>
						Add a server
					</button>
				{/if}
			</div>
		{/if}
	</div>

	{#if pendingDelete}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="modal-overlay" onclick={() => (pendingDelete = null)}>
			<!-- svelte-ignore a11y_interactive_supports_focus -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div class="confirm-modal" role="dialog" aria-label="Delete server" onclick={(e) => e.stopPropagation()}>
				<h2>Delete this server?</h2>
				<p>Your conversations keep their history; new messages go to the next active server.</p>
				<div class="confirm-actions">
					<button class="btn-ghost" onclick={() => (pendingDelete = null)}>Cancel</button>
					<button class="btn-danger" onclick={confirmRemove}>Delete</button>
				</div>
			</div>
		</div>
	{/if}
</div>
