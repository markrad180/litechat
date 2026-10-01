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
	let down = $state(false);
	let wrapEl: HTMLDivElement | null = $state(null);

	// The input filters the list; an unmatched entry stays selectable as a
	// free-text model (servers can expose models the list hasn't probed).
	const shown = $derived(
		typed ? models.filter((m) => m.toLowerCase().includes(typed.toLowerCase())) : models
	);

	function pick(m: string) {
		onselect(m);
		open = false;
		typed = '';
	}

	function commitTyped() {
		const m = shown[0] ?? typed.trim();
		if (!m) return;
		pick(m);
	}

	function toggle() {
		if (open) {
			open = false;
			return;
		}
		// Open toward the roomier side; the search sits on the pill side either way.
		const r = wrapEl?.getBoundingClientRect();
		down = r ? window.innerHeight - r.bottom >= r.top : false;
		typed = '';
		open = true;
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
	<button
		class="model-chip"
		onclick={toggle}
		aria-haspopup="listbox"
		aria-expanded={open}
	>
		<span class="model-chip-label">{model || 'Choose model'}</span>
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
	</button>
	{#if open}
		<div class="model-menu" class:up={!down} role="listbox">
			<!-- search ends up on the pill side in both directions (see .model-menu.up order rule) -->
			<input
				class="model-input"
				placeholder="Search models…"
				bind:value={typed}
				spellcheck="false"
				onkeydown={(e) => e.key === 'Enter' && commitTyped()}
			/>
			<div class="model-list">
				{#each shown as m (m)}
					<button class="model-row" class:current={m === model} role="option" aria-selected={m === model} onclick={() => pick(m)}>{m}</button>
				{:else}
					{#if typed}
						<button class="model-row free" onclick={() => commitTyped()}>Use “{typed}”</button>
					{/if}
				{/each}
			</div>
		</div>
	{/if}
</div>
