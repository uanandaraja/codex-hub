<script lang="ts">
	import { Streamdown } from 'svelte-streamdown';
	import { streamdownTheme } from '$lib/streamdown/config';
	import TurnStatusNote from '$lib/components/TurnStatusNote.svelte';

	let {
		role,
		content,
		imageAttachments = [],
		streaming = false,
		interrupted = false,
		elapsedSeconds = null,
		showStatusNote = false,
		contextLeftPercent = null
	}: {
		role: 'user' | 'assistant';
		content: string;
		imageAttachments?: Array<{ src: string; alt: string }>;
		streaming?: boolean;
		interrupted?: boolean;
		elapsedSeconds?: number | null;
		showStatusNote?: boolean;
		contextLeftPercent?: number | null;
	} = $props();

	const isUser = $derived(role === 'user');
</script>

{#if isUser}
	<article class="mb-4 w-full border border-line bg-[rgba(137,180,250,0.08)] px-[1.1rem] py-4">
		{#if imageAttachments.length > 0}
			<div class={`flex flex-wrap gap-2 ${content ? 'mb-3' : ''}`}>
				{#each imageAttachments as attachment (attachment.src)}
					<img
						src={attachment.src}
						alt={attachment.alt}
						loading="lazy"
						class="max-h-[18rem] w-auto max-w-full border border-line bg-surface-0 object-contain"
					/>
				{/each}
			</div>
		{/if}

		{#if content}
			<pre
				class="m-0 whitespace-pre-wrap break-words font-sans [overflow-wrap:anywhere] text-[14px] leading-[1.7] text-fg">{content}</pre>
		{/if}
	</article>
{:else}
	<article class="mb-4 w-full min-w-0">
		{#if content}
			<div class="min-w-0 overflow-hidden">
				<Streamdown
					{content}
					parseIncompleteMarkdown={streaming}
					controls={{ code: false, mermaid: false, table: false }}
					theme={streamdownTheme}
					class="min-w-0"
				/>
			</div>
		{/if}

		{#if showStatusNote}
			<TurnStatusNote {streaming} {interrupted} {elapsedSeconds} {contextLeftPercent} />
		{/if}
	</article>
{/if}
