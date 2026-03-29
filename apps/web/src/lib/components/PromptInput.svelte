<script lang="ts">
	import {
		ArrowUpIcon,
		GearSixIcon,
		SpinnerGapIcon,
		StopIcon
	} from 'phosphor-svelte';
	import { Popover } from 'bits-ui';
	import type { ModelSummary } from '$lib/types';
	import AppSelect, { type AppSelectOption } from '$lib/components/ui/AppSelect.svelte';

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
	const modelOptions = $derived.by<AppSelectOption[]>(() =>
		models.length > 0
			? models.map((model) => ({
					value: model.model,
					label: model.displayName
				}))
			: [{ value: '', label: 'default' }]
	);
	const effortSelectOptions = $derived.by<AppSelectOption[]>(() =>
		effortOptions.map((effort) => ({
			value: effort,
			label: effort
		}))
	);
	const modeOptions: AppSelectOption[] = [
		{ value: 'build', label: 'build' },
		{ value: 'plan', label: 'plan' }
	];
	const permissionOptions: AppSelectOption[] = [
		{ value: 'ask', label: 'ask' },
		{ value: 'auto', label: 'auto' },
		{ value: 'full', label: 'full' }
	];
	const controlTriggerClass =
		'min-[821px]:text-[12px]';
	const inlineSelectClass = 'w-full min-w-0';
	const desktopModelClass = 'min-[821px]:max-w-[9.4rem]';
	const desktopEffortClass = 'min-[821px]:w-[6.25rem]';
	const desktopModeClass = 'min-[821px]:w-[5.75rem]';
	const desktopPermissionClass = 'min-[821px]:w-[6rem]';

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
	class="w-full overflow-hidden border border-line bg-surface-1 transition-[background-color] duration-150 focus-within:bg-surface-1"
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

	<div class="-mt-px px-2 py-2">
		<div class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 min-[821px]:hidden">
			<Popover.Root bind:open={advancedOpen}>
				<Popover.Trigger
					class="inline-flex h-9 w-9 items-center justify-center border border-line bg-surface-0 text-muted transition-[border-color,color,background-color] duration-150 hover:border-accent hover:text-accent"
					aria-label="Advanced options"
				>
					<GearSixIcon size={16} />
				</Popover.Trigger>

				<Popover.Portal>
					<Popover.Content
						sideOffset={10}
						align="start"
						class="z-50 grid w-[min(18rem,calc(100vw-1rem))] gap-2 border border-line bg-surface-1 p-2 shadow-[0_18px_48px_rgba(0,0,0,0.42)] outline-none min-[821px]:hidden"
					>
						<AppSelect
							bind:value={selectedEffort}
							items={effortSelectOptions}
							placeholder="effort"
							triggerClass={inlineSelectClass}
							ariaLabel="Reasoning effort"
						/>

						<AppSelect
							bind:value={selectedMode}
							items={modeOptions}
							placeholder="mode"
							triggerClass={inlineSelectClass}
							ariaLabel="Prompt mode"
						/>

						<AppSelect
							bind:value={selectedPermissionPreset}
							items={permissionOptions}
							placeholder="permissions"
							triggerClass={inlineSelectClass}
							ariaLabel="Permission preset"
						/>
					</Popover.Content>
				</Popover.Portal>
			</Popover.Root>

			<AppSelect
				bind:value={selectedModel}
				items={modelOptions}
				placeholder="default"
				triggerClass={inlineSelectClass}
				ariaLabel="Model"
			/>

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
				<AppSelect
					bind:value={selectedModel}
					items={modelOptions}
					placeholder="default"
					triggerClass={`${controlTriggerClass} ${desktopModelClass}`}
					ariaLabel="Model"
				/>

				<AppSelect
					bind:value={selectedEffort}
					items={effortSelectOptions}
					placeholder="effort"
					triggerClass={`${controlTriggerClass} ${desktopEffortClass}`}
					ariaLabel="Reasoning effort"
				/>

				<AppSelect
					bind:value={selectedMode}
					items={modeOptions}
					placeholder="mode"
					triggerClass={`${controlTriggerClass} ${desktopModeClass}`}
					ariaLabel="Prompt mode"
				/>

				<AppSelect
					bind:value={selectedPermissionPreset}
					items={permissionOptions}
					placeholder="permissions"
					triggerClass={`${controlTriggerClass} ${desktopPermissionClass}`}
					ariaLabel="Permission preset"
				/>
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
