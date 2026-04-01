<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

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
