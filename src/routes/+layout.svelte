<script lang="ts">
	import './+layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { getTheme } from '$lib/theme.svelte.js';
	import darkCss from 'highlight.js/styles/dark.css?url';
	import lightCss from 'highlight.js/styles/github.css?url'; // no light.css ships with hljs

	let { children } = $props();

	// ponytail: hljs themes use flat unscoped selectors, so exactly one theme sheet
	// may exist at a time — swap the single <link>'s href instead of stacking imports.
	const hljsHref = $derived(getTheme() === 'dark' ? darkCss : lightCss);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="stylesheet" href={hljsHref} />
</svelte:head>

{@render children()}
