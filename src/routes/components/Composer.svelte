<script lang="ts">
	let {
		onsubmit,
		disabled = false,
		placeholder = 'Message'
	}: {
		onsubmit: (text: string) => void;
		disabled?: boolean;
		placeholder?: string;
	} = $props();

	let text = $state('');

	function submit() {
		const t = text.trim();
		if (!t || disabled) return;
		text = '';
		onsubmit(t);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submit();
		}
	}
</script>

<div class="composer-card">
	<textarea bind:value={text} onkeydown={onKeydown} {placeholder} {disabled} aria-label="Message"></textarea>
	<button class="send-btn" onclick={submit} disabled={disabled || !text.trim()} aria-label="Send">
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
	</button>
</div>
