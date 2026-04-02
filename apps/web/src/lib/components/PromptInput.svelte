<script lang="ts">
	import { onMount, tick } from 'svelte';
	import {
		ArrowUpIcon,
		BrainIcon,
		GitBranchIcon,
		GearSixIcon,
		ListChecksIcon,
		PaperclipIcon,
		ShieldCheckIcon,
		SpinnerGapIcon,
		StopCircleIcon,
		XIcon
	} from 'phosphor-svelte';
	import { Popover } from 'bits-ui';
	import type { FuzzyFileSearchResponse, FuzzyFileSearchResult, ModelSummary } from '$lib/types';
	import { formatModelDisplayName } from '$lib/model-display-name';
	import AppSelect, { type AppSelectOption } from '$lib/components/ui/AppSelect.svelte';
	import type {
		PromptAttachmentDraft,
		PromptFileMentionDraft,
		PromptSubmitPayload
	} from '$lib/components/prompt-input.types';

	type MentionQueryMatch = {
		start: number;
		end: number;
		query: string;
	};

	type ComposerSegment =
		| { type: 'text'; text: string }
		| { type: 'mention'; mention: PromptFileMentionDraft };

	type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

	let {
		placeholder = 'message',
		onsubmit,
		oninterrupt,
		models = [],
		projectPath = null,
		branchLabel = null,
		disabled = false,
		isStreaming = false,
		canInterrupt = false,
		isInterrupting = false,
		value = $bindable(''),
		attachments = $bindable<PromptAttachmentDraft[]>([]),
		mentions = $bindable<PromptFileMentionDraft[]>([]),
		selectedModel = $bindable<string | null>(null),
		selectedEffort = $bindable<ReasoningEffort | null>(null),
		selectedMode = $bindable<'build' | 'plan'>('build'),
		selectedPermissionPreset = $bindable<'ask' | 'auto' | 'full'>('ask')
	}: {
		placeholder?: string;
		onsubmit?: (payload: PromptSubmitPayload) => void | Promise<void>;
		oninterrupt?: () => void | Promise<void>;
		models?: ModelSummary[];
		projectPath?: string | null;
		branchLabel?: string | null;
		disabled?: boolean;
		isStreaming?: boolean;
		canInterrupt?: boolean;
		isInterrupting?: boolean;
		value?: string;
		attachments?: PromptAttachmentDraft[];
		mentions?: PromptFileMentionDraft[];
		selectedModel?: string | null;
		selectedEffort?: ReasoningEffort | null;
		selectedMode?: 'build' | 'plan';
		selectedPermissionPreset?: 'ask' | 'auto' | 'full';
	} = $props();

	let editorRef = $state<HTMLDivElement | null>(null);
	let fileInputRef = $state<HTMLInputElement | null>(null);
	let isSubmitting = $state(false);
	let advancedOpen = $state(false);
	let desktopAdvancedOpen = $state(false);
	let selectionStart = $state(0);
	let selectionEnd = $state(0);
	let mentionSearchResults = $state<FuzzyFileSearchResult[]>([]);
	let mentionSearchLoading = $state(false);
	let mentionSearchIndex = $state(0);
		let mentionSearchError = $state<string | null>(null);
		let dismissedMentionQueryKey = $state<string | null>(null);
		let mentionSearchRequestId = 0;
		let mentionSearchDebounce: ReturnType<typeof setTimeout> | null = null;
		let mentionSearchAbortController: AbortController | null = null;
		let lastComposerSignature = '';
		let dragDepth = $state(0);
		let attachmentPreviewId = $state<string | null>(null);

	const isSending = $derived(isSubmitting);
	const attachmentDisabled = $derived(disabled || isStreaming || isSubmitting || isInterrupting);
	const editorDisabled = $derived(disabled || isSubmitting || isInterrupting);
	const sendDisabled = $derived(
		disabled ||
			isStreaming ||
			isSubmitting ||
			isInterrupting ||
			(!value.trim() && attachments.length === 0 && mentions.length === 0)
	);
	const stopDisabled = $derived(disabled || isInterrupting || !canInterrupt);
	const selectedModelSummary = $derived.by(
		() => models.find((model) => model.model === selectedModel) ?? null
	);
	const effortOptions = $derived.by<ReasoningEffort[]>(
		() =>
			selectedModelSummary?.supportedReasoningEfforts.map((option) => option.reasoningEffort) ?? [
				'medium'
			]
	);
	const modelOptions = $derived.by<AppSelectOption[]>(() =>
		models.length > 0
			? models.map((model) => ({
					value: model.model,
					label: formatModelDisplayName(model.model)
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
	const settingsSectionLabelClass =
		'flex items-center gap-2 px-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted';
	const mobileModelClass = '!border-0 !bg-transparent !pl-1.5 !pr-1 focus-visible:text-accent';
	const desktopModelClass =
		'min-[821px]:max-w-[9.4rem] min-[821px]:!border-0 min-[821px]:!bg-transparent min-[821px]:!pl-1.5 min-[821px]:!pr-1 min-[821px]:focus-visible:text-accent';
	const ghostButtonClass =
		'inline-flex h-9 w-9 items-center justify-center bg-transparent text-muted transition-colors duration-150 hover:text-accent focus-visible:text-accent disabled:cursor-not-allowed disabled:opacity-40';
		const branchLabelClass =
			'inline-flex max-w-full items-center gap-1.5 overflow-hidden font-mono text-[11px] text-muted min-[821px]:max-w-[16rem]';
		const attachmentDragActive = $derived(dragDepth > 0);
		const activeAttachmentPreview = $derived.by(
			() => attachments.find((attachment) => attachment.id === attachmentPreviewId) ?? null
		);
		const activeMentionQuery = $derived.by<MentionQueryMatch | null>(() =>
			projectPath && !editorDisabled ? readActiveMentionQuery(value, selectionStart, selectionEnd) : null
		);
	const activeMentionQueryKey = $derived.by(() =>
		activeMentionQuery ? `${activeMentionQuery.start}:${activeMentionQuery.end}:${activeMentionQuery.query}` : null
	);
	const mentionSearchVisible = $derived.by(
		() => activeMentionQuery !== null && activeMentionQueryKey !== dismissedMentionQueryKey
	);
	const mentionSearchHasResults = $derived(mentionSearchResults.length > 0);
	const highlightedMention = $derived.by(
		() => mentionSearchResults[mentionSearchIndex] ?? mentionSearchResults[0] ?? null
	);
	const showPlaceholder = $derived(value.length === 0);

	$effect(() => {
		const nextMentions = mentions.filter((mention) => value.includes(mention.token));
		if (!sameMentions(nextMentions, mentions)) {
			mentions = nextMentions;
		}
	});

	$effect(() => {
		const queryMatch = mentionSearchVisible ? activeMentionQuery : null;

		if (!queryMatch || !projectPath || queryMatch.query.length === 0) {
			if (mentionSearchAbortController) {
				mentionSearchAbortController.abort();
				mentionSearchAbortController = null;
			}
			if (mentionSearchDebounce) {
				clearTimeout(mentionSearchDebounce);
				mentionSearchDebounce = null;
			}
			resetMentionSearch();
			return;
		}

		if (mentionSearchDebounce) {
			clearTimeout(mentionSearchDebounce);
			mentionSearchDebounce = null;
		}

		const requestId = ++mentionSearchRequestId;
		mentionSearchAbortController?.abort();
		const controller = new AbortController();
		mentionSearchAbortController = controller;
		mentionSearchLoading = true;
		mentionSearchError = null;
		mentionSearchDebounce = setTimeout(() => {
			mentionSearchDebounce = null;
			void fetchMentionSearchResults(projectPath, queryMatch.query, requestId, controller);
		}, 120);

		return () => {
			controller.abort();
			if (mentionSearchAbortController === controller) {
				mentionSearchAbortController = null;
			}
			if (mentionSearchDebounce) {
				clearTimeout(mentionSearchDebounce);
				mentionSearchDebounce = null;
			}
		};
	});

	$effect(() => {
		const signature = buildComposerSignature(value, mentions);
		if (signature === lastComposerSignature) {
			return;
		}

		renderComposerDom(value, mentions);
		lastComposerSignature = signature;
	});

	onMount(() => {
		renderComposerDom(value, mentions);
		syncSelectionFromEditor();

		const handleSelectionChange = () => {
			syncSelectionFromEditor();
		};

		document.addEventListener('selectionchange', handleSelectionChange);
		return () => {
			document.removeEventListener('selectionchange', handleSelectionChange);
		};
	});

	function buildComposerSignature(text: string, mentionDrafts: PromptFileMentionDraft[]): string {
		return JSON.stringify({
			text,
			mentions: mentionDrafts
				.map((mention) => ({
					id: mention.id,
					absolutePath: mention.absolutePath,
					token: mention.token
				}))
				.sort((left, right) => left.absolutePath.localeCompare(right.absolutePath))
		});
	}

	function renderComposerDom(text: string, mentionDrafts: PromptFileMentionDraft[]): void {
		if (!editorRef) {
			return;
		}

		const fragment = document.createDocumentFragment();
		for (const segment of buildComposerSegments(text, mentionDrafts)) {
			if (segment.type === 'text') {
				fragment.append(document.createTextNode(segment.text));
				continue;
			}

			fragment.append(createMentionElement(segment.mention));
		}

		editorRef.replaceChildren(fragment);
	}

	function buildComposerSegments(
		text: string,
		mentionDrafts: PromptFileMentionDraft[]
	): ComposerSegment[] {
		if (!text) {
			return [];
		}

		const availableMentions = [...dedupeMentions(mentionDrafts).values()].sort(
			(left, right) => right.token.length - left.token.length
		);
		if (availableMentions.length === 0) {
			return [{ type: 'text', text }];
		}

		const segments: ComposerSegment[] = [];
		let cursor = 0;
		let buffer = '';

		while (cursor < text.length) {
			const match = availableMentions.find((mention) => text.startsWith(mention.token, cursor)) ?? null;
			if (!match) {
				buffer += text[cursor] ?? '';
				cursor += 1;
				continue;
			}

			if (buffer) {
				segments.push({ type: 'text', text: buffer });
				buffer = '';
			}

			segments.push({ type: 'mention', mention: match });
			cursor += match.token.length;
		}

		if (buffer) {
			segments.push({ type: 'text', text: buffer });
		}

		return segments;
	}

	function createMentionElement(mention: PromptFileMentionDraft): HTMLSpanElement {
		const token = document.createElement('span');
		token.dataset.composerMention = 'true';
		token.dataset.mentionId = mention.id;
		token.dataset.mentionName = mention.name;
		token.dataset.mentionRoot = mention.root;
		token.dataset.mentionPath = mention.path;
		token.dataset.mentionAbsolutePath = mention.absolutePath;
		token.dataset.mentionToken = mention.token;
		token.contentEditable = 'false';
		token.className =
			'mr-1 inline-flex max-w-full items-center gap-1 border border-line bg-surface-0 px-2 py-[0.12rem] align-baseline font-mono text-[0.8rem] leading-none text-fg theme-shadow-inset-subtle';

		const label = document.createElement('span');
		label.className = 'truncate';
		label.textContent = mention.token;
		token.append(label);

		const removeButton = document.createElement('button');
		removeButton.type = 'button';
		removeButton.dataset.mentionRemove = mention.id;
		removeButton.className =
			'composer-mention-remove inline-flex h-4 w-4 shrink-0 items-center justify-center border-0 bg-transparent text-muted transition-colors duration-150 hover:text-accent';
		removeButton.setAttribute('aria-label', `Remove ${mention.path}`);
		removeButton.tabIndex = -1;
		removeButton.textContent = '×';
		token.append(removeButton);

		return token;
	}

	function syncBindingsFromEditor(): void {
		if (!editorRef) {
			return;
		}

		const nextState = readComposerStateFromDom(editorRef);
		value = nextState.text;
		mentions = nextState.mentions;
		lastComposerSignature = buildComposerSignature(nextState.text, nextState.mentions);
		syncSelectionFromEditor();
	}

	function readComposerStateFromDom(root: HTMLDivElement): {
		text: string;
		mentions: PromptFileMentionDraft[];
	} {
		const textParts: string[] = [];
		const mentionByPath = new Map<string, PromptFileMentionDraft>();

		const visitNode = (node: Node): void => {
			if (node.nodeType === Node.TEXT_NODE) {
				textParts.push(node.textContent ?? '');
				return;
			}

			if (!(node instanceof HTMLElement)) {
				return;
			}

			if (isMentionElement(node)) {
				const mention = mentionDraftFromElement(node);
				if (mention) {
					textParts.push(mention.token);
					if (!mentionByPath.has(mention.absolutePath)) {
						mentionByPath.set(mention.absolutePath, mention);
					}
				}
				return;
			}

			if (node.tagName === 'BR') {
				textParts.push('\n');
				return;
			}

			for (const child of Array.from(node.childNodes)) {
				visitNode(child);
			}
		};

		for (const child of Array.from(root.childNodes)) {
			visitNode(child);
		}

		return {
			text: textParts.join('').replace(/\u00a0/g, ' '),
			mentions: [...mentionByPath.values()]
		};
	}

	function isMentionElement(node: HTMLElement): boolean {
		return node.dataset.composerMention === 'true';
	}

	function mentionDraftFromElement(node: HTMLElement): PromptFileMentionDraft | null {
		const id = node.dataset.mentionId;
		const name = node.dataset.mentionName;
		const root = node.dataset.mentionRoot;
		const path = node.dataset.mentionPath;
		const absolutePath = node.dataset.mentionAbsolutePath;
		const token = node.dataset.mentionToken;

		if (!id || !name || !root || !path || !absolutePath || !token) {
			return null;
		}

		return {
			id,
			name,
			root,
			path,
			absolutePath,
			token
		};
	}

	function syncSelectionFromEditor(): void {
		if (!editorRef || typeof window === 'undefined') {
			return;
		}

		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) {
			return;
		}

		const range = selection.getRangeAt(0);
		if (!editorRef.contains(range.startContainer) || !editorRef.contains(range.endContainer)) {
			return;
		}

		const startRange = range.cloneRange();
		startRange.selectNodeContents(editorRef);
		startRange.setEnd(range.startContainer, range.startOffset);
		const endRange = range.cloneRange();
		endRange.selectNodeContents(editorRef);
		endRange.setEnd(range.endContainer, range.endOffset);

		selectionStart = startRange.toString().length;
		selectionEnd = endRange.toString().length;
	}

	function setEditorSelection(start: number, end = start): void {
		if (!editorRef || typeof window === 'undefined') {
			return;
		}

		const selection = window.getSelection();
		if (!selection) {
			return;
		}

		const range = document.createRange();
		const startPosition = locateEditorPosition(editorRef, start);
		const endPosition = locateEditorPosition(editorRef, end);
		range.setStart(startPosition.node, startPosition.offset);
		range.setEnd(endPosition.node, endPosition.offset);
		selection.removeAllRanges();
		selection.addRange(range);
		selectionStart = start;
		selectionEnd = end;
	}

	function locateEditorPosition(root: HTMLDivElement, targetOffset: number): { node: Node; offset: number } {
		let remaining = Math.max(0, targetOffset);
		const childNodes = Array.from(root.childNodes);

		for (let index = 0; index < childNodes.length; index += 1) {
			const child = childNodes[index];

			if (child.nodeType === Node.TEXT_NODE) {
				const length = child.textContent?.length ?? 0;
				if (remaining <= length) {
					return { node: child, offset: remaining };
				}
				remaining -= length;
				continue;
			}

			if (!(child instanceof HTMLElement)) {
				continue;
			}

			if (isMentionElement(child)) {
				const length = child.dataset.mentionToken?.length ?? 0;
				if (remaining <= length) {
					return {
						node: root,
						offset: remaining === 0 ? index : index + 1
					};
				}
				remaining -= length;
				continue;
			}

			if (child.tagName === 'BR') {
				if (remaining <= 1) {
					return {
						node: root,
						offset: remaining === 0 ? index : index + 1
					};
				}
				remaining -= 1;
			}
		}

		return { node: root, offset: root.childNodes.length };
	}

	function replaceComposerState(
		nextValue: string,
		nextMentions: PromptFileMentionDraft[],
		options: {
			focus?: boolean;
			selectionStart?: number;
			selectionEnd?: number;
		} = {}
	): void {
		value = nextValue;
		mentions = nextMentions.filter((mention) => nextValue.includes(mention.token));
		lastComposerSignature = buildComposerSignature(value, mentions);
		renderComposerDom(value, mentions);

		if (options.focus) {
			editorRef?.focus();
		}

		if (options.selectionStart !== undefined) {
			setEditorSelection(options.selectionStart, options.selectionEnd ?? options.selectionStart);
			return;
		}

		syncSelectionFromEditor();
	}

	function resetMentionSearch(): void {
		mentionSearchLoading = false;
		mentionSearchResults = [];
		mentionSearchIndex = 0;
		mentionSearchError = null;
	}

	async function fetchMentionSearchResults(
		rootPath: string,
		query: string,
		requestId: number,
		controller: AbortController
	): Promise<void> {
		try {
			const response = await fetch(
				`/api/file-mentions/search?projectPath=${encodeURIComponent(rootPath)}&query=${encodeURIComponent(query)}`,
				{
					signal: controller.signal
				}
			);
			const payload = (await response.json().catch(() => null)) as FuzzyFileSearchResponse | null;

			if (!response.ok) {
				throw new Error('File search failed');
			}

			if (requestId !== mentionSearchRequestId || controller.signal.aborted) {
				return;
			}

			mentionSearchResults = (payload?.files ?? [])
				.filter((entry) => entry.match_type === 'file')
				.slice(0, 8);
			mentionSearchIndex = 0;
			mentionSearchError = null;
		} catch (error) {
			if (controller.signal.aborted || requestId !== mentionSearchRequestId) {
				return;
			}

			mentionSearchResults = [];
			mentionSearchIndex = 0;
			mentionSearchError = error instanceof Error ? error.message : 'File search failed';
		} finally {
			if (requestId === mentionSearchRequestId && !controller.signal.aborted) {
				mentionSearchLoading = false;
			}
			if (mentionSearchAbortController === controller) {
				mentionSearchAbortController = null;
			}
			if (requestId === mentionSearchRequestId && mentionSearchDebounce) {
				clearTimeout(mentionSearchDebounce);
				mentionSearchDebounce = null;
			}
		}
	}

	async function handleSubmit(): Promise<void> {
		if ((!value.trim() && attachments.length === 0 && mentions.length === 0) || sendDisabled) {
			return;
		}

		const submitPayload: PromptSubmitPayload = {
			message: value.trim(),
			attachments: [...attachments],
			mentions: [...mentions]
		};
		isSubmitting = true;

			try {
				await onsubmit?.(submitPayload);
				value = '';
				attachments = [];
				attachmentPreviewId = null;
				mentions = [];
				advancedOpen = false;
			resetMentionSearch();
			lastComposerSignature = buildComposerSignature(value, mentions);
			renderComposerDom(value, mentions);
			setEditorSelection(0, 0);
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

	function handleEditorInput(): void {
		syncBindingsFromEditor();
		dismissedMentionQueryKey = null;
	}

	function handleEditorClick(event: MouseEvent): void {
		const target = event.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}

		const removeButton = target.closest<HTMLElement>('[data-mention-remove]');
		if (removeButton?.dataset.mentionRemove) {
			event.preventDefault();
			void removeMention(removeButton.dataset.mentionRemove);
			return;
		}

		syncSelectionFromEditor();
	}

	function handleEditorPaste(event: ClipboardEvent): void {
		const pastedText = event.clipboardData?.getData('text/plain');
		if (pastedText === undefined) {
			return;
		}

		event.preventDefault();
		insertTextAtSelection(pastedText);
	}

	function handleBeforeInput(event: InputEvent): void {
		if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
			event.preventDefault();
			insertTextAtSelection('\n');
		}
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (mentionSearchVisible) {
			switch (event.key) {
				case 'ArrowDown':
					if (mentionSearchResults.length === 0) {
						break;
					}
					event.preventDefault();
					mentionSearchIndex = (mentionSearchIndex + 1) % mentionSearchResults.length;
					return;
				case 'ArrowUp':
					if (mentionSearchResults.length === 0) {
						break;
					}
					event.preventDefault();
					mentionSearchIndex =
						(mentionSearchIndex - 1 + mentionSearchResults.length) % mentionSearchResults.length;
					return;
				case 'Tab':
				case 'Enter':
					event.preventDefault();
					if (highlightedMention) {
						void insertMention(highlightedMention);
					}
					return;
				case 'Escape':
					event.preventDefault();
					dismissedMentionQueryKey = activeMentionQueryKey;
					resetMentionSearch();
					return;
			}
		}

		if (event.key === 'Enter' && !event.shiftKey && !isStreaming) {
			event.preventDefault();
			void handleSubmit();
		}
	}

	function insertTextAtSelection(text: string): void {
		if (!editorRef || typeof window === 'undefined') {
			return;
		}

		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) {
			return;
		}

		const range = selection.getRangeAt(0);
		if (!editorRef.contains(range.startContainer) || !editorRef.contains(range.endContainer)) {
			return;
		}

		range.deleteContents();
		const node = document.createTextNode(text);
		range.insertNode(node);
		range.setStart(node, text.length);
		range.collapse(true);
		selection.removeAllRanges();
		selection.addRange(range);
		syncBindingsFromEditor();
	}

		function openFilePicker(): void {
			fileInputRef?.click();
		}

		function handleFileInputChange(event: Event): void {
			const input = event.currentTarget as HTMLInputElement | null;
			const files = filterSupportedImageFiles(input?.files ?? []);
			if (files.length === 0) {
				if (input) {
					input.value = '';
				}
				return;
			}

			appendAttachmentFiles(files);

			if (input) {
				input.value = '';
			}
		}

		function handleComposerDragEnter(event: DragEvent): void {
			if (attachmentDisabled || !hasFilePayload(event)) {
				return;
			}

			event.preventDefault();
			if (hasSupportedImagePayload(event)) {
				dragDepth += 1;
			}
		}

		function handleComposerDragOver(event: DragEvent): void {
			if (attachmentDisabled || !hasFilePayload(event)) {
				return;
			}

			event.preventDefault();
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'copy';
			}
		}

		function handleComposerDragLeave(event: DragEvent): void {
			if (attachmentDisabled || dragDepth === 0) {
				return;
			}

			event.preventDefault();
			dragDepth = Math.max(0, dragDepth - 1);
		}

		function handleComposerDrop(event: DragEvent): void {
			const droppedFiles = Array.from(event.dataTransfer?.files ?? []);
			dragDepth = 0;
			if (attachmentDisabled || droppedFiles.length === 0) {
				return;
			}

			event.preventDefault();
			const files = filterSupportedImageFiles(droppedFiles);
			if (files.length === 0) {
				return;
			}

			appendAttachmentFiles(files);
			editorRef?.focus();
		}

		function removeAttachment(attachmentId: string): void {
			const target = attachments.find((attachment) => attachment.id === attachmentId);
			if (!target) {
				return;
			}

			URL.revokeObjectURL(target.previewUrl);
			if (attachmentPreviewId === attachmentId) {
				attachmentPreviewId = null;
			}
			attachments = attachments.filter((attachment) => attachment.id !== attachmentId);
		}

		function openAttachmentPreview(attachmentId: string): void {
			attachmentPreviewId = attachmentId;
		}

		function closeAttachmentPreview(): void {
			attachmentPreviewId = null;
		}

		function handleAttachmentPreviewBackdropClick(event: MouseEvent): void {
			if (event.target === event.currentTarget) {
				closeAttachmentPreview();
			}
		}

		function handleAttachmentPreviewKeydown(event: KeyboardEvent): void {
			if (event.key === 'Escape') {
				event.preventDefault();
				closeAttachmentPreview();
			}
		}

	async function insertMention(result: FuzzyFileSearchResult): Promise<void> {
		const queryMatch = activeMentionQuery;
		if (!queryMatch) {
			return;
		}

		const mention = toMentionDraft(result);
		const existing = mentions.find((entry) => entry.absolutePath === mention.absolutePath) ?? mention;
		const prefix = value.slice(0, queryMatch.start);
		const suffix = value.slice(queryMatch.end);
		const leadingSpacer = prefix.length > 0 && !/\s$/.test(prefix) ? ' ' : '';
		const trailingSpacer = suffix.length > 0 && !/^\s/.test(suffix) ? ' ' : '';
		const inserted = `${leadingSpacer}${existing.token}${trailingSpacer}`;
		const nextValue = `${prefix}${inserted}${suffix}`;
		const nextCaret = prefix.length + inserted.length;
		const nextMentions = dedupeMentionDraftList([
			...mentions.filter((entry) => entry.absolutePath !== existing.absolutePath),
			existing
		]);

		replaceComposerState(nextValue, nextMentions, {
			focus: true,
			selectionStart: nextCaret,
			selectionEnd: nextCaret
		});
		dismissedMentionQueryKey = null;
		resetMentionSearch();
	}

	async function removeMention(mentionId: string): Promise<void> {
		const target = mentions.find((mention) => mention.id === mentionId);
		if (!target) {
			return;
		}

		const nextValue = removeMentionToken(value, target.token);
		const nextMentions = mentions.filter((mention) => mention.id !== mentionId);
		replaceComposerState(nextValue, nextMentions, {
			focus: true,
			selectionStart: Math.min(selectionStart, nextValue.length)
		});
		await tick();
	}

		function formatAttachmentSize(byteLength: number): string {
		if (byteLength >= 1_000_000) {
			return `${(byteLength / 1_000_000).toFixed(1)} MB`;
		}

		return `${Math.max(1, Math.round(byteLength / 1_000))} KB`;
	}

	function toMentionDraft(result: FuzzyFileSearchResult): PromptFileMentionDraft {
		const absolutePath = `${result.root}/${result.path}`.replace(/\/+/g, '/');
		return {
			id: crypto.randomUUID(),
			name: result.file_name,
			root: result.root,
			path: result.path,
			absolutePath,
			token: `@${result.path}`
		};
	}

	function readActiveMentionQuery(
		text: string,
		rangeStart: number,
		rangeEnd: number
	): MentionQueryMatch | null {
		if (rangeStart !== rangeEnd) {
			return null;
		}

		let start = rangeStart;
		while (start > 0) {
			const previousChar = text[start - 1];
			if (/\s/.test(previousChar)) {
				break;
			}
			start -= 1;
		}

		const segment = text.slice(start, rangeStart);
		if (!segment.startsWith('@')) {
			return null;
		}

		const previousChar = start > 0 ? text[start - 1] : null;
		if (previousChar && /[A-Za-z0-9._/-]/.test(previousChar)) {
			return null;
		}

		return {
			start,
			end: rangeStart,
			query: segment.slice(1)
		};
	}

	function removeMentionToken(text: string, token: string): string {
		const escapedToken = escapeRegExp(token);
		return text
			.replace(new RegExp(`(^|[ \\t\\n])${escapedToken}(?=($|[ \\t\\n]))`, 'g'), '$1')
			.replace(/[ \t]{2,}/g, ' ')
			.replace(/ *\n */g, '\n')
			.trim();
	}

	function dedupeMentions(
		mentionDrafts: PromptFileMentionDraft[]
	): Map<string, PromptFileMentionDraft> {
		const mentionByPath = new Map<string, PromptFileMentionDraft>();
		for (const mention of mentionDrafts) {
			if (!mentionByPath.has(mention.absolutePath)) {
				mentionByPath.set(mention.absolutePath, mention);
			}
		}
		return mentionByPath;
	}

		function dedupeMentionDraftList(
			mentionDrafts: PromptFileMentionDraft[]
		): PromptFileMentionDraft[] {
			return [...dedupeMentions(mentionDrafts).values()];
		}

		function filterSupportedImageFiles(files: Iterable<File>): File[] {
			return Array.from(files).filter((file) => supportedImageTypes.has(file.type));
		}

		function appendAttachmentFiles(files: File[]): void {
			if (files.length === 0) {
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
		}

		function hasFilePayload(event: DragEvent): boolean {
			const items = Array.from(event.dataTransfer?.items ?? []);
			if (items.length > 0) {
				return items.some((item) => item.kind === 'file');
			}

			return (event.dataTransfer?.files.length ?? 0) > 0;
		}

		function hasSupportedImagePayload(event: DragEvent): boolean {
			const items = Array.from(event.dataTransfer?.items ?? []);
			if (items.length > 0) {
				return items.some((item) => item.kind === 'file' && supportedImageTypes.has(item.type));
			}

			return filterSupportedImageFiles(event.dataTransfer?.files ?? []).length > 0;
		}

	function sameMentions(
		left: PromptFileMentionDraft[],
		right: PromptFileMentionDraft[]
	): boolean {
		return (
			left.length === right.length &&
			left.every((entry, index) => entry.id === right[index]?.id && entry.token === right[index]?.token)
		);
	}

	function escapeRegExp(value: string): string {
		return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
</script>

	<div class="grid w-full gap-2">
		<div
			class="relative w-full overflow-hidden border border-line bg-surface-1 transition-[background-color,border-color] duration-150 focus-within:bg-surface-1"
			class:opacity-50={disabled && !isStreaming}
			class:border-accent={attachmentDragActive}
			class:bg-surface-2={attachmentDragActive}
			role="group"
			aria-label="Prompt composer"
			ondragenter={handleComposerDragEnter}
			ondragover={handleComposerDragOver}
			ondragleave={handleComposerDragLeave}
			ondrop={handleComposerDrop}
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

			{#if attachments.length > 0}
				<div class="flex flex-wrap gap-2 px-4 pt-4">
					{#each attachments as attachment (attachment.id)}
						<div class="inline-flex min-w-0 max-w-full items-center border border-line bg-surface-1/92 pr-1.5 theme-shadow-inset-subtle">
							<button
								type="button"
								class="flex min-w-0 max-w-full items-center gap-2 px-2.5 py-2 text-left transition-colors duration-150 hover:text-accent"
								onclick={() => openAttachmentPreview(attachment.id)}
								aria-label={`Preview ${attachment.file.name}`}
							>
								<img
									src={attachment.previewUrl}
									alt={attachment.file.name}
									class="h-7 w-7 shrink-0 border border-line object-cover"
								/>
								<span class="truncate text-[13px] text-fg">{attachment.file.name}</span>
							</button>

							<button
								type="button"
								aria-label={`Remove ${attachment.file.name}`}
								onclick={() => removeAttachment(attachment.id)}
								disabled={attachmentDisabled}
								class="inline-flex h-7 w-7 shrink-0 items-center justify-center bg-transparent text-muted transition-colors duration-150 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
							>
								<XIcon size={14} />
							</button>
						</div>
					{/each}
				</div>
			{/if}

			<div class="px-4 pt-3">
				<div
					bind:this={editorRef}
				contenteditable={editorDisabled ? 'false' : 'true'}
				tabindex={editorDisabled ? -1 : 0}
				role="textbox"
				aria-multiline="true"
				aria-label="Prompt input"
				data-placeholder={placeholder}
				data-empty={showPlaceholder ? 'true' : 'false'}
				oninput={handleEditorInput}
				onclick={handleEditorClick}
				onfocus={syncSelectionFromEditor}
				onkeyup={syncSelectionFromEditor}
				onpaste={handleEditorPaste}
				onbeforeinput={handleBeforeInput}
				onkeydown={handleKeydown}
					class="composer-editor min-h-[104px] max-h-56 overflow-y-auto whitespace-pre-wrap break-words bg-transparent pb-3 text-[16px] leading-relaxed text-fg outline-none min-[821px]:min-h-[92px] min-[821px]:text-[14px]"
				></div>
			</div>

		{#if mentionSearchVisible}
			<div class="-mt-2 px-3 pb-3">
				<div
					class="theme-shadow-elevated-soft overflow-hidden border border-line bg-surface-0"
				>
					{#if activeMentionQuery?.query.length === 0}
						<div class="px-3 py-2.5 text-[12px] text-muted">Type after `@` to search project files</div>
					{:else if mentionSearchLoading}
						<div class="flex items-center gap-2 px-3 py-2.5 text-[12px] text-muted">
							<SpinnerGapIcon size={14} class="animate-spin" />
							<span>Searching project files</span>
						</div>
					{:else if mentionSearchHasResults}
						<div class="grid">
							{#each mentionSearchResults as result, index (`${result.root}/${result.path}`)}
								<button
									type="button"
									class="grid gap-0.5 border-b border-line px-3 py-2.5 text-left transition-colors duration-150 last:border-b-0 hover:bg-surface-1"
									class:bg-surface-1={index === mentionSearchIndex}
									onmousedown={(event) => event.preventDefault()}
									onclick={() => void insertMention(result)}
								>
									<span class="truncate text-[12px] font-medium text-fg">{result.file_name}</span>
									<span class="truncate font-mono text-[11px] text-muted">{result.path}</span>
								</button>
							{/each}
						</div>
					{:else}
						<div class="px-3 py-2.5 text-[12px] text-muted">
							{mentionSearchError ?? 'No matching files found'}
						</div>
					{/if}
				</div>
			</div>
		{/if}

			<div class="-mt-px flex justify-end px-2 py-1.5">
			<button
				type="button"
				aria-label={isStreaming
					? isInterrupting
						? 'Stopping agent'
						: 'Stop agent'
					: 'Send message'}
				onclick={() => void (isStreaming ? handleInterrupt() : handleSubmit())}
				disabled={isStreaming ? stopDisabled : sendDisabled}
				class="inline-flex h-10 w-10 items-center justify-center bg-surface-0 text-fg transition-[background-color,color] duration-150 hover:text-accent focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
			>
				{#if isStreaming}
					{#if isInterrupting}
						<SpinnerGapIcon size={16} class="animate-spin" />
					{:else}
						<StopCircleIcon size={16} />
					{/if}
				{:else if isSending}
					<SpinnerGapIcon size={16} class="animate-spin" />
				{:else}
					<ArrowUpIcon size={16} />
				{/if}
			</button>
		</div>

		{#if activeAttachmentPreview}
			<div
				class="fixed inset-0 z-[70] bg-black/72 p-4 backdrop-blur-sm"
				role="dialog"
				aria-modal="true"
				aria-label={`Preview ${activeAttachmentPreview.file.name}`}
				tabindex="-1"
				onclick={handleAttachmentPreviewBackdropClick}
				onkeydown={handleAttachmentPreviewKeydown}
			>
				<div class="flex h-full w-full items-center justify-center">
					<div
						class="theme-shadow-elevated-strong flex max-h-full w-full max-w-5xl flex-col overflow-hidden border border-line bg-surface-1"
					>
						<div class="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
							<div class="min-w-0">
								<p class="truncate text-[13px] text-fg">{activeAttachmentPreview.file.name}</p>
								<p class="text-[11px] text-muted">
									{formatAttachmentSize(activeAttachmentPreview.file.size)}
								</p>
							</div>
							<button
								type="button"
								class="inline-flex h-8 w-8 items-center justify-center bg-transparent text-muted transition-colors duration-150 hover:text-accent"
								onclick={closeAttachmentPreview}
								aria-label="Close preview"
							>
								<XIcon size={16} />
							</button>
						</div>
						<div class="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
							<img
								src={activeAttachmentPreview.previewUrl}
								alt={activeAttachmentPreview.file.name}
								class="max-h-[calc(100vh-9rem)] max-w-full object-contain"
							/>
						</div>
					</div>
				</div>
			</div>
		{/if}
	</div>

		<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2 min-[821px]:hidden">
			<div class="flex min-w-0 items-center gap-2">
				<AppSelect
					bind:value={selectedModel}
					items={modelOptions}
					placeholder="default"
					triggerClass={mobileModelClass}
					ariaLabel="Model"
				/>

				<Popover.Root bind:open={advancedOpen}>
					<Popover.Trigger
						class={ghostButtonClass}
						aria-label="Advanced options"
					>
						<GearSixIcon size={16} />
					</Popover.Trigger>

					<Popover.Portal>
						<Popover.Content
							sideOffset={10}
							align="start"
							class="theme-shadow-elevated-strong z-50 grid w-[min(18rem,calc(100vw-1rem))] gap-2 border border-line bg-surface-1 p-2 outline-none min-[821px]:hidden"
						>
							<div class="grid gap-1.5">
								<div class={settingsSectionLabelClass}>
									<BrainIcon size={12} />
									<span>Thinking Mode</span>
								</div>
								<AppSelect
									bind:value={selectedEffort}
									items={effortSelectOptions}
									placeholder="effort"
									triggerClass={inlineSelectClass}
									ariaLabel="Reasoning effort"
								/>
							</div>

							<div class="grid gap-1.5">
								<div class={settingsSectionLabelClass}>
									<ListChecksIcon size={12} />
									<span>Build / Plan</span>
								</div>
								<AppSelect
									bind:value={selectedMode}
									items={modeOptions}
									placeholder="mode"
									triggerClass={inlineSelectClass}
									ariaLabel="Prompt mode"
								/>
							</div>

							<div class="grid gap-1.5">
								<div class={settingsSectionLabelClass}>
									<ShieldCheckIcon size={12} />
									<span>Permissions</span>
								</div>
								<AppSelect
									bind:value={selectedPermissionPreset}
									items={permissionOptions}
									placeholder="permissions"
									triggerClass={inlineSelectClass}
									ariaLabel="Permission preset"
								/>
							</div>
						</Popover.Content>
					</Popover.Portal>
				</Popover.Root>

				<button
					type="button"
					class={ghostButtonClass}
					onclick={openFilePicker}
					aria-label="Attach images"
					disabled={attachmentDisabled}
				>
					<PaperclipIcon size={16} />
				</button>
			</div>

			{#if branchLabel}
				<div class={`${branchLabelClass} justify-self-end`} title={branchLabel}>
					<GitBranchIcon size={12} />
					<span class="truncate">{branchLabel}</span>
				</div>
			{/if}
		</div>

	<div class="hidden min-[821px]:grid min-[821px]:grid-cols-[minmax(0,1fr)_auto] min-[821px]:items-center min-[821px]:gap-3 min-[821px]:px-2">
		<div class="flex min-w-0 items-center gap-2">
			<AppSelect
				bind:value={selectedModel}
				items={modelOptions}
				placeholder="default"
				triggerClass={`${controlTriggerClass} ${desktopModelClass}`}
				ariaLabel="Model"
			/>

			<Popover.Root bind:open={desktopAdvancedOpen}>
				<Popover.Trigger
					class={ghostButtonClass}
					aria-label="Advanced options"
				>
					<GearSixIcon size={16} />
				</Popover.Trigger>

				<Popover.Portal>
					<Popover.Content
						sideOffset={10}
						align="start"
						class="theme-shadow-elevated-strong z-50 grid w-[18rem] gap-2 border border-line bg-surface-1 p-2 outline-none"
					>
						<div class="grid gap-1.5">
							<div class={settingsSectionLabelClass}>
								<BrainIcon size={12} />
								<span>Thinking Mode</span>
							</div>
							<AppSelect
								bind:value={selectedEffort}
								items={effortSelectOptions}
								placeholder="effort"
								triggerClass={inlineSelectClass}
								ariaLabel="Reasoning effort"
							/>
						</div>

						<div class="grid gap-1.5">
							<div class={settingsSectionLabelClass}>
								<ListChecksIcon size={12} />
								<span>Build / Plan</span>
							</div>
							<AppSelect
								bind:value={selectedMode}
								items={modeOptions}
								placeholder="mode"
								triggerClass={inlineSelectClass}
								ariaLabel="Prompt mode"
							/>
						</div>

						<div class="grid gap-1.5">
							<div class={settingsSectionLabelClass}>
								<ShieldCheckIcon size={12} />
								<span>Permissions</span>
							</div>
							<AppSelect
								bind:value={selectedPermissionPreset}
								items={permissionOptions}
								placeholder="permissions"
								triggerClass={inlineSelectClass}
								ariaLabel="Permission preset"
							/>
						</div>
					</Popover.Content>
				</Popover.Portal>
			</Popover.Root>

			<button
				type="button"
				class={ghostButtonClass}
				onclick={openFilePicker}
				aria-label="Attach images"
				disabled={attachmentDisabled}
			>
				<PaperclipIcon size={16} />
			</button>
		</div>

		{#if branchLabel}
			<div class={`${branchLabelClass} justify-self-end`} title={branchLabel}>
				<GitBranchIcon size={12} />
				<span class="truncate">{branchLabel}</span>
			</div>
		{/if}
	</div>
</div>

<style>
	.composer-editor[data-empty='true']::before {
		content: attr(data-placeholder);
		color: var(--color-muted);
		pointer-events: none;
	}
</style>
