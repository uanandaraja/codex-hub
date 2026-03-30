<script lang="ts">
	import {
		ArrowUpIcon,
		GearSixIcon,
		PaperclipIcon,
		SpinnerGapIcon,
		StopIcon,
		XIcon
	} from 'phosphor-svelte';
	import { Popover } from 'bits-ui';
	import type { ModelSummary } from '$lib/types';
	import AppSelect, { type AppSelectOption } from '$lib/components/ui/AppSelect.svelte';
	import type {
		PromptAttachmentDraft,
		PromptSubmitPayload
	} from '$lib/components/prompt-input.types';

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
		attachments = $bindable<PromptAttachmentDraft[]>([]),
		selectedModel = $bindable<string | null>(null),
		selectedEffort = $bindable<'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | null>(
			null
		),
		selectedMode = $bindable<'build' | 'plan'>('build'),
		selectedPermissionPreset = $bindable<'ask' | 'auto' | 'full'>('ask')
	}: {
		placeholder?: string;
		onsubmit?: (payload: PromptSubmitPayload) => void | Promise<void>;
		oninterrupt?: () => void | Promise<void>;
		models?: ModelSummary[];
		disabled?: boolean;
		isStreaming?: boolean;
		canInterrupt?: boolean;
		isInterrupting?: boolean;
		value?: string;
		attachments?: PromptAttachmentDraft[];
		selectedModel?: string | null;
		selectedEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | null;
		selectedMode?: 'build' | 'plan';
		selectedPermissionPreset?: 'ask' | 'auto' | 'full';
	} = $props();

	let textareaRef = $state<HTMLTextAreaElement | null>(null);
	let fileInputRef = $state<HTMLInputElement | null>(null);
	let isSubmitting = $state(false);
	let advancedOpen = $state(false);

	const isSending = $derived(isSubmitting);
	const attachmentDisabled = $derived(disabled || isStreaming || isSubmitting || isInterrupting);
	const textareaDisabled = $derived(disabled || isStreaming || isSubmitting || isInterrupting);
	const sendDisabled = $derived(
		disabled ||
			isStreaming ||
			isSubmitting ||
			isInterrupting ||
			(!value.trim() && attachments.length === 0)
	);
	const stopDisabled = $derived(disabled || isInterrupting || !canInterrupt);
	const selectedModelSummary = $derived.by(
		() => models.find((model) => model.model === selectedModel) ?? null
	);
	const effortOptions = $derived.by(
		() =>
			selectedModelSummary?.supportedReasoningEfforts.map((option) => option.reasoningEffort) ?? [
				'medium'
			]
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
	const supportedImageTypes = new Set([
		'image/png',
		'image/jpeg',
		'image/jpg',
		'image/webp',
		'image/gif',
		'image/bmp'
	]);
	const supportedImageAccept = [...supportedImageTypes].join(',');
	const controlTriggerClass = 'min-[821px]:text-[12px]';
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
		if ((!value.trim() && attachments.length === 0) || sendDisabled) {
			return;
		}

		const submitPayload: PromptSubmitPayload = {
			message: value.trim(),
			attachments: [...attachments]
		};
		isSubmitting = true;

		try {
			await onsubmit?.(submitPayload);
			value = '';
			attachments = [];
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

	function openFilePicker(): void {
		fileInputRef?.click();
	}

	function handleFileInputChange(event: Event): void {
		const input = event.currentTarget as HTMLInputElement | null;
		const files = Array.from(input?.files ?? []).filter((file) =>
			supportedImageTypes.has(file.type)
		);
		if (files.length === 0) {
			if (input) {
				input.value = '';
			}
			return;
		}

		attachments = [
			...attachments,
			...files.map((file) => ({
				id: crypto.randomUUID(),
				file,
				previewUrl: URL.createObjectURL(file)
			}))
		];

		if (input) {
			input.value = '';
		}
	}

	function removeAttachment(attachmentId: string): void {
		const target = attachments.find((attachment) => attachment.id === attachmentId);
		if (!target) {
			return;
		}

		URL.revokeObjectURL(target.previewUrl);
		attachments = attachments.filter((attachment) => attachment.id !== attachmentId);
	}

	function formatAttachmentSize(byteLength: number): string {
		if (byteLength >= 1_000_000) {
			return `${(byteLength / 1_000_000).toFixed(1)} MB`;
		}

		return `${Math.max(1, Math.round(byteLength / 1_000))} KB`;
	}
</script>

<div
	class="w-full overflow-hidden border border-line bg-surface-1 transition-[background-color] duration-150 focus-within:bg-surface-1"
	class:opacity-50={disabled && !isStreaming}
>
	<input
		bind:this={fileInputRef}
		type="file"
		accept={supportedImageAccept}
		multiple
		disabled={attachmentDisabled}
		onchange={handleFileInputChange}
		class="sr-only"
		tabindex="-1"
		aria-hidden="true"
	/>

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

	{#if attachments.length > 0}
		<div class="grid gap-2 px-3 pb-3">
			<div class="flex flex-wrap gap-2">
				{#each attachments as attachment (attachment.id)}
					<div class="group relative h-24 w-24 overflow-hidden border border-line bg-surface-0">
						<img
							src={attachment.previewUrl}
							alt={attachment.file.name}
							class="h-full w-full object-cover"
						/>

						<div
							class="absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,rgba(9,10,12,0)_0%,rgba(9,10,12,0.88)_100%)] px-2 py-1.5"
						>
							<p class="truncate text-[10px] font-medium text-fg">{attachment.file.name}</p>
							<p class="text-[10px] text-muted">{formatAttachmentSize(attachment.file.size)}</p>
						</div>

						<button
							type="button"
							aria-label={`Remove ${attachment.file.name}`}
							onclick={() => removeAttachment(attachment.id)}
							disabled={attachmentDisabled}
							class="absolute top-1 right-1 inline-flex h-6 w-6 items-center justify-center border border-line bg-surface-1/92 text-muted transition-[border-color,color,background-color] duration-150 hover:border-accent hover:text-accent"
						>
							<XIcon size={12} />
						</button>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<div class="-mt-px px-2 py-2">
		<div
			class="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2 min-[821px]:hidden"
		>
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

			<button
				type="button"
				class="inline-flex h-9 w-9 items-center justify-center border border-line bg-surface-0 text-muted transition-[border-color,color,background-color] duration-150 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
				onclick={openFilePicker}
				aria-label="Attach images"
				disabled={attachmentDisabled}
			>
				<PaperclipIcon size={16} />
			</button>

			<AppSelect
				bind:value={selectedModel}
				items={modelOptions}
				placeholder="default"
				triggerClass={inlineSelectClass}
				ariaLabel="Model"
			/>

			<button
				type="button"
				aria-label={isStreaming
					? isInterrupting
						? 'Stopping agent'
						: 'Stop agent'
					: 'Send message'}
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

		<div
			class="hidden min-[821px]:grid min-[821px]:grid-cols-[minmax(0,1fr)_auto] min-[821px]:items-end min-[821px]:gap-2"
		>
			<div class="flex min-w-0 flex-wrap items-center gap-2">
				<button
					type="button"
					class="inline-flex h-9 w-9 items-center justify-center border border-line bg-surface-0 text-muted transition-[border-color,color,background-color] duration-150 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
					onclick={openFilePicker}
					aria-label="Attach images"
					disabled={attachmentDisabled}
				>
					<PaperclipIcon size={16} />
				</button>

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
				aria-label={isStreaming
					? isInterrupting
						? 'Stopping agent'
						: 'Stop agent'
					: 'Send message'}
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
