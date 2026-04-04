<script lang="ts">
	import gruvboxDarkMedium from '@shikijs/themes/gruvbox-dark-medium';
	import { Streamdown } from 'svelte-streamdown';
	import { streamdownTheme } from '$lib/streamdown/config';

	let {
		content,
		streaming = false
	}: {
		content: string;
		streaming?: boolean;
	} = $props();

	const streamdownShikiThemes = {
		'gruvbox-dark-medium': gruvboxDarkMedium
	} as const;
</script>

<div class="min-w-0 overflow-hidden">
	<Streamdown
		{content}
		parseIncompleteMarkdown={streaming}
		controls={{ code: false, mermaid: false, table: false }}
		theme={streamdownTheme}
		shikiTheme="gruvbox-dark-medium"
		shikiThemes={streamdownShikiThemes}
		class="min-w-0"
	/>
</div>
