<script lang="ts">
	import type { PendingAttachment } from '$lib/types';

	let {
		onsubmit,
		disabled = false,
		placeholder = 'Message',
		attachments = [],
		onattach,
		onremove,
		initialHeight = null,
		oncommit
	}: {
		onsubmit: (text: string) => void;
		disabled?: boolean;
		placeholder?: string;
		attachments?: PendingAttachment[]; // pre-upload + just-uploaded chips
		onattach?: (files: File[]) => void;
		onremove?: (key: string) => void;
		initialHeight?: number | null; // persisted expanded height; null = auto-grow
		oncommit?: (height: number | null) => void; // called once per drag session
	} = $props();

	let text = $state('');
	let fileInput: HTMLInputElement | null = $state(null);
	let ta: HTMLTextAreaElement | null = $state(null);

	// Fixed height (px) while the user has dragged the grip; null = auto-grow.
	// The parent persists the committed value (config) so it survives reloads.
	// svelte-ignore state_referenced_locally
	let minH = $state<number | null>(initialHeight);
	let clipped = $state(false);
	$effect(() => {
		void text;
		void minH;
		if (ta) clipped = ta.scrollHeight > ta.clientHeight + 1;
	});
	const showGrip = $derived((minH !== null || clipped) && !disabled);

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

	function pickFiles() {
		fileInput?.click();
	}

	function onFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files?.length) onattach?.([...input.files]);
		input.value = '';
	}

	// Grip drag: pointer capture tracks moves off the button. Drag up to expand,
	// down to ~48px to collapse back to auto height.
	let dragY = 0;
	let dragH = 0;

	function gripDown(e: PointerEvent) {
		e.preventDefault();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		dragY = e.clientY;
		dragH = ta?.clientHeight ?? 48;
	}

	function gripMove(e: PointerEvent) {
		if (e.buttons !== 1) return;
		const h = dragH + (dragY - e.clientY);
		if (h <= 48) {
			minH = null;
			return;
		}
		minH = Math.max(96, Math.min(Math.round(window.innerHeight * 0.6), Math.round(h)));
	}

	// Commit once when the drag ends (the config round-trips to disk).
	function gripUp() {
		if (dragH > 0) oncommit?.(minH);
		dragH = 0;
	}
</script>

<div class="composer-card">
	{#if showGrip}
		<button
			class="icon-btn grip-btn"
			onpointerdown={gripDown}
			onpointermove={gripMove}
			onpointerup={gripUp}
			aria-label="Resize message box"
			title="Drag to resize the message box"
		>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7l4-4 4 4" /><path d="M8 17l4 4 4-4" /></svg>
		</button>
	{/if}
	{#if attachments.length}
		<div class="att-row">
			{#each attachments as a (a.key)}
				<span class="att-chip" class:ready={a.status === 'ready'} class:error={a.status === 'error'} title={a.error ?? a.name}>
					{#if a.status === 'uploading'}
						<span class="spinner" aria-hidden="true"></span>
						<span class="att-name">{a.name}</span>
					{:else if a.status === 'error'}
						<span class="att-name">{a.name}</span>
						<span class="att-reason">{a.error}</span>
					{:else}
						<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
						<span class="att-name">{a.name}</span>
					{/if}
					<button class="att-x" onclick={() => onremove?.(a.key)} aria-label="Remove {a.name}">✕</button>
				</span>
			{/each}
		</div>
	{/if}
	<div class="composer-line">
		<button
			class="icon-btn attach-btn"
			onclick={pickFiles}
			disabled={disabled}
			aria-label="Attach files"
			title="Attach files — or drag them anywhere in the app"
		>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
		</button>
		<textarea
			bind:this={ta}
			bind:value={text}
			style:min-height={minH !== null ? `${minH}px` : undefined}
			style:max-height={minH !== null ? `${minH}px` : undefined}
			onkeydown={onKeydown}
			{placeholder}
			{disabled}
			aria-label="Message"
		></textarea>
		<div class="composer-actions">
			<button class="send-btn" onclick={submit} disabled={disabled || !text.trim()} aria-label="Send">
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
			</button>
		</div>
	</div>
	<input class="file-input" type="file" multiple bind:this={fileInput} onchange={onFileChange} aria-hidden="true" tabindex="-1" />
</div>
