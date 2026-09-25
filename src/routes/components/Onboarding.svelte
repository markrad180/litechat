<script lang="ts">
	import { api } from '$lib/api.js';
	import favicon from '$lib/assets/favicon.svg';

	let { ondone }: { ondone: () => void } = $props();

	let step = $state<'endpoint' | 'model'>('endpoint');
	let baseUrl = $state('http://localhost:8080/v1');
	let apiKey = $state('');
	let models = $state<string[]>([]);
	let model = $state('');
	let fetchError = $state('');
	let busy = $state(false);

	async function continueToModels() {
		if (!baseUrl.trim() || busy) return;
		busy = true;
		fetchError = '';
		try {
			await api('/api/config', {
				method: 'PUT',
				body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey })
			});
			try {
				const res = await api<{ models: string[] }>('/api/models');
				models = res.models;
			} catch (e) {
				fetchError = e instanceof Error ? e.message : String(e);
			}
			step = 'model';
		} catch (e) {
			fetchError = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function start() {
		if (!model.trim() || busy) return;
		busy = true;
		try {
			await api('/api/config', {
				method: 'PUT',
				body: JSON.stringify({ defaultModel: model.trim() })
			});
			ondone();
		} catch (e) {
			fetchError = e instanceof Error ? e.message : String(e);
			busy = false;
		}
	}
</script>

<div class="onboard">
	<div class="onboard-card">
		<img class="logo" src={favicon} alt="" />
		{#if step === 'endpoint'}
			<h1>Connect your model server</h1>
			<p class="sub">A locally hosted OpenAI-compatible server (llama.cpp, Ninfer, …)</p>
			<label class="field">
				Base URL
				<input bind:value={baseUrl} placeholder="http://localhost:8080/v1" spellcheck="false" />
			</label>
			<label class="field">
				API key <span class="hint">(optional)</span>
				<input type="password" bind:value={apiKey} placeholder="not required" />
			</label>
			{#if fetchError}
				<p class="onboard-error">{fetchError}</p>
			{/if}
			<div class="onboard-actions">
				<button class="btn-primary" disabled={!baseUrl.trim() || busy} onclick={continueToModels}>
					{busy ? 'Connecting…' : 'Continue'}
				</button>
			</div>
		{:else}
			<h1>Choose a model</h1>
			{#if models.length}
				<div class="models-list">
					{#each models as m (m)}
						<button class="model-row" class:current={m === model} onclick={() => (model = m)}>{m}</button>
					{/each}
				</div>
			{:else}
				<p class="sub">Couldn't fetch the model list — type the model name instead.</p>
			{/if}
			<label class="field">
				Model name
				<input bind:value={model} placeholder="e.g. llama-3.1-8b" spellcheck="false" />
			</label>
			{#if fetchError}
				<p class="onboard-error">{fetchError}</p>
			{/if}
			<div class="onboard-actions">
				<button class="btn-ghost" disabled={busy} onclick={() => { step = 'endpoint'; fetchError = ''; }}>Back</button>
				<button class="btn-primary" disabled={!model.trim() || busy} onclick={start}>
					{busy ? 'Starting…' : 'Get started'}
				</button>
			</div>
		{/if}
	</div>
</div>
