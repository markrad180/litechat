<script lang="ts">
	let { url, name, onclose }: { url: string; name: string; onclose: () => void } = $props();

	$effect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onclose();
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="modal-overlay" onclick={onclose}>
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="lightbox" role="dialog" aria-label={name} onclick={(e) => e.stopPropagation()}>
		<img class="lightbox-img" src={url} alt={name} />
		<button class="icon-btn lightbox-x" aria-label="Close" title="Close" onclick={onclose}>✕</button>
	</div>
</div>
