<script lang="ts">
	import type { ConversationMeta } from '$lib/types.js';

	let {
		conversations,
		activeId,
		onselect,
		onnew,
		ondelete
	}: {
		conversations: ConversationMeta[];
		activeId?: string;
		onselect: (id: string) => void;
		onnew: () => void;
		ondelete: (id: string) => void;
	} = $props();

	function timeAgo(ts: number): string {
		const s = Math.floor((Date.now() - ts) / 1000);
		if (s < 60) return 'now';
		if (s < 3600) return `${Math.floor(s / 60)}m`;
		if (s < 86400) return `${Math.floor(s / 3600)}h`;
		return new Date(ts).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
	}
</script>

<button class="new-btn" onclick={onnew}>
	<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
	New chat
</button>
<ul class="conv-list">
	{#each conversations as c (c.id)}
		<li class:active={c.id === activeId}>
			<button
				class="title"
				onclick={() => onselect(c.id)}
				onmouseenter={(e) => {
					// native tooltip, only when the ellipsis actually cut the title
					const t = e.currentTarget.querySelector('.t') as HTMLElement;
					t.title = t.scrollWidth > t.clientWidth ? c.title : '';
				}}
			>
				<span class="t">{c.title}</span>
			</button>
			<span class="entry-slot">
				<span class="meta">{timeAgo(c.updatedAt)}</span>
				<button class="del" aria-label={`Delete ${c.title}`} onclick={() => ondelete(c.id)}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
				</button>
			</span>
		</li>
	{/each}
</ul>
