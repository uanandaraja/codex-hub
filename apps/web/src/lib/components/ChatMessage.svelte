<script lang="ts">
	import { SpinnerGapIcon, StopIcon } from 'phosphor-svelte';
	import { Streamdown } from 'svelte-streamdown';
	import Code from 'svelte-streamdown/code';
	import { shikiLanguages, shikiTheme, shikiThemes, streamdownTheme } from '$lib/streamdown/config';

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
	const assistantContextText = $derived.by(() => {
		if (!showStatusNote || isUser || contextLeftPercent === null) {
			return null;
		}

		return `ctx ${contextLeftPercent}% left`;
	});
	const assistantMetaText = $derived.by(() => {
		const parts: string[] = [];
		if (assistantStatusText) {
			parts.push(assistantStatusText);
		}
		if (assistantContextText) {
			parts.push(assistantContextText);
		}
		return parts.length > 0 ? parts.join(' | ') : null;
	});

	function formatElapsed(value: number | null): string {
		const totalSeconds = Math.max(0, value ?? 0);
		const hours = Math.floor(totalSeconds / 3_600);
		const minutes = Math.floor((totalSeconds % 3_600) / 60);
		const seconds = totalSeconds % 60;

		if (hours > 0) {
			return minutes > 0
				? `${hours} hr${hours === 1 ? '' : 's'} ${minutes} min`
				: `${hours} hr${hours === 1 ? '' : 's'}`;
		}

		if (minutes > 0) {
			return `${minutes} min ${seconds} sec${seconds === 1 ? '' : 's'}`;
		}

		return `${seconds} sec${seconds === 1 ? '' : 's'}`;
	}
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

		{#if assistantMetaText}
			<div class="mt-3 flex items-center gap-2 font-mono text-[12px] leading-[1.55] text-muted">
				{#if streaming}
					<SpinnerGapIcon size={14} class="animate-spin text-accent" />
				{:else if interrupted}
					<StopIcon size={14} class="text-notice" />
				{/if}
				<span>{assistantMetaText}</span>
			</div>
		{/if}
	</article>
{/if}
