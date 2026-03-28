<script lang="ts">
	import { ArrowUpIcon, SpinnerGapIcon, StopIcon } from 'phosphor-svelte';

	let {
		placeholder = 'message',
		onsubmit,
		oninterrupt,
		disabled = false,
		isStreaming = false,
		canInterrupt = false,
		isInterrupting = false,
		value = $bindable('')
	}: {
		placeholder?: string;
		onsubmit?: (value: string) => void | Promise<void>;
		oninterrupt?: () => void | Promise<void>;
		disabled?: boolean;
		isStreaming?: boolean;
		canInterrupt?: boolean;
		isInterrupting?: boolean;
		value?: string;
	} = $props();

	let textareaRef = $state<HTMLTextAreaElement | null>(null);
	let isSubmitting = $state(false);

	const isSending = $derived(isSubmitting);
	const textareaDisabled = $derived(disabled || isStreaming || isSubmitting || isInterrupting);
	const sendDisabled = $derived(disabled || isStreaming || isSubmitting || isInterrupting || !value.trim());
	const stopDisabled = $derived(disabled || isInterrupting || !canInterrupt);

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
		if (!value.trim() || sendDisabled) {
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

	async function handleInterrupt(): Promise<void> {
		if (stopDisabled) {
			return;
		}

		await oninterrupt?.();
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' && !event.shiftKey && !isStreaming) {
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
	class="relative w-full cursor-text border border-line bg-surface-1 transition-[background-color] duration-150 focus-within:bg-surface-1"
	class:opacity-50={disabled && !isStreaming}
>
	<textarea
		bind:this={textareaRef}
		bind:value
		oninput={autoResize}
		onkeydown={handleKeydown}
		{placeholder}
		rows={1}
		disabled={textareaDisabled}
		class="min-h-[96px] max-h-48 w-full resize-none overflow-y-auto bg-transparent px-4 pt-4 pb-12 text-[16px] leading-relaxed text-fg outline-none placeholder:text-muted disabled:cursor-not-allowed min-[821px]:text-[14px]"
	></textarea>

	<button
		type="button"
		aria-label={isStreaming ? (isInterrupting ? 'Stopping agent' : 'Stop agent') : 'Send message'}
		onclick={() => void (isStreaming ? handleInterrupt() : handleSubmit())}
		disabled={isStreaming ? stopDisabled : sendDisabled}
		class="absolute right-2 bottom-2 inline-flex h-10 w-10 items-center justify-center border border-line bg-surface-0 text-fg transition-[border-color,background-color,color] duration-150 hover:border-accent hover:text-accent focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
	>
		{#if isStreaming}
			{#if isInterrupting}
				<SpinnerGapIcon size={16} class="animate-spin" />
			{:else}
				<StopIcon size={16} />
			{/if}
		{:else if isSending}
			<SpinnerGapIcon size={16} class="animate-spin" />
		{:else}
			<ArrowUpIcon size={16} />
		{/if}
	</button>
</div>
