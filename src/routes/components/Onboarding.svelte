<script lang="ts">
	import { api } from '$lib/api.js';
	import favicon from '$lib/assets/favicon.svg';

	let { ondone, initBaseUrl = '' }: {
		ondone: () => void;
		initBaseUrl?: string; // pre-fill when re-entering with a saved endpoint
	} = $props();

	let step = $state<'endpoint' | 'model'>('endpoint');
	// svelte-ignore state_referenced_locally
	let baseUrl = $state(initBaseUrl || 'http://localhost:8080/v1');
	let apiKey = $state('');
	let models = $state<string[]>([]);
	let model = $state('');
	let query = $state('');
	let fetchError = $state(false);
	let startError = $state('');
	let busy = $state(false);

	const filtered = $derived(
		query.trim() ? models.filter((m) => m.toLowerCase().includes(query.trim().toLowerCase())) : models
	);

	// Step 1 only stores the endpoint (local write — can't fail). The strict
	// model check lives in step 2, against a fresh /models fetch.
	function continueToModels() {
		if (!baseUrl.trim() || busy) return;
		busy = true;
		void (async () => {
			try {
				await api('/api/config', {
					method: 'PUT',
					body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey })
				});
			} catch {
				busy = false; // a failed PUT must not leave "Connecting…" stuck
				return;
			}
			step = 'model';
			await loadModels();
		})();
	}

	async function loadModels() {
		fetchError = false;
		startError = '';
		busy = true;
		try {
			const res = await api<{ models: string[] }>('/api/models');
			models = res.models;
			if (!models.includes(model)) model = '';
		} catch {
			models = [];
			model = '';
			fetchError = true;
		} finally {
			busy = false;
		}
	}

	function back() {
		step = 'endpoint';
		fetchError = false;
		startError = '';
		query = '';
	}

	async function start() {
		if (!model || busy) return;
		busy = true;
		startError = '';
		try {
			// Final check against a fresh list — the selection must still be live.
			const res = await api<{ models: string[] }>('/api/models');
			if (!res.models.includes(model)) {
				models = res.models;
				model = '';
				startError = 'That model is no longer available — pick one from the list.';
				return;
			}
			await api('/api/config', {
				method: 'PUT',
				body: JSON.stringify({ defaultModel: model })
			});
			ondone();
		} catch (e) {
			startError = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

<div class="onboard">
	<div class="onboard-card">
		<img class="logo" src={favicon} alt="" />
		{#if step === 'endpoint'}
			<h1>Connect your model server</h1>
			<p class="sub">An OpenAI-compatible endpoint — a local server (llama.cpp, Ninfer, …) or an online provider/router (OpenRouter, LiteLLM, …).</p>
			<label class="field">
				Base URL
				<input bind:value={baseUrl} placeholder="http://localhost:8080/v1" spellcheck="false" />
			</label>
			<label class="field">
				API key
				<input type="password" bind:value={apiKey} placeholder="Optional • unless your provider/server requires one" />
			</label>
			<div class="onboard-actions">
				<button class="btn-primary" disabled={!baseUrl.trim() || busy} onclick={continueToModels}>
					{busy ? 'Connecting…' : 'Continue'}
				</button>
			</div>
		{:else}
			<h1>Choose a model</h1>
			{#if fetchError}
				<p class="onboard-error">Can't reach the server at {baseUrl} — check the Base URL and API key, then retry.</p>
			{:else if busy && !models.length}
				<p class="sub">Fetching models…</p>
			{:else if models.length}
				<div class="models-list">
					{#each filtered as m (m)}
						<button class="model-row" class:current={m === model} onclick={() => (model = m)}>{m}</button>
					{:else}
						<p class="sub">No models match.</p>
					{/each}
				</div>
				<label class="field">
					Filter models
					<input bind:value={query} placeholder="Narrow the list…" spellcheck="false" />
				</label>
			{:else}
				<p class="sub">No models found.</p>
			{/if}
			{#if startError}
				<p class="onboard-error">{startError}</p>
			{/if}
			<div class="onboard-actions">
				<button class="btn-ghost" disabled={busy} onclick={back}>Back</button>
				{#if fetchError}
					<button class="btn-ghost" disabled={busy} onclick={loadModels}>Retry</button>
				{/if}
				<button class="btn-primary" disabled={!model || busy} onclick={start}>
					{busy ? 'Checking…' : 'Get started'}
				</button>
			</div>
		{/if}
	</div>
</div>
