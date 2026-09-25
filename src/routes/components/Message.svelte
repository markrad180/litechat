<script lang="ts">
	import { renderMarkdown } from '$lib/md.js';
	import { fmtCount, fmtRate, fmtWall } from '$lib/stats.js';
	import type { AttachmentMeta, Message as ChatMessage, ReasoningLevel } from '$lib/types.js';

	let {
		message,
		tools = [],
		results = {},
		live = false,
		attachments = []
	}: {
		message: ChatMessage;
		tools?: { id: string; name: string; args: Record<string, unknown>; summary?: string }[];
		results?: Record<string, string>;
		live?: boolean;
		attachments?: (AttachmentMeta & { url: string })[]; // persisted attachments for display
	} = $props();

	// Content is a string wherever persisted; ContentBlock[] is wire-only, so the
	// string-only paths below guard the union type defensively.
	const contentText = $derived(typeof message.content === 'string' ? message.content : '');
	const html = $derived(message.role === 'assistant' && contentText ? renderMarkdown(contentText) : '');
	// User bubbles are plain text, not markdown. Tidy the composer's raw newlines
	// (trailing spaces, 3+ blank lines) and linkify bare URLs so long ones wrap
	// cleanly. Copy still copies the original text.
	const userParts = $derived.by(() => {
		if (message.role !== 'user' || !contentText) return [];
		const text = contentText.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
		// ponytail: regex linkify (2nd group catches trailing sentence punctuation, kept as plain text)
		return text.split(/(https?:\/\/[^\s<>"')\]]+)([.,;:!?]*)/g).map((p) =>
			/^https?:\/\//.test(p) ? { text: p, href: p } : { text: p }
		);
	});
	const calls = $derived(message.tool_calls ?? []);
	const waiting = $derived(live && !message.content && !message.reasoning && !tools.length);
	const working = $derived(live && !message.content && tools.length > 0);

	// One label for both web tools — the backend complexity stays hidden.
	function labelFor(name: string): string {
		return name === 'calculator' ? 'calculator' : 'web search';
	}

	// One pill per turn: a single label for a batch of like calls, a count when mixed.
	function toolLabel(list: { name: string }[]): string {
		const labels = [...new Set(list.map((tc) => labelFor(tc.name)))];
		if (labels.length === 1) return list.length > 1 ? `${labels[0]} ×${list.length}` : labels[0];
		return `${list.length} tool calls`;
	}

	// UI label for the wire level (xhigh is a server-side name, 'Ultra' is the user's).
	function levelLabel(l: ReasoningLevel): string {
		return l === 'xhigh' ? 'Ultra' : l.charAt(0).toUpperCase() + l.slice(1);
	}

	// Broken thumbs (attachment file deleted on disk) fall back to a named chip.
	// A Record, not a Set — $state tracks property access/assignment reliably,
	// while Set .has/.add does not invalidate the dependent {#if} here.
	let brokenThumbs = $state<Record<string, boolean>>({});

	const COPY_ICON =
		'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>';
	const CHECK_ICON =
		'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>';

	// Icon copy: write the plain text, flash a check for a beat.
	function copyMessage(btn: HTMLButtonElement, text: string) {
		void navigator.clipboard.writeText(text);
		btn.innerHTML = CHECK_ICON;
		setTimeout(() => (btn.innerHTML = COPY_ICON), 1200);
	}

	// Code-block copy buttons live inside the innerHTML, so delegate from the container.
	function onCopyClick(e: MouseEvent) {
		const btn = (e.target as HTMLElement).closest('.copy-btn') as HTMLButtonElement | null;
		if (!btn) return;
		const code = btn.parentElement?.querySelector('code');
		if (!code) return;
		void navigator.clipboard.writeText(code.textContent ?? '');
		btn.innerHTML = CHECK_ICON;
		setTimeout(() => (btn.innerHTML = COPY_ICON), 1200);
	}
</script>

{#if message.role === 'user' || message.role === 'assistant'}
	<div class="msg {message.role}" class:live={live}>
		{#if message.role === 'assistant'}
			<div class="msg-label">Assistant</div>
		{/if}
		{#if waiting}
			<div class="waiting" aria-label="Assistant is working"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
		{:else if working}
			<div class="waiting-status">{tools.some((t) => t.name === 'calculator') ? 'Calculating' : 'Searching the web'}…</div>
		{/if}
		{#if message.reasoning}
			<details class="thinking" open={live}>
				<summary class="thinking-pill">
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a6 6 0 0 0-4 10.5c.6.6 1 1.5 1 2.5h6c0-1 .4-1.9 1-2.5A6 6 0 0 0 12 2z" /></svg>
					Thinking{message.reasoningLevel ? ` · ${levelLabel(message.reasoningLevel)}` : ''}
				</summary>
				<div class="thinking-body">
					<pre>{message.reasoning}</pre>
				</div>
			</details>
		{/if}
		{#if calls.length}
			<div class="tools">
				<!-- one pill per turn; the expanded body is the per-call history -->
				<details class="tool">
					<summary class="tool-pill">
					{#if calls.some((tc) => tc.name !== 'calculator')}
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
					{:else}
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 9h14" /><path d="M5 15h14" /></svg>
					{/if}
					{toolLabel(calls)}
				</summary>
					<div class="tool-body">
						{#each calls as tc (tc.id)}
							{@const result = results[tc.id] ?? ''}
							<!-- no result (or an error) = struck-out label, no data -->
							<div class="tool-call" class:empty={!result || result.startsWith('Error:')}>
								<div class="tool-call-name">{labelFor(tc.name)}</div>
								{#if result && !result.startsWith('Error:')}
									<pre>{result}</pre>
								{/if}
							</div>
						{/each}
					</div>
				</details>
			</div>
		{/if}
		{#if tools.length}
			<div class="tools">
				<div class="tool-live">
					<div class="tool-row">
						{#if tools.every((t) => t.summary)}
							<span>✓</span>{toolLabel(tools)}
						{:else}
							<span class="spinner"></span>
							{tools.filter((t) => t.summary).length} of {tools.length} tools…
						{/if}
					</div>
				</div>
			</div>
		{/if}
		{#if message.role === 'user'}
			{#if attachments.length}
				<div class="msg-atts">
					{#each attachments as a (a.id)}
						{#if a.isImage}
							{#if !brokenThumbs[a.id]}
								<img class="att-thumb" src={a.url} alt={a.name} loading="lazy" onerror={() => (brokenThumbs[a.id] = true)} />
							{:else}
								<span class="att-chip error">{a.name} — file unavailable</span>
							{/if}
						{:else}
							<a class="att-chip ready" href={a.url} target="_blank" rel="noopener noreferrer" title="Download {a.name}">
								<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
								<span class="att-name">{a.name}</span>
							</a>
						{/if}
					{/each}
				</div>
			{/if}
			<div class="content">
				{#each userParts as p, i (i)}
					{#if p.href}
						<a href={p.href} target="_blank" rel="noopener noreferrer">{p.text}</a>
					{:else}
						{p.text}
					{/if}
				{/each}
			</div>
			{#if contentText}
				<div class="msg-actions">
					<button
						class="stat-copy"
						aria-label="Copy message"
						onclick={(e) => copyMessage(e.currentTarget, contentText)}
					>
						{@html COPY_ICON}
					</button>
				</div>
			{/if}
		{:else if html || live}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="md" onclick={onCopyClick}>{@html html}</div>
			{#if live && message.content}
				<span class="caret"></span>
			{/if}
		{/if}
		{#if message.role === 'assistant' && (message.stats || contentText)}
			<div class="msg-stats">
				{#if message.stats}
				<span class="stat">
					<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5" /><path d="M5 12l7-7 7 7" /></svg>
					{fmtRate(message.stats.prompt, message.stats.wallMs / 1000)}
				</span>
				<span class="stat">
					<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14" /><path d="M19 12l-7 7-7-7" /></svg>
					{fmtRate(message.stats.completion, message.stats.wallMs / 1000)}
				</span>
				<span class="stat">
					<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4" /><path d="M9 2h6" /></svg>
					{fmtWall(message.stats.wallMs)}
				</span>
				<span class="stat">
					<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h16" /><path d="M4 15h16" /><path d="M10 3 8 21" /><path d="M16 3l-2 18" /></svg>
					{fmtCount(message.stats.prompt + message.stats.completion)}
				</span>
				{/if}
				{#if contentText}
					<button class="stat-copy" aria-label="Copy message" onclick={(e) => copyMessage(e.currentTarget, contentText)}>
						{@html COPY_ICON}
					</button>
				{/if}
			</div>
		{/if}
	</div>
{/if}
