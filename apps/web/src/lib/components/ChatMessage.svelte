<script lang="ts">
	import { SpinnerGapIcon, StopIcon } from 'phosphor-svelte';
	import { Streamdown } from 'svelte-streamdown';
	import Code from 'svelte-streamdown/code';
	import { shikiLanguages, shikiTheme, shikiThemes, streamdownTheme } from '$lib/streamdown/config';

	let {
		role,
		content,
		streaming = false,
		interrupted = false,
		elapsedSeconds = null,
		showStatusNote = false
	}: {
		role: 'user' | 'assistant';
		content: string;
		streaming?: boolean;
		interrupted?: boolean;
		elapsedSeconds?: number | null;
		showStatusNote?: boolean;
	} = $props();

	const isUser = $derived(role === 'user');
	const assistantStatusText = $derived.by(() => {
		if (!showStatusNote || isUser) {
			return null;
		}

		if (streaming) {
			return `Working... (${formatElapsed(elapsedSeconds)})`;
		}

		if (interrupted) {
			return elapsedSeconds === null
				? 'Interrupted'
				: `Interrupted after ${formatElapsed(elapsedSeconds)}`;
		}

		return null;
	});

	function formatElapsed(value: number | null): string {
		const seconds = Math.max(0, value ?? 0);
		return `${seconds} sec${seconds === 1 ? '' : 's'}`;
	}
</script>

{#if isUser}
	<article class="mb-4 w-full border border-line bg-[rgba(137,180,250,0.08)] px-[1.1rem] py-4">
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

		{#if assistantStatusText}
			<div class="mt-3 flex items-center gap-2 font-mono text-[12px] leading-[1.55] text-muted">
				{#if streaming}
					<SpinnerGapIcon size={14} class="animate-spin text-accent" />
				{:else if interrupted}
					<StopIcon size={14} class="text-notice" />
				{/if}
				<span>{assistantStatusText}</span>
			</div>
		{/if}
	</article>
{/if}
