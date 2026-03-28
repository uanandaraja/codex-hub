<script lang="ts">
	import { Streamdown } from 'svelte-streamdown';
	import Code from 'svelte-streamdown/code';
	import { shikiLanguages, shikiTheme, shikiThemes, streamdownTheme } from '$lib/streamdown/config';

	let {
		role,
		content,
		streaming = false
	}: {
		role: 'user' | 'assistant';
		content: string;
		streaming?: boolean;
	} = $props();

	const isUser = $derived(role === 'user');
</script>

{#if isUser}
	<article class="mb-4 w-full max-w-[80%] border border-line bg-[rgba(137,180,250,0.08)] px-[1.1rem] py-4">
		<pre class="m-0 whitespace-pre-wrap break-words font-sans [overflow-wrap:anywhere] text-[14px] leading-[1.7] text-fg">{content}</pre>
	</article>
{:else}
	<article class="mb-4 w-full min-w-0">
		{#if content}
			<div class="min-w-0 overflow-hidden">
				<Streamdown
					{content}
					parseIncompleteMarkdown
					controls={{ code: false, mermaid: false, table: false }}
					theme={streamdownTheme}
					{shikiLanguages}
					{shikiThemes}
					{shikiTheme}
					components={{ code: Code }}
					class="min-w-0"
				/>
			</div>
		{/if}

		{#if streaming}
			<div class="mt-3 flex h-4 items-end">
				<span class="h-4 w-[0.18rem] animate-pulse bg-accent"></span>
			</div>
		{/if}
	</article>
{/if}
