<script lang="ts">
	import { browser, dev } from '$app/environment';
	import { onMount } from 'svelte';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

	if (browser && dev) {
		void import('@uanandaraja/sveltegrab/auto');
	}

	onMount(() => {
		const themeColorMeta = document.querySelector('meta[name="theme-color"]');
		if (!themeColorMeta) {
			return;
		}

		const background = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
		if (background) {
			themeColorMeta.setAttribute('content', background);
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="" />
</svelte:head>

{@render children()}
