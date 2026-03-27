<script lang="ts">
	import '@fontsource/space-grotesk/400.css';
	import '@fontsource/space-grotesk/500.css';
	import '@fontsource/space-grotesk/700.css';
	import '@fontsource/ibm-plex-mono/400.css';
	import '@fontsource/ibm-plex-mono/500.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#090a0c" />
</svelte:head>

{@render children()}

<style>
	:global(:root) {
		color-scheme: dark;
		--surface-0: #090a0c;
		--surface-1: #0f1115;
		--surface-2: #151922;
		--line: #22262f;
		--text: #f3f6fb;
		--text-muted: #8e96a3;
		--accent: #8ab4ff;
	}

	:global(html) {
		height: 100%;
		background:
			radial-gradient(circle at top right, rgba(138, 180, 255, 0.08), transparent 26rem),
			linear-gradient(180deg, #090a0c, #0b0c10);
		color: var(--text);
	}

	:global(body) {
		margin: 0;
		height: 100%;
		overflow: hidden;
		font-family: 'Space Grotesk', sans-serif;
		color: var(--text);
		background: transparent;
	}

	:global(*) {
		box-sizing: border-box;
		border-radius: 0;
	}

	:global(code),
	:global(pre),
	:global(textarea),
	:global(input) {
		font-family: 'IBM Plex Mono', monospace;
	}

	:global(button),
	:global(input),
	:global(textarea) {
		font: inherit;
	}

	:global(button),
	:global(input),
	:global(textarea) {
		border-radius: 0;
	}
</style>
