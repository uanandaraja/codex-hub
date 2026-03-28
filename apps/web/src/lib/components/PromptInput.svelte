<script lang="ts">
	import { ArrowUpIcon, GearSixIcon, SpinnerGapIcon, StopIcon } from 'phosphor-svelte';
	import type { ModelSummary } from '$lib/types';

	let {
		placeholder = 'message',
		onsubmit,
		oninterrupt,
		models = [],
		disabled = false,
		isStreaming = false,
		canInterrupt = false,
		isInterrupting = false,
		value = $bindable(''),
		selectedModel = $bindable<string | null>(null),
		selectedEffort = $bindable<'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | null>(null),
		selectedMode = $bindable<'build' | 'plan'>('build'),
		selectedPermissionPreset = $bindable<'ask' | 'auto' | 'full'>('ask')
	}: {
		placeholder?: string;
		onsubmit?: (value: string) => void | Promise<void>;
		oninterrupt?: () => void | Promise<void>;
		models?: ModelSummary[];
		disabled?: boolean;
		isStreaming?: boolean;
		canInterrupt?: boolean;
		isInterrupting?: boolean;
		value?: string;
		selectedModel?: string | null;
		selectedEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | null;
		selectedMode?: 'build' | 'plan';
		selectedPermissionPreset?: 'ask' | 'auto' | 'full';
	} = $props();

	let textareaRef = $state<HTMLTextAreaElement | null>(null);
	let isSubmitting = $state(false);
	let advancedOpen = $state(false);

	const isSending = $derived(isSubmitting);
	const textareaDisabled = $derived(disabled || isStreaming || isSubmitting || isInterrupting);
	const sendDisabled = $derived(disabled || isStreaming || isSubmitting || isInterrupting || !value.trim());
	const stopDisabled = $derived(disabled || isInterrupting || !canInterrupt);
	const selectedModelSummary = $derived.by(
		() => models.find((model) => model.model === selectedModel) ?? null
	);
	const effortOptions = $derived.by(() =>
		selectedModelSummary?.supportedReasoningEfforts.map((option) => option.reasoningEffort) ?? ['medium']
	);
	const controlClass =
		'h-9 min-w-0 border border-line bg-surface-0 px-3 text-[12px] text-muted outline-none transition-[border-color,color] duration-150 hover:border-accent hover:text-accent focus:border-line min-[821px]:text-[12px]';

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
			advancedOpen = false;

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

		advancedOpen = false;
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
	class="w-full overflow-hidden border-x border-b border-line bg-surface-1 transition-[background-color] duration-150 focus-within:bg-surface-1"
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
		class="min-h-[136px] max-h-56 w-full resize-none overflow-y-auto bg-transparent px-4 pt-4 pb-4 text-[16px] leading-relaxed text-fg outline-none placeholder:text-muted disabled:cursor-not-allowed min-[821px]:min-h-[120px] min-[821px]:text-[14px]"
	></textarea>

	{#if advancedOpen}
		<button
			type="button"
			class="fixed inset-0 z-20 bg-transparent min-[821px]:hidden"
			onclick={() => {
				advancedOpen = false;
			}}
			aria-label="Close advanced options"
		></button>

		<div class="absolute right-2 bottom-[4.15rem] left-2 z-30 grid gap-2 border border-line bg-surface-1 p-2 shadow-[0_18px_48px_rgba(0,0,0,0.42)] min-[821px]:hidden">
			<select bind:value={selectedEffort} class={`${controlClass} w-full`}>
				{#each effortOptions as effort}
					<option value={effort}>{effort}</option>
				{/each}
			</select>

			<select bind:value={selectedMode} class={`${controlClass} w-full`}>
				<option value="build">build</option>
				<option value="plan">plan</option>
			</select>

			<select bind:value={selectedPermissionPreset} class={`${controlClass} w-full`}>
				<option value="ask">ask</option>
				<option value="auto">auto</option>
				<option value="full">full</option>
			</select>
		</div>
	{/if}

	<div class="-mt-px px-2 py-2">
		<div class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 min-[821px]:hidden">
			<button
				type="button"
				class="inline-flex h-9 w-9 items-center justify-center border border-line bg-surface-0 text-muted transition-[border-color,color] duration-150 hover:border-accent hover:text-accent"
				onclick={() => {
					advancedOpen = !advancedOpen;
				}}
				aria-label="Advanced options"
				aria-expanded={advancedOpen}
			>
				<GearSixIcon size={16} />
			</button>

			<select bind:value={selectedModel} class={`${controlClass} w-full min-w-0`}>
				{#if models.length > 0}
					{#each models as model (model.model)}
						<option value={model.model}>{model.displayName}</option>
					{/each}
				{:else}
					<option value="">default</option>
				{/if}
			</select>

			<button
				type="button"
				aria-label={isStreaming ? (isInterrupting ? 'Stopping agent' : 'Stop agent') : 'Send message'}
				onclick={() => void (isStreaming ? handleInterrupt() : handleSubmit())}
				disabled={isStreaming ? stopDisabled : sendDisabled}
				class="inline-flex h-10 w-10 items-center justify-center border border-line bg-surface-0 text-fg transition-[border-color,background-color,color] duration-150 hover:border-accent hover:text-accent focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
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

		<div class="hidden min-[821px]:grid min-[821px]:grid-cols-[minmax(0,1fr)_auto] min-[821px]:items-end min-[821px]:gap-2">
			<div class="flex min-w-0 flex-wrap items-center gap-2">
				<select bind:value={selectedModel} class={`${controlClass} min-[821px]:max-w-[9rem]`}>
					{#if models.length > 0}
						{#each models as model (model.model)}
							<option value={model.model}>{model.displayName}</option>
						{/each}
					{:else}
						<option value="">default</option>
					{/if}
				</select>

				<select bind:value={selectedEffort} class={`${controlClass} min-[821px]:w-[6.1rem]`}>
					{#each effortOptions as effort}
						<option value={effort}>{effort}</option>
					{/each}
				</select>

				<select bind:value={selectedMode} class={`${controlClass} min-[821px]:w-[5.6rem]`}>
					<option value="build">build</option>
					<option value="plan">plan</option>
				</select>

				<select bind:value={selectedPermissionPreset} class={`${controlClass} min-[821px]:w-[5.8rem]`}>
					<option value="ask">ask</option>
					<option value="auto">auto</option>
					<option value="full">full</option>
				</select>
			</div>

			<button
				type="button"
				aria-label={isStreaming ? (isInterrupting ? 'Stopping agent' : 'Stop agent') : 'Send message'}
				onclick={() => void (isStreaming ? handleInterrupt() : handleSubmit())}
				disabled={isStreaming ? stopDisabled : sendDisabled}
				class="justify-self-end inline-flex h-10 w-10 items-center justify-center border border-line bg-surface-0 text-fg transition-[border-color,background-color,color] duration-150 hover:border-accent hover:text-accent focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
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
	</div>
</div>
