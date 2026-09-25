<script lang="ts">
	import type { ReasoningLevel } from '$lib/types.js';

	let {
		level,
		disabled = false,
		onselect
	}: {
		level: ReasoningLevel;
		disabled?: boolean;
		onselect: (l: ReasoningLevel) => void;
	} = $props();

	const OPTIONS: { value: ReasoningLevel; label: string }[] = [
		{ value: 'off', label: 'Off' },
		{ value: 'low', label: 'Low' },
		{ value: 'medium', label: 'Medium' },
		{ value: 'high', label: 'High' },
		{ value: 'xhigh', label: 'Ultra' }
	];

	let open = $state(false);
	let wrapEl: HTMLDivElement | null = $state(null);

	const current = $derived(OPTIONS.find((o) => o.value === level)?.label ?? level);

	function pick(l: ReasoningLevel) {
		onselect(l);
		open = false;
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

<div class="reasoning-wrap" bind:this={wrapEl}>
	<button
		class="reasoning-chip"
		class:rainbow={level === 'xhigh'}
		disabled={disabled}
		aria-haspopup="listbox"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<span class="chip-dim">Reasoning</span>
		{current}
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
	</button>
	{#if open}
		<div class="reasoning-menu" role="listbox">
			{#each OPTIONS as o (o.value)}
				<button class="model-row" class:current={o.value === level} role="option" aria-selected={o.value === level} onclick={() => pick(o.value)}>{o.label}</button>
			{/each}
		</div>
	{/if}
</div>
