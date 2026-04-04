<script lang="ts">
	import { onMount } from 'svelte';
	import type { Component } from 'svelte';
	import TurnStatusNote from '$lib/components/TurnStatusNote.svelte';

	type AssistantMarkdownModule = typeof import('$lib/components/AssistantMarkdown.svelte');
	type AssistantMarkdownProps = {
		content: string;
		streaming?: boolean;
	};

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

	let assistantMarkdownModulePromise: Promise<AssistantMarkdownModule> | null = null;
	let hasMounted = $state(false);
	let assistantMarkdownComponent = $state<Component<AssistantMarkdownProps> | null>(null);
	let assistantMarkdownLoadFailed = $state(false);

	const isUser = $derived(role === 'user');

	onMount(() => {
		hasMounted = true;
	});

	$effect(() => {
		if (
			!hasMounted ||
			role !== 'assistant' ||
			!content ||
			assistantMarkdownComponent ||
			assistantMarkdownLoadFailed
		) {
			return;
		}

		void ensureAssistantMarkdownComponent();
	});

	async function ensureAssistantMarkdownComponent(): Promise<void> {
		try {
			assistantMarkdownModulePromise ??= import('$lib/components/AssistantMarkdown.svelte');
			const module = await assistantMarkdownModulePromise;
			assistantMarkdownComponent = module.default;
		} catch {
			assistantMarkdownLoadFailed = true;
		}
	}
</script>

{#if isUser}
	<article class="mb-4 w-full border border-line bg-surface-1 px-[1.1rem] py-4">
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
			{#if assistantMarkdownComponent}
				{@const AssistantMarkdownComponent = assistantMarkdownComponent}
				<AssistantMarkdownComponent {content} {streaming} />
			{:else}
				<div class="min-w-0 overflow-hidden">
					<pre
						class="m-0 whitespace-pre-wrap break-words font-sans [overflow-wrap:anywhere] text-[14px] leading-[1.7] text-fg"
					>{content}</pre>
				</div>
			{/if}
		{/if}

		{#if showStatusNote}
			<TurnStatusNote {streaming} {interrupted} {elapsedSeconds} {contextLeftPercent} />
		{/if}
	</article>
{/if}
