<script lang="ts">
	import { ArrowUpIcon } from 'phosphor-svelte';

	let {
		placeholder = 'message',
		onsubmit,
		disabled = false,
		isStreaming = false,
		value = $bindable('')
	}: {
		placeholder?: string;
		onsubmit?: (value: string) => void | Promise<void>;
		disabled?: boolean;
		isStreaming?: boolean;
		value?: string;
	} = $props();

	let textareaRef = $state<HTMLTextAreaElement | null>(null);
	let isSubmitting = $state(false);

	const isLoading = $derived(isSubmitting || isStreaming);
	const isDisabled = $derived(disabled || isLoading);

	function focusTextarea(): void {
		textareaRef?.focus();
	}

	function autoResize(): void {
		if (!textareaRef) {
			return;
		}

		textareaRef.style.height = 'auto';
		textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 192)}px`;
	}

	$effect(() => {
		void value;
		autoResize();
	});

	async function handleSubmit(): Promise<void> {
		if (!value.trim() || isDisabled) {
			return;
		}

		const submitValue = value.trim();
		isSubmitting = true;

		try {
			await onsubmit?.(submitValue);
			value = '';

			if (textareaRef) {
				textareaRef.style.height = 'auto';
			}
		} finally {
			isSubmitting = false;
		}
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			void handleSubmit();
		}
	}
</script>

<div
	role="button"
	tabindex="-1"
	onclick={focusTextarea}
	onkeydown={(event) => event.key === 'Enter' && focusTextarea()}
	class="relative w-full cursor-text border border-line bg-surface-1 transition-[border-color,background-color] duration-150 hover:border-accent focus-within:border-accent"
	class:opacity-50={isDisabled}
>
	<textarea
		bind:this={textareaRef}
		bind:value
		oninput={autoResize}
		onkeydown={handleKeydown}
		{placeholder}
		rows={1}
		disabled={isDisabled}
		class="min-h-[104px] max-h-48 w-full resize-none overflow-y-auto bg-transparent px-5 pt-5 pb-14 text-[16px] leading-relaxed text-fg outline-none placeholder:text-muted disabled:cursor-not-allowed min-[821px]:text-[14px]"
	></textarea>

	<button
		type="button"
		aria-label="Send message"
		onclick={() => void handleSubmit()}
		disabled={!value.trim() || isDisabled}
		class="absolute right-2 bottom-2 inline-flex h-10 w-10 items-center justify-center border border-line bg-surface-0 text-fg transition-[border-color,background-color,color] duration-150 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
	>
		{#if isLoading}
			<span class="h-4 w-4 animate-spin border border-muted border-t-fg"></span>
		{:else}
			<ArrowUpIcon size={16} />
		{/if}
	</button>
</div>
