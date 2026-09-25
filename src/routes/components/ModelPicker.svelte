<script lang="ts">
	let {
		model,
		models,
		onselect
	}: {
		model: string;
		models: string[];
		onselect: (m: string) => void;
	} = $props();

	let open = $state(false);
	let typed = $state('');
	let wrapEl: HTMLDivElement | null = $state(null);

	function pick(m: string) {
		onselect(m);
		open = false;
	}

	function commitTyped() {
		const m = typed.trim();
		if (!m) return;
		pick(m);
	}

	$effect(() => {
		if (!open) return;
		function onDoc(e: MouseEvent) {
			if (wrapEl && !wrapEl.contains(e.target as Node)) open = false;
		}
		function onKey(e: KeyboardEvent) {
			if (e.key === 'Escape') open = false;
		}
		document.addEventListener('click', onDoc);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('click', onDoc);
			document.removeEventListener('keydown', onKey);
		};
	});
</script>

<div class="model-wrap" bind:this={wrapEl}>
	<button class="model-chip" onclick={() => (open = !open)} aria-haspopup="listbox" aria-expanded={open}>
		<span class="model-chip-label">{model || 'Choose model'}</span>
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
	</button>
	{#if open}
		<div class="model-menu" role="listbox">
			{#each models as m (m)}
				<button class="model-row" class:current={m === model} role="option" aria-selected={m === model} onclick={() => pick(m)}>{m}</button>
			{/each}
			<div class="model-sep"></div>
			<input
				class="model-input"
				placeholder="Model name…"
				bind:value={typed}
				spellcheck="false"
				onkeydown={(e) => e.key === 'Enter' && commitTyped()}
			/>
		</div>
	{/if}
</div>
