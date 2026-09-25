<script lang="ts">
	import { onMount } from 'svelte';
	import ConversationList from './components/ConversationList.svelte';
	import Message from './components/Message.svelte';
	import Composer from './components/Composer.svelte';
	import Settings from './components/Settings.svelte';
	import Onboarding from './components/Onboarding.svelte';
	import ModelPicker from './components/ModelPicker.svelte';
	import ReasoningPicker from './components/ReasoningPicker.svelte';
	import { api } from '$lib/api.js';
	import { getTheme, setTheme } from '$lib/theme.svelte.js';
	import { setAccent } from '$lib/accent.svelte.js';
	import { workingContext } from '$lib/models.js';
	import type {
		Conversation,
		ConversationMeta,
		EndpointConfig,
		ReasoningLevel,
		Message as ChatMessage
	} from '$lib/types.js';

	interface LiveTool {
		id: string;
		name: string;
		args: Record<string, unknown>;
		summary?: string;
	}

	let config = $state<EndpointConfig | null>(null);
	const onboard = $derived(!config || !config.baseUrl);

	let model = $state('');
	let conversations = $state<ConversationMeta[]>([]);
	let active = $state<Conversation | null>(null);
	let streaming = $state(false);
	let sentText = $state(''); // the user's just-sent message, shown before the server round-trip
	let trimmedNote = $state(''); // set by a 'context' SSE event; cleared on the next send
	let liveText = $state('');
	let liveReasoning = $state('');
	let liveTools = $state<LiveTool[]>([]);
	let error = $state('');
	let showSettings = $state(false);
	let pendingDelete = $state<string | null>(null);
	let pendingShutdown = $state(false);
	let shuttingDown = $state(false);
	let chatEl: HTMLDivElement | null = $state(null);
	let sidebarW = $state(260); // divider drag resizes this; 260 is the CSS default

	// Drag the divider: pointer capture keeps tracking even if the cursor leaves the 6px strip.
	function startResize(e: PointerEvent) {
		e.preventDefault();
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		const onMove = (ev: PointerEvent) => (sidebarW = Math.max(180, Math.min(480, ev.clientX)));
		el.addEventListener('pointermove', onMove);
		el.addEventListener('pointerup', () => el.removeEventListener('pointermove', onMove), { once: true });
	}

	// Page-level (like model), so the dock works before a conversation exists;
	// send() carries them into the conversation the first message creates.
	// Reasoning is restored from the conversation on open — it persists across
	// refreshes and only defaults to medium for a conversation created fresh.
	let webOn = $state(true);
	let reasoningLevel = $state<ReasoningLevel>('medium');

	async function refreshList() {
		conversations = await api<ConversationMeta[]>('/api/conversations');
	}

	async function openConversation(id: string) {
		if (streaming) return;
		active = await api<Conversation>(`/api/conversations/${id}`);
		if (active.model) model = active.model;
		webOn = active.webTools ?? true;
		reasoningLevel = active.reasoning ?? 'medium';
	}

	async function newConversation() {
		if (streaming) return;
		active = await api<Conversation>('/api/conversations', {
			method: 'POST',
			body: JSON.stringify({ model: model || undefined, webTools: webOn, reasoning: reasoningLevel })
		});
		await refreshList();
	}

	function deleteConversation(id: string) {
		pendingDelete = id;
	}

	async function confirmDelete() {
		if (!pendingDelete) return;
		const id = pendingDelete;
		pendingDelete = null;
		await api(`/api/conversations/${id}`, { method: 'DELETE' });
		if (active?.id === id) active = null;
		await refreshList();
	}

	$effect(() => {
		if (!pendingDelete && !pendingShutdown) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && !shuttingDown) {
				pendingDelete = null;
				pendingShutdown = false;
			}
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	});

	async function confirmShutdown() {
		shuttingDown = true;
		// The server exits ~50ms after this resolves; the tab's connection
		// drops, so swallow the error and leave the "Stopping…" note up.
		await api('/api/shutdown', { method: 'POST' }).catch(() => {});
	}

	async function updateConversation(patch: Record<string, unknown>) {
		if (!active) return;
		active = await api<Conversation>(`/api/conversations/${active.id}`, {
			method: 'PUT',
			body: JSON.stringify(patch)
		});
	}

	function chooseModel(m: string) {
		model = m;
		if (active) void updateConversation({ model: m });
	}

	async function send(text: string) {
		if (streaming) return;
		if (!active) await newConversation();
		if (!active) return;
		error = '';
		trimmedNote = '';
		liveText = '';
		liveReasoning = '';
		liveTools = [];
		streaming = true;
		sentText = text; // show it instantly; the post-stream re-read replaces it
		const history = active.messages; // excludes the new user message; the server appends it
		try {
			const res = await fetch('/api/chat', {
				method: 'POST',
				body: JSON.stringify({
					conversationId: active.id,
					model,
					messages: history,
					newUser: text,
					// Web toggle: calculator always on, web_search/web_fetch follow the chip.
					tools: webOn ? undefined : ['calculator'],
					reasoning: reasoningLevel
				})
			});
			if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => '')}`);
			const reader = res.body!.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const frames = buffer.split('\n\n');
				buffer = frames.pop() ?? '';
				for (const frame of frames) {
					const m = frame.match(/^event: (\w+)\ndata: (.+)$/s);
					if (!m) continue;
					const [, event, data] = m;
					const payload = JSON.parse(data);
					if (event === 'token') liveText += payload.content;
					else if (event === 'reasoning') liveReasoning += payload.content;
					else if (event === 'tool_call') liveTools = [...liveTools, payload as LiveTool];
					else if (event === 'tool_result')
						liveTools = liveTools.map((t) =>
							t.id === payload.id ? { ...t, summary: payload.summary } : t
						);
					else if (event === 'context')
						trimmedNote = `Trimmed ${payload.trimmed} older message${payload.trimmed === 1 ? '' : 's'} to fit the context window`;
					else if (event === 'error') error = payload.message;
				}
			}
			// Re-read the persisted conversation so tool rows match what's on disk.
			const fresh = await api<Conversation>(`/api/conversations/${active.id}`);
			active = fresh;
			const convId = fresh.id;
			// Background: ask the same model (non-reasoning) to name the chat;
			// the 48-char truncation stays as the offline/failed fallback.
			if (fresh.title === 'New chat')
				void (async () => {
					const t = await api<{ title: string }>(`/api/conversations/${convId}/title`, { method: 'POST' }).catch(
						() => null
					);
					const title = t?.title || text.slice(0, 48);
					await api(`/api/conversations/${convId}`, { method: 'PUT', body: JSON.stringify({ title }) });
					if (active?.id === convId) active = { ...active, title };
					void refreshList();
				})().catch(() => {});
			await refreshList();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			streaming = false;
			sentText = '';
			liveText = '';
			liveReasoning = '';
			liveTools = [];
		}
	}

	function toolResultsFor(msg: ChatMessage): Record<string, string> {
		if (!active) return {};
		const out: Record<string, string> = {};
		for (const m of active.messages) {
			if (m.role === 'tool' && m.tool_call_id) out[m.tool_call_id] = m.content;
		}
		return out;
	}

	// Consecutive pure reasoning/tool-call assistant rounds (no content) are one turn's
	// thinking — merge them into a single message so it renders as one thinking block.
	// Tool results come from toolResultsFor's global map, so merged pills still resolve.
	const renderItems = $derived.by(() => {
		const items: { key: string; msg: ChatMessage }[] = [];
		let group: ChatMessage | null = null;
		const flush = () => {
			if (group) {
				items.push({ key: `group-${items.length}`, msg: group });
				group = null;
			}
		};
		for (const m of active?.messages ?? []) {
			if (m.role === 'tool') continue;
			if (m.role === 'assistant' && !m.content) {
				if (!group) group = { role: 'assistant', content: '' };
				if (m.reasoning) {
					group.reasoning = group.reasoning ? `${group.reasoning}\n\n${m.reasoning}` : m.reasoning;
				}
				if (m.tool_calls?.length) group.tool_calls = [...(group.tool_calls ?? []), ...m.tool_calls];
				continue;
			}
			flush();
			items.push({ key: `${m.role}-${items.length}`, msg: m });
		}
		flush();
		return items;
	});

	const enterApp = async () => {
		await refreshList();
		// Start on a fresh chat; the first message creates the conversation.
	};

	async function onOnboardDone() {
		const cfg = await api<EndpointConfig>('/api/config');
		config = cfg;
		model = cfg.defaultModel ?? '';
		if (cfg.accent) setAccent(cfg.accent); // server is the source of truth; re-warms localStorage
		void enterApp();
	}

	function onConfigSaved(cfg: EndpointConfig) {
		config = cfg;
		if (!model) model = cfg.defaultModel ?? '';
	}

	// Scroll on real changes only: new messages (count), a new conversation (id), or
	// streaming content. Setting picks replace `active` with equal content — they must not scroll.
	const msgCount = $derived(active?.messages.length ?? 0);
	const activeId = $derived(active?.id ?? '');
	$effect(() => {
		void msgCount;
		void activeId;
		void sentText;
		void liveText;
		void liveReasoning;
		if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
	});

	// Context-usage indicator: real prompt tokens from the last turn vs the working limit.
	const lastPrompt = $derived(
		[...((active?.messages ?? []).filter((m) => m.stats))].at(-1)?.stats?.prompt ?? 0
	);
	const contextPct = $derived(config && lastPrompt ? lastPrompt / workingContext(config, model) : 0);

	onMount(async () => {
		const cfg = await api<EndpointConfig>('/api/config');
		config = cfg;
		if (cfg.accent) setAccent(cfg.accent); // server is the source of truth; re-warms localStorage
		if (cfg.baseUrl) {
			model = cfg.defaultModel ?? '';
			void enterApp();
		}
	});
</script>

{#if onboard}
	<Onboarding ondone={onOnboardDone} />
{:else}
	<div class="shell">
		<div class="logo-bar">litechat</div>
		<div class="app" style:grid-template-columns="{sidebarW}px 6px 1fr">
		<aside class="sidebar">
			<ConversationList
				conversations={conversations}
				activeId={active?.id}
				onselect={openConversation}
				onnew={newConversation}
				ondelete={deleteConversation}
			/>
			<div class="sidebar-footer">
				<button
					class="icon-btn"
					aria-label="Stop server"
					title="Stop server"
					onclick={() => (pendingShutdown = true)}
				>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" /></svg>
				</button>
				<button
					class="icon-btn"
					aria-label="Settings"
					title="Settings"
					onclick={() => (showSettings = true)}
				>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
				</button>
				<button
					class="icon-btn"
					aria-label="Toggle theme"
					title="Toggle theme"
					onclick={() => setTheme(getTheme() === 'light' ? 'dark' : 'light')}
				>
					{#if getTheme() === 'light'}
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
					{:else}
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
					{/if}
				</button>
			</div>
		</aside>
		<div class="resize-handle" aria-hidden="true" onpointerdown={startResize}></div>
		<main class="main">
			{#if error}
				<div class="error-banner">
					<span>{error}</span>
					<button onclick={() => (error = '')} aria-label="Dismiss">✕</button>
				</div>
			{/if}

			<div class="chat-scroll" bind:this={chatEl}>
				<div class="thread">
					{#if (!active || active.messages.length === 0) && !sentText && !streaming}
						<div class="empty-state">
							<svg class="fox" viewBox="2000 800 2250 3500" aria-hidden="true">
								<defs>
									<linearGradient id="fox-grad" x1="0" y1="0" x2="0" y2="1">
										<stop offset="0" stop-color="var(--accent)" />
										<stop offset="1" stop-color="color-mix(in srgb, var(--accent) 45%, #ffffff)" />
									</linearGradient>
								</defs>
								<path fill="url(#fox-grad)" d="M2902.22 4281.01 c-389.40 -53.10 -691.53 -289.92 -811.77 -637.21 -26.25 -76.29 -37.84 -128.17 -43.33 -194.70 l-4.27 -49.44 21.97 0 c16.48 0 23.80 3.66 29.30 14.04 13.43 25.02 62.87 78.74 97.05 104.98 70.80 54.93 167.85 95.83 272.83 117.19 72.63 14.04 224 14.04 361.33 -0.61 122.07 -12.82 261.84 -10.99 317.99 4.88 109.25 30.52 200.81 107.42 238.65 198.97 10.38 26.25 14.65 50.66 17.09 109.86 l3.66 76.29 14.04 -42.72 c25.02 -76.90 16.48 -151.98 -29.30 -244.14 -62.87 -128.78 -178.22 -208.13 -338.75 -235.60 -41.50 -7.32 -171.51 -4.88 -245.36 4.27 l-32.35 4.27 0 -20.75 c0 -19.53 17.09 -38.45 224.61 -246.58 141.60 -142.82 245.36 -242.31 281.98 -269.78 133.06 -101.32 286.25 -150.15 439.45 -139.77 78.13 4.88 126.34 17.09 192.26 48.83 144.04 68.36 249.02 199.58 294.19 367.43 14.65 54.93 16.48 70.80 16.48 173.34 0.61 120.85 -6.10 169.07 -36.01 256.96 -76.29 224.61 -264.89 415.04 -502.93 509.03 -199.58 78.74 -559.69 120.85 -778.81 90.94z m732.42 -785.52 c13.43 -62.26 66.53 -113.53 137.33 -132.45 l27.47 -7.32 -37.23 -13.43 c-67.75 -25.02 -103.76 -59.81 -124.51 -123.29 l-14.04 -41.50 -10.38 31.74 c-23.19 71.41 -64.09 114.14 -128.17 134.89 l-32.35 10.38 36.62 13.43 c48.22 17.70 87.89 53.10 111.08 100.10 10.38 20.75 18.92 40.89 18.92 45.78 0 15.26 10.99 2.44 15.26 -18.31z" />
								<path fill="url(#fox-grad)" d="M2316.89 3509.52 c-126.95 -34.18 -227.05 -131.23 -264.89 -256.35 -29.30 -97.66 -32.35 -232.54 -7.32 -335.69 23.80 -97.66 80.57 -211.18 159.30 -317.99 47 -64.09 151.37 -167.85 217.90 -217.29 45.17 -33.57 49.44 -38.45 36.62 -40.89 -60.42 -12.82 -86.06 -19.53 -117.80 -33.57 -61.65 -26.86 -105.59 -54.93 -147.09 -94.60 -37.23 -35.40 -39.06 -39.06 -39.06 -65.92 0 -26.25 1.83 -29.91 34.79 -59.81 45.17 -41.50 84.23 -62.87 154.42 -86.67 54.32 -17.70 64.70 -19.53 164.79 -21.36 192.87 -4.88 241.70 14.65 433.35 174.56 97.05 80.57 148.32 112.30 182.50 112.30 33.57 0 67.14 -20.75 168.46 -101.32 169.07 -135.50 232.54 -169.07 358.89 -191.04 146.48 -25.63 317.99 13.43 406.49 92.77 27.47 25.02 31.13 30.52 31.13 52.49 0 21.36 -3.66 28.08 -34.79 57.37 -67.14 64.70 -171.51 122.68 -272.22 151.98 -73.24 20.75 -119.02 27.47 -187.38 27.47 l-57.98 0 31.74 21.36 c79.35 53.71 151.37 137.94 177 208.74 15.87 43.95 24.41 133.67 15.26 163.57 l-4.88 18.31 -79.35 4.27 c-133.06 6.71 -231.32 31.74 -353.39 90.33 -134.89 64.70 -225.83 139.77 -372.92 308.23 -153.81 175.78 -180.05 203.86 -227.05 241.70 -54.32 43.95 -142.82 88.50 -199.58 100.10 -59.81 12.21 -155.03 10.99 -206.91 -3.05z" />
								<path fill="url(#fox-grad)" d="M3081.05 2125.24 c-36.01 -23.80 -44.56 -42.72 -44.56 -97.05 0 -41.50 -2.44 -51.88 -12.82 -64.09 -6.71 -7.93 -39.06 -48.22 -70.80 -90.33 -68.36 -89.72 -118.41 -138.55 -167.85 -162.96 -61.65 -29.91 -148.93 -21.97 -200.20 18.92 -11.60 8.54 -8.54 9.16 39.67 9.77 113.53 0 197.14 42.11 234.38 117.80 9.16 17.09 15.87 41.50 15.87 54.93 l0 23.80 -22.58 -2.44 c-12.82 -1.83 -46.39 -9.77 -75.07 -18.31 -206.30 -62.26 -480.35 -5.49 -612.18 126.34 -21.97 21.97 -31.74 27.47 -48.83 27.47 -20.14 0 -20.75 -0.61 -25.02 -28.08 -14.65 -109.25 11.60 -200.81 92.16 -321.66 l39.67 -59.81 -23.80 -31.74 c-95.21 -126.95 -136.11 -259.40 -136.11 -440.06 0 -95.83 4.88 -135.50 28.08 -229.49 18.31 -76.29 36.62 -115.97 57.37 -126.95 9.77 -4.88 29.30 -6.71 54.32 -4.88 33.57 1.83 51.88 8.54 119.02 42.11 204.47 102.54 397.95 272.83 443.12 388.79 4.27 11.60 8.54 21.97 9.77 23.19 0.61 1.22 22.58 -3.66 48.83 -10.38 113.53 -28.08 170.29 -34.18 319.82 -34.18 147.71 0.61 189.21 4.88 297.85 32.35 42.72 10.99 43.95 10.99 43.95 0 0 -33.57 53.10 -105.59 137.94 -188.60 95.21 -91.55 192.87 -160.52 302.73 -213.01 111.69 -53.10 159.30 -60.42 191.04 -30.52 15.87 15.26 47.61 112.92 61.04 191.65 12.21 72.63 12.21 240.48 0 312.50 -18.31 101.93 -57.37 194.09 -117.19 273.44 l-31.74 42.72 12.21 15.26 c89.11 115.97 115.36 186.77 115.36 310.06 l0 75.07 -21.97 0 c-17.70 0 -28.08 -5.49 -54.32 -29.30 -154.42 -141.60 -387.57 -183.11 -619.51 -111.08 -21.97 6.71 -48.83 12.21 -59.20 12.21 -18.92 0 -20.14 -1.22 -20.14 -21.36 0 -31.13 13.43 -59.20 43.33 -91.55 48.83 -53.10 91.55 -69.58 194.70 -75.68 l64.09 -3.66 -42.72 -21.36 c-37.23 -18.92 -48.22 -21.36 -88.50 -21.36 -37.23 0 -52.49 3.05 -81.18 16.48 -48.83 23.19 -112.30 86.06 -192.26 190.43 l-65.31 84.84 2.44 40.89 c1.83 47 -6.71 68.97 -36.01 93.99 -23.80 19.53 -72.63 21.97 -98.88 4.88z" />
							</svg>
							<h1>How can I help?</h1>
						</div>
					{:else}
						{#each renderItems as item (item.key)}
							<Message message={item.msg} results={toolResultsFor(item.msg)} />
						{/each}
						{#if sentText}
							<Message message={{ role: 'user', content: sentText }} />
						{/if}
						{#if streaming}
							<Message
								message={{ role: 'assistant', content: liveText, reasoning: liveReasoning }}
								tools={liveTools}
								live
							/>
						{/if}
						{#if trimmedNote}
							<div class="trim-note">{trimmedNote}</div>
						{/if}
					{/if}
				</div>
			</div>

			<div class="dock">
				<div class="dock-inner">
					{#if contextPct >= 0.8}
						<div class="context-indicator" class:hard={contextPct >= 0.94}>
							Context {Math.round(contextPct * 100)}%{contextPct >= 0.94 ? ' — nearly full' : ''}
						</div>
					{/if}
					<div class="dock-controls">
						<ModelPicker model={model} models={config?.models ?? []} onselect={chooseModel} />
						<button
							class="web-chip"
							class:on={webOn}
							aria-pressed={webOn}
							title={webOn ? 'Web tools on' : 'Web tools off'}
							onclick={() => {
								webOn = !webOn;
								if (active) void updateConversation({ webTools: webOn });
							}}
						>
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
							Web
						</button>
						<ReasoningPicker
							level={reasoningLevel}
							onselect={(l) => {
								reasoningLevel = l;
								if (active) void updateConversation({ reasoning: l });
							}}
						/>
					</div>
					<Composer onsubmit={send} disabled={streaming} placeholder="Message — Enter to send, Shift+Enter for a new line" />
				</div>
			</div>
		</main>
	</div>
	{#if showSettings && config}
		<Settings config={config} onsaved={onConfigSaved} onclose={() => (showSettings = false)} />
	{/if}
{#if pendingDelete}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="modal-overlay" onclick={() => (pendingDelete = null)}>
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="confirm-modal" role="dialog" aria-label="Delete conversation" onclick={(e) => e.stopPropagation()}>
			<h2>Delete this conversation?</h2>
			<div class="confirm-actions">
				<button class="btn-ghost" onclick={() => (pendingDelete = null)}>Cancel</button>
				<button class="btn-danger" onclick={() => void confirmDelete()}>Delete</button>
			</div>
		</div>
	</div>
{/if}
{#if pendingShutdown}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="modal-overlay" onclick={() => !shuttingDown && (pendingShutdown = false)}>
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="confirm-modal" role="dialog" aria-label="Stop Litechat" onclick={(e) => e.stopPropagation()}>
			{#if shuttingDown}
				<h2>Stopping…</h2>
				<p>You can close this tab when it's done.</p>
			{:else}
				<h2>Stop Litechat?</h2>
				<p>The app will stop. Your chats stay saved.</p>
				<div class="confirm-actions">
					<button class="btn-ghost" onclick={() => (pendingShutdown = false)}>Cancel</button>
					<button class="btn-danger" onclick={() => void confirmShutdown()}>Stop server</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
</div>
{/if}
