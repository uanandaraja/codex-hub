<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import {
		ArchiveIcon,
		CaretDownIcon,
		CaretRightIcon,
		ListIcon,
		PlusIcon,
		PushPinIcon,
		SpinnerGapIcon,
		XIcon
	} from 'phosphor-svelte';
	import vscodeLogo from '$lib/assets/vscode.svg';
	import ChatMessage from '$lib/components/ChatMessage.svelte';
	import PromptInput from '$lib/components/PromptInput.svelte';
	import ServerRequestPanel from '$lib/components/ServerRequestPanel.svelte';
	import SidebarAccountStatus from '$lib/components/SidebarAccountStatus.svelte';
	import ToolActivity from '$lib/components/ToolActivity.svelte';
	import { formatModelDisplayName } from '$lib/model-display-name';
	import type {
		PromptAttachmentDraft,
		PromptFileMentionDraft,
		PromptSubmitPayload
	} from '$lib/components/prompt-input.types';
	import type { PageData } from './$types';
	import type {
		CodexThread,
		CodexTurn,
		CodexThreadItem,
		GatewayStatus,
		ModelSummary,
		PendingServerRequest,
		PendingServerRequestListResponse,
		ProjectSummary,
		RpcNotification,
		ThreadListResponse,
		ThreadReadResponse,
		ThreadNameGenerateResponse,
		ThreadStartResponse,
		ThreadUsageResponse
	} from '$lib/types';

	type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
	type PromptMode = 'build' | 'plan';
	type PermissionPreset = 'ask' | 'auto' | 'full';

	type RenderedConversationEntry = {
		item: CodexThreadItem;
		turnId: string;
		turnStatus: string;
		showStatusNote: boolean;
	};
	type UserImageAttachment = {
		src: string;
		alt: string;
	};
	type PromptDraft = PromptSubmitPayload;
	type FetchThreadOptions = {
		fullHistory?: boolean;
		includeUsage?: boolean;
	};

	const PROMPT_PREFERENCES_KEY = 'codex-hub.prompt-preferences';
	const PINNED_PROJECTS_KEY = 'codex-hub.pinned-projects';
	const DESKTOP_SIDEBAR_OPEN_KEY = 'codex-hub.desktop-sidebar-open';
	const THREAD_PERMISSION_PRESETS_KEY = 'codex-hub.thread-permission-presets';
	const THREAD_NAME_BACKFILL_KEY = 'codex-hub.thread-name-backfill-v2';
	const INITIAL_THREAD_TAIL_TURNS = 24;

	let { data } = $props<{ data: PageData }>();
	let pinnedProjectPaths = $state<Record<string, true>>({});

	const initialStatus = untrack(() => data.status);
	const initialModels = untrack(() => sortModels(data.models));
	const initialProjects = untrack(() => sortProjects(data.projects));
	const initialThreads = untrack(() => sortThreads(data.threads));
	const editorEnabled = untrack(() => data.editorEnabled);
	const initialBanner = untrack(
		() =>
			data.errors.status ??
			data.errors.projects ??
			data.errors.models ??
			data.errors.threads ??
			null
	);
	const initialProjectPath = untrack(() => data.initialProjectPath ?? null);
	const initialThreadId = untrack(() => data.initialThreadId ?? null);
	const initialDetailedThread = untrack(() => data.initialThread ?? null);
	const initialThreadUsage = untrack(() => data.initialThreadUsage ?? {});
	const initialThreadTruncatedTurnCount = untrack(() => data.initialThreadTruncatedTurnCount ?? 0);
	const initialPendingRequests = untrack(() => data.initialPendingRequests ?? []);

	let status = $state<GatewayStatus | null>(initialStatus);
	let models = $state<ModelSummary[]>(initialModels);
	let projects = $state<ProjectSummary[]>(initialProjects);
	let threads = $state<CodexThread[]>(initialThreads);
	let projectThreadsByPath = $state<Record<string, CodexThread[]>>(
		initialProjectPath ? { [initialProjectPath]: initialThreads } : {}
	);
	let threadDetails = $state<Record<string, CodexThread>>(
		initialDetailedThread ? { [initialDetailedThread.id]: initialDetailedThread } : {}
	);
	let threadUsageByThread = $state<Record<string, ThreadReadResponse['usage']['turns']>>(
		initialThreadId ? { [initialThreadId]: initialThreadUsage } : {}
	);
	let threadTruncatedTurnCountByThread = $state<Record<string, number>>(
		initialThreadId && initialThreadTruncatedTurnCount > 0
			? { [initialThreadId]: initialThreadTruncatedTurnCount }
			: {}
	);
	let namingThreadIds = $state<Record<string, boolean>>({});
	let pendingRequestsByThread = $state<Record<string, PendingServerRequest[]>>(
		initialThreadId ? { [initialThreadId]: initialPendingRequests } : {}
	);
	let selectedProjectPath = $state<string | null>(initialProjectPath);
	let selectedThreadId = $state<string | null>(initialThreadId);
	let selectedModel = $state<string | null>(resolveInitialModel(initialModels));
	let selectedEffort = $state<ReasoningEffort | null>(resolveInitialEffort(initialModels));
	let selectedMode = $state<PromptMode>('build');
	let draftPermissionPreset = $state<PermissionPreset>('full');
	let threadPermissionPresets = $state<Record<string, PermissionPreset>>({});
	let selectedPermissionPreset = $state<PermissionPreset>('full');
	let pendingAttachmentReleases = $state<Record<string, PromptAttachmentDraft[]>>({});
	let creatingThread = $state(false);
	let refreshingWorkspace = $state(false);
	let resolvingRequestId = $state<number | null>(null);
	let banner = $state<string | null>(initialBanner);
	let composer = $state('');
	let composerAttachments = $state<PromptAttachmentDraft[]>([]);
	let composerMentions = $state<PromptFileMentionDraft[]>([]);
	let promptDraftsByKey = $state<Record<string, PromptDraft>>({});
	let notificationPermission = $state<NotificationPermission | 'unsupported'>('unsupported');
	let activeTurnIdsByThread = $state<Record<string, string>>({});
	let activeTurnStartedAtByThread = $state<Record<string, number>>({});
	let interruptingTurnsByThread = $state<Record<string, true>>({});
	let expandedProjectPaths = $state<Record<string, true>>(
		initialProjectPath ? { [initialProjectPath]: true } : {}
	);
	let loadingProjectThreadsByPath = $state<Record<string, true>>({});
	let archivingThreadIds = $state<Record<string, true>>({});
	let streamTickMs = $state(Date.now());
	let turnElapsedSeconds = $state<Record<string, number>>({});
	let conversationBody = $state<HTMLElement | null>(null);
	let sidebarOpen = $state(false);
	let isDesktopViewport = false;
	let desktopSidebarPreference: boolean | null = null;
	let hasMounted = false;
	let optimisticTurnCounter = 0;
	let syncedPermissionThreadId: string | null | undefined = undefined;
	let syncedComposerDraftKey: string | null = null;
	let notifiedRequestIds = $state<Record<string, true>>({});
	let notifiedTurnEvents = $state<Record<string, true>>({});
	let fullHistoryThreadIds = $state<Record<string, true>>({});
	let loadingFullHistoryThreadIds = $state<Record<string, true>>({});
	const threadEventSources = new Map<string, EventSource>();
	const threadEventsReadyByThread = new Map<string, Promise<void>>();
	let suppressNextAutoScroll = false;
	let showScrollToBottom = $state(false);
	const conversationBottomThresholdPx = 56;

	const iconButtonClass =
		'inline-flex h-11 w-11 items-center justify-center border border-line bg-transparent text-fg transition-[background,border-color,color] duration-150 hover:border-accent hover:text-accent disabled:cursor-default disabled:opacity-[0.45]';
	const toolbarLinkClass =
		'pointer-events-auto hidden h-11 items-center gap-2 border border-line bg-surface-1/88 px-4 font-mono text-[0.74rem] uppercase tracking-[0.16em] text-fg backdrop-blur-sm transition-[background,border-color,color] duration-150 hover:border-accent hover:text-accent min-[821px]:inline-flex';
	const projectRowClass =
		'group flex w-full min-w-0 items-center gap-1 border-0 border-l-2 border-l-transparent bg-transparent pl-[0.45rem] text-fg transition-[background-color,border-color] duration-150';
	const projectExpandButtonClass =
		'inline-flex h-9 w-9 shrink-0 items-center justify-center border-0 bg-transparent text-muted transition-colors duration-150 hover:text-fg';
	const projectSelectButtonClass =
		'flex min-w-0 flex-1 items-center border-0 bg-transparent py-[0.95rem] pr-2 text-left text-fg';
	const projectCreateButtonClass =
		'mr-[0.55rem] inline-flex h-8 w-8 shrink-0 items-center justify-center border-0 bg-surface-1 text-fg transition-[opacity,color,border-color,background-color] duration-150 min-[821px]:pointer-events-none min-[821px]:border-transparent min-[821px]:bg-transparent min-[821px]:text-muted min-[821px]:opacity-0 min-[821px]:group-hover:pointer-events-auto min-[821px]:group-hover:opacity-100 min-[821px]:group-focus-within:pointer-events-auto min-[821px]:group-focus-within:opacity-100 min-[821px]:hover:border-line min-[821px]:hover:text-fg min-[821px]:focus-visible:border-line min-[821px]:focus-visible:text-fg disabled:cursor-default disabled:opacity-40';
	const projectPinButtonClass =
		'pointer-events-none inline-flex h-8 w-8 shrink-0 items-center justify-center border border-transparent bg-transparent text-muted opacity-0 transition-[opacity,color,border-color,background-color] duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 hover:border-line hover:text-fg focus-visible:border-line focus-visible:text-fg';
	const chatRowClass =
		'group relative flex w-full min-w-0 items-center gap-3 border-0 border-l-[3px] border-l-transparent bg-transparent px-[1.1rem] py-[0.82rem] pl-[1.85rem] text-left text-fg transition-[background-color,border-color,color] duration-150 hover:bg-surface-2/55';
	const chatSelectButtonClass =
		'flex min-w-0 flex-1 items-center gap-3 border-0 bg-transparent py-[0.05rem] pr-1 text-left text-fg';
	const threadArchiveButtonClass =
		'pointer-events-none inline-flex h-8 w-8 shrink-0 items-center justify-center border border-transparent bg-transparent text-muted opacity-0 transition-[opacity,color,border-color] duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 hover:border-line hover:text-fg focus-visible:border-line focus-visible:text-fg disabled:cursor-default disabled:opacity-40';
	const currentProject = $derived.by<ProjectSummary | null>(
		() => projects.find((project) => project.path === selectedProjectPath) ?? null
	);
	const showHomeScreen = $derived.by(() => !selectedProjectPath && projects.length > 0);
	const homeProjects = $derived.by<ProjectSummary[]>(() =>
		[...projects]
			.sort((left, right) => {
				const byActivity = right.updatedAt - left.updatedAt;
				if (byActivity !== 0) {
					return byActivity;
				}

				const byThreadCount = right.threadCount - left.threadCount;
				if (byThreadCount !== 0) {
					return byThreadCount;
				}

				return left.name.localeCompare(right.name, undefined, {
					sensitivity: 'base'
				});
			})
			.slice(0, 3)
	);
	const selectedModelSummary = $derived.by<ModelSummary | null>(
		() => models.find((model) => model.model === selectedModel) ?? null
	);
	const availableEfforts = $derived.by<ReasoningEffort[]>(() => {
		const model = selectedModelSummary;
		if (!model) {
			return ['medium'];
		}

		return model.supportedReasoningEfforts.map((option) => option.reasoningEffort);
	});
	const permissionPresetConfig = $derived.by(() =>
		resolvePermissionPreset(selectedPermissionPreset)
	);

	const projectThreads = $derived.by<CodexThread[]>(() => sortThreads(threads));

	const currentThread = $derived.by<CodexThread | null>(() => {
		if (!selectedThreadId) {
			return null;
		}

		return threadDetails[selectedThreadId] ?? null;
	});
	const selectedThreadSummary = $derived.by<CodexThread | null>(() => {
		if (!selectedThreadId) {
			return null;
		}

		return threads.find((thread) => thread.id === selectedThreadId) ?? null;
	});
	const selectedThreadLabel = $derived.by(() =>
		selectedThreadSummary ? chatLabel(selectedThreadSummary) : 'loading chat'
	);
	const isOpeningThread = $derived.by(
		() => selectedThreadId !== null && selectedThreadSummary !== null && currentThread === null
	);
	const activePendingRequests = $derived.by<PendingServerRequest[]>(() =>
		selectedThreadId ? (pendingRequestsByThread[selectedThreadId] ?? []) : []
	);
	const activeQuestionRequests = $derived.by<PendingServerRequest[]>(() =>
		activePendingRequests.filter((request) => request.method === 'item/tool/requestUserInput')
	);
	const activeFooterRequests = $derived.by<PendingServerRequest[]>(() =>
		activePendingRequests.filter((request) => request.method !== 'item/tool/requestUserInput')
	);
	const currentThreadUsage = $derived.by<ThreadReadResponse['usage']['turns']>(() =>
		selectedThreadId ? (threadUsageByThread[selectedThreadId] ?? {}) : {}
	);
	const currentThreadTruncatedTurnCount = $derived.by(() =>
		selectedThreadId ? (threadTruncatedTurnCountByThread[selectedThreadId] ?? 0) : 0
	);

	const renderedConversationEntries = $derived.by<RenderedConversationEntry[]>(() =>
		currentThread
			? currentThread.turns.flatMap((turn) => {
					const statusNoteIndex = findLastTurnStatusAnchorIndex(turn.items);
					return turn.items
						.map((item, index) =>
							shouldRenderConversationItem(item)
								? {
										item,
										turnId: turn.id,
										turnStatus: turn.status,
										showStatusNote: index === statusNoteIndex
									}
								: null
						)
						.filter((entry): entry is RenderedConversationEntry => entry !== null);
				})
			: []
	);
	const selectedActiveTurnId = $derived.by(() =>
		selectedThreadId ? (activeTurnIdsByThread[selectedThreadId] ?? null) : null
	);
	const selectedActiveTurnStartedAt = $derived.by(() =>
		selectedThreadId ? (activeTurnStartedAtByThread[selectedThreadId] ?? null) : null
	);
	const selectedThreadInterrupting = $derived.by(() =>
		Boolean(selectedThreadId && interruptingTurnsByThread[selectedThreadId])
	);
	const selectedEditorHref = $derived.by(() =>
		editorEnabled && selectedThreadId
			? `/api/threads/${encodeURIComponent(selectedThreadId)}/editor`
			: null
	);
	const selectedComposerDraftKey = $derived.by(() =>
		selectedThreadId
			? `thread:${selectedThreadId}`
			: selectedProjectPath
				? `project:${selectedProjectPath}`
				: null
	);
	const activeTurnElapsedSeconds = $derived.by(() =>
		selectedActiveTurnStartedAt === null
			? 0
			: elapsedSecondsFrom(selectedActiveTurnStartedAt, streamTickMs)
	);
	const canInterruptActiveTurn = $derived(
		selectedThreadId !== null &&
			selectedActiveTurnId !== null &&
			selectedActiveTurnId !== 'pending' &&
			!selectedThreadInterrupting
	);

	$effect(() => {
		const draftKey = selectedComposerDraftKey;
		if (draftKey === syncedComposerDraftKey) {
			return;
		}

		if (syncedComposerDraftKey) {
			promptDraftsByKey = upsertPromptDraft(
				promptDraftsByKey,
				syncedComposerDraftKey,
				readComposerDraft()
			);
		}

		syncedComposerDraftKey = draftKey;
		applyComposerDraft(
			draftKey ? (promptDraftsByKey[draftKey] ?? emptyPromptDraft()) : emptyPromptDraft()
		);
	});

	$effect(() => {
		if (!selectedComposerDraftKey || selectedComposerDraftKey !== syncedComposerDraftKey) {
			return;
		}

		promptDraftsByKey = upsertPromptDraft(
			promptDraftsByKey,
			selectedComposerDraftKey,
			readComposerDraft()
		);
	});

	$effect(() => {
		if (!selectedModel && models[0]) {
			selectedModel = resolveInitialModel(models);
		}
	});

	$effect(() => {
		const model = selectedModelSummary;
		if (!model) {
			return;
		}

		if (!selectedEffort || !availableEfforts.includes(selectedEffort)) {
			selectedEffort = model.defaultReasoningEffort;
		}
	});

	$effect(() => {
		if (!selectedProjectPath) {
			selectedThreadId = null;
			return;
		}

		if (selectedThreadId && projectThreads.some((thread) => thread.id === selectedThreadId)) {
			return;
		}

		selectedThreadId = projectThreads[0]?.id ?? null;
	});

	$effect(() => {
		if (selectedThreadId === syncedPermissionThreadId) {
			return;
		}

		syncedPermissionThreadId = selectedThreadId;
		selectedPermissionPreset = permissionPresetForThread(selectedThreadId);
	});

	$effect(() => {
		if (!selectedThreadId) {
			if (draftPermissionPreset !== selectedPermissionPreset) {
				draftPermissionPreset = selectedPermissionPreset;
			}
			return;
		}

		if (selectedPermissionPreset === 'full') {
			if (!(selectedThreadId in threadPermissionPresets)) {
				return;
			}

			const next = { ...threadPermissionPresets };
			delete next[selectedThreadId];
			threadPermissionPresets = next;
			return;
		}

		if (threadPermissionPresets[selectedThreadId] === selectedPermissionPreset) {
			return;
		}

		threadPermissionPresets = {
			...threadPermissionPresets,
			[selectedThreadId]: selectedPermissionPreset
		};
	});

	onMount(() => {
		restorePromptPreferences();
		restorePinnedProjects();
		restoreThreadPermissionPresets();
		restoreDesktopSidebarPreference();
		syncNotificationPermission();
		void ensureBrowserNotificationPermission();
		void refreshStatusSnapshot();
		syncedPermissionThreadId = undefined;
		selectedPermissionPreset = permissionPresetForThread(selectedThreadId);
		hasMounted = true;
		const mediaQuery = window.matchMedia('(min-width: 821px)');
		const syncViewport = (matches: boolean) => {
			isDesktopViewport = matches;
			sidebarOpen = matches ? (desktopSidebarPreference ?? true) : false;
		};

		syncViewport(mediaQuery.matches);
		const handleViewportChange = (event: MediaQueryListEvent) => {
			syncViewport(event.matches);
		};
		const handleNotificationPermissionGesture = () => {
			if (notificationPermission !== 'default') {
				removeNotificationPermissionGestureListeners();
				return;
			}

			void ensureBrowserNotificationPermission().finally(() => {
				if (notificationPermission !== 'default') {
					removeNotificationPermissionGestureListeners();
				}
			});
		};
		const handleVisibilityChange = () => {
			syncNotificationPermission();
		};
		const removeNotificationPermissionGestureListeners = () => {
			window.removeEventListener('pointerdown', handleNotificationPermissionGesture, true);
			window.removeEventListener('keydown', handleNotificationPermissionGesture, true);
		};

		mediaQuery.addEventListener('change', handleViewportChange);
		window.addEventListener('pointerdown', handleNotificationPermissionGesture, true);
		window.addEventListener('keydown', handleNotificationPermissionGesture, true);
		window.addEventListener('focus', syncNotificationPermission);
		document.addEventListener('visibilitychange', handleVisibilityChange);
		const statusInterval = window.setInterval(() => {
			void refreshStatusSnapshot();
		}, 30_000);

		if (selectedThreadId) {
			void ensureThreadReady(selectedThreadId);
		} else if (selectedProjectPath) {
			void loadProjectThreads(selectedProjectPath);
		}

		if (models.length === 0) {
			void refreshModels();
		}

		void maybeRunThreadNameBackfill();

		return () => {
			mediaQuery.removeEventListener('change', handleViewportChange);
			removeNotificationPermissionGestureListeners();
			window.removeEventListener('focus', syncNotificationPermission);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			window.clearInterval(statusInterval);
			releaseAttachmentPreviews(composerAttachments);
			for (const draft of Object.values(promptDraftsByKey)) {
				releaseAttachmentPreviews(draft.attachments);
			}
			for (const attachments of Object.values(pendingAttachmentReleases)) {
				releaseAttachmentPreviews(attachments);
			}
			closeThreadEvents();
		};
	});

	$effect(() => {
		void renderedConversationEntries;
		void activeQuestionRequests;
		if (suppressNextAutoScroll) {
			suppressNextAutoScroll = false;
			void tick().then(() => {
				syncConversationScrollState();
			});
			return;
		}
		if (untrack(() => showScrollToBottom)) {
			void tick().then(() => {
				syncConversationScrollState();
			});
			return;
		}
		void scrollConversationToBottom();
	});

	$effect(() => {
		void selectedThreadId;
		showScrollToBottom = false;
	});

	$effect(() => {
		if (!selectedActiveTurnId || selectedActiveTurnStartedAt === null) {
			return;
		}

		streamTickMs = Date.now();
		const interval = window.setInterval(() => {
			streamTickMs = Date.now();
		}, 1_000);

		return () => {
			window.clearInterval(interval);
		};
	});

	$effect(() => {
		if (!selectedThreadId || !selectedActiveTurnId || selectedActiveTurnStartedAt === null) {
			return;
		}

		const threadId = selectedThreadId;
		void refreshThreadUsage(threadId);
		const interval = window.setInterval(() => {
			void refreshThreadUsage(threadId);
		}, 5_000);

		return () => {
			window.clearInterval(interval);
		};
	});

	$effect(() => {
		if (!hasMounted) {
			return;
		}

		syncUrlState();
	});

	$effect(() => {
		if (!hasMounted) {
			return;
		}

		persistPromptPreferences();
	});

	$effect(() => {
		if (!hasMounted) {
			return;
		}

		persistPinnedProjects();
	});

	$effect(() => {
		if (!hasMounted) {
			return;
		}

		persistThreadPermissionPresets();
	});

	$effect(() => {
		if (selectedThreadId || !hasMounted || Object.keys(activeTurnIdsByThread).length > 0) {
			return;
		}

		closeThreadEvents();
	});

	$effect(() => {
		if (!selectedProjectPath || projectThreadsByPath[selectedProjectPath] === threads) {
			return;
		}

		projectThreadsByPath = {
			...projectThreadsByPath,
			[selectedProjectPath]: threads
		};
	});

	$effect(() => {
		if (!currentThread) {
			return;
		}

		void maybeGenerateThreadName(currentThread.id);
	});

	async function api<T>(path: string, init?: RequestInit): Promise<T> {
		const response = await fetch(path, init);
		const payload = await response.json().catch(() => null);

		if (!response.ok) {
			const message =
				payload && typeof payload === 'object' && 'error' in payload
					? readErrorMessage((payload as { error?: { message?: string } }).error?.message)
					: `Request failed with ${response.status}`;
			throw new Error(message);
		}

		return payload as T;
	}

	async function refreshWorkspace(): Promise<void> {
		refreshingWorkspace = true;
		try {
			const [nextStatus, nextProjectsResult, nextModelsResult] = await Promise.all([
				api<GatewayStatus>('/api/status'),
				api<{ data: ProjectSummary[] }>('/api/projects'),
				api<{ data: ModelSummary[]; nextCursor: string | null }>('/api/models')
			]);

			status = nextStatus;
			models = sortModels(nextModelsResult.data);
			const nextProjects = sortProjects(nextProjectsResult.data);
			projects = nextProjects;

			if (nextProjects.length === 0) {
				selectedProjectPath = null;
				selectedThreadId = null;
				threads = [];
				projectThreadsByPath = {};
				expandedProjectPaths = {};
				loadingProjectThreadsByPath = {};
				banner = null;
				return;
			}

			if (!selectedProjectPath) {
				selectedThreadId = null;
				threads = [];
				banner = null;
				return;
			}

			const nextProjectPath = nextProjects.some((project) => project.path === selectedProjectPath)
				? selectedProjectPath
				: (nextProjects[0]?.path ?? null);

			if (!(nextProjectPath in expandedProjectPaths)) {
				expandedProjectPaths = {
					...expandedProjectPaths,
					[nextProjectPath]: true
				};
			}

			await loadProjectThreads(
				nextProjectPath,
				nextProjectPath === selectedProjectPath ? selectedThreadId : null
			);
			banner = null;
		} catch (error) {
			banner = error instanceof Error ? error.message : 'Failed to refresh workspace.';
		} finally {
			refreshingWorkspace = false;
		}
	}

	async function refreshStatusSnapshot(): Promise<void> {
		try {
			status = await api<GatewayStatus>('/api/status');
		} catch {
			// preserve the last known account snapshot if the gateway briefly blips
		}
	}

	function markThreadActiveTurn(threadId: string, turnId: string, startedAt = Date.now()): void {
		activeTurnIdsByThread = {
			...activeTurnIdsByThread,
			[threadId]: turnId
		};
		if (!(threadId in activeTurnStartedAtByThread)) {
			activeTurnStartedAtByThread = {
				...activeTurnStartedAtByThread,
				[threadId]: startedAt
			};
		}
	}

	function clearThreadActiveTurn(threadId: string): void {
		if (threadId in activeTurnIdsByThread) {
			const next = { ...activeTurnIdsByThread };
			delete next[threadId];
			activeTurnIdsByThread = next;
		}

		if (threadId in activeTurnStartedAtByThread) {
			const next = { ...activeTurnStartedAtByThread };
			delete next[threadId];
			activeTurnStartedAtByThread = next;
		}

		clearThreadInterrupting(threadId);
	}

	function setThreadInterrupting(threadId: string): void {
		interruptingTurnsByThread = {
			...interruptingTurnsByThread,
			[threadId]: true
		};
	}

	function clearThreadInterrupting(threadId: string): void {
		if (!(threadId in interruptingTurnsByThread)) {
			return;
		}

		const next = { ...interruptingTurnsByThread };
		delete next[threadId];
		interruptingTurnsByThread = next;
	}

	function setThreadArchiving(threadId: string): void {
		archivingThreadIds = {
			...archivingThreadIds,
			[threadId]: true
		};
	}

	function clearThreadArchiving(threadId: string): void {
		if (!(threadId in archivingThreadIds)) {
			return;
		}

		const next = { ...archivingThreadIds };
		delete next[threadId];
		archivingThreadIds = next;
	}

	function removeRecordEntry<T>(record: Record<string, T>, key: string): Record<string, T> {
		if (!(key in record)) {
			return record;
		}

		const next = { ...record };
		delete next[key];
		return next;
	}

	function removeThreadFromVisibleProject(projectPath: string, threadId: string): CodexThread[] {
		const sourceThreads =
			projectPath === selectedProjectPath ? threads : (projectThreadsByPath[projectPath] ?? []);
		const nextVisibleThreads = sortThreads(
			sourceThreads.filter((thread) => thread.id !== threadId)
		);

		if (projectPath === selectedProjectPath) {
			threads = nextVisibleThreads;
		}

		const nextProjectThreadsByPath = { ...projectThreadsByPath };
		if (nextVisibleThreads.length > 0) {
			nextProjectThreadsByPath[projectPath] = nextVisibleThreads;
		} else {
			delete nextProjectThreadsByPath[projectPath];
		}
		projectThreadsByPath = nextProjectThreadsByPath;

		const nextProjects = syncProjectSummary(projects, projectPath, nextVisibleThreads);
		const projectStillVisible = nextProjects.some((project) => project.path === projectPath);
		projects = nextProjects;

		if (!projectStillVisible) {
			expandedProjectPaths = removeRecordEntry(expandedProjectPaths, projectPath);
			loadingProjectThreadsByPath = removeRecordEntry(loadingProjectThreadsByPath, projectPath);
		}

		return nextVisibleThreads;
	}

	function clearArchivedThreadLocalState(threadId: string): void {
		closeThreadEvents(threadId);
		threadDetails = removeRecordEntry(threadDetails, threadId);
		threadUsageByThread = removeRecordEntry(threadUsageByThread, threadId);
		threadTruncatedTurnCountByThread = removeRecordEntry(
			threadTruncatedTurnCountByThread,
			threadId
		);
		pendingRequestsByThread = removeRecordEntry(pendingRequestsByThread, threadId);
		activeTurnIdsByThread = removeRecordEntry(activeTurnIdsByThread, threadId);
		activeTurnStartedAtByThread = removeRecordEntry(activeTurnStartedAtByThread, threadId);
		interruptingTurnsByThread = removeRecordEntry(interruptingTurnsByThread, threadId);
		namingThreadIds = removeRecordEntry(namingThreadIds, threadId);
		fullHistoryThreadIds = removeRecordEntry(fullHistoryThreadIds, threadId);
		loadingFullHistoryThreadIds = removeRecordEntry(loadingFullHistoryThreadIds, threadId);
		threadPermissionPresets = removeRecordEntry(threadPermissionPresets, threadId);
		pendingAttachmentReleases = removeRecordEntry(pendingAttachmentReleases, threadId);
	}

	function threadHasActiveTurn(threadId: string): boolean {
		return threadId in activeTurnIdsByThread;
	}

	function pruneInactiveThreadEventSubscriptions(): void {
		for (const threadId of threadEventSources.keys()) {
			if (threadId !== selectedThreadId && !threadHasActiveTurn(threadId)) {
				closeThreadEvents(threadId);
			}
		}
	}

	async function ensureThreadReady(threadId: string): Promise<void> {
		selectedThreadId = threadId;
		pruneInactiveThreadEventSubscriptions();
		try {
			const fetchTasks: Promise<void>[] = [];
			if (!(threadId in threadDetails)) {
				fetchTasks.push(fetchThread(threadId));
			}
			if (!(threadId in pendingRequestsByThread)) {
				fetchTasks.push(fetchPendingRequests(threadId));
			}
			void ensureThreadLive(threadId);
			if (fetchTasks.length > 0) {
				await Promise.all(fetchTasks);
			}
			void refreshThreadUsage(threadId);
			banner = null;
		} catch (error) {
			banner = error instanceof Error ? error.message : 'Failed to open chat.';
		}
	}

	async function ensureThreadLive(threadId: string): Promise<void> {
		try {
			await ensureThreadEvents(threadId);
			await api(`/api/threads/${encodeURIComponent(threadId)}/resume`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({})
			});
		} catch {
			// Keep the thread readable even if the live event connection is not ready yet.
		}
	}

	async function fetchThread(threadId: string, options: FetchThreadOptions = {}): Promise<void> {
		const result = await api<ThreadReadResponse>(buildThreadReadPath(threadId, options));
		threadDetails = {
			...threadDetails,
			[threadId]: result.thread
		};
		setThreadTruncatedTurnCount(threadId, result.truncatedTurnCount);
		if (options.fullHistory) {
			setThreadHistoryExpanded(threadId, true);
		}
		applyThreadSummaryUpdate(threadId, () => compactThreadSummary(result.thread));
		if (options.includeUsage) {
			threadUsageByThread = {
				...threadUsageByThread,
				[threadId]: result.usage.turns
			};
		}
	}

	async function fetchProjectThreads(projectPath: string): Promise<CodexThread[]> {
		const result = await api<{ data: CodexThread[] }>(
			`/api/threads?projectPath=${encodeURIComponent(projectPath)}`
		);
		return sortThreads(result.data);
	}

	async function refreshThreadUsage(threadId: string): Promise<void> {
		try {
			const result = await api<ThreadUsageResponse>(
				`/api/threads/${encodeURIComponent(threadId)}/usage`
			);
			threadUsageByThread = {
				...threadUsageByThread,
				[threadId]: result.turns
			};
		} catch {
			// keep the stream usable if usage parsing fails
		}
	}

	async function loadProjectThreads(
		projectPath: string,
		preferredThreadId: string | null = null
	): Promise<CodexThread[]> {
		const nextThreads = await fetchProjectThreads(projectPath);
		threads = nextThreads;
		projectThreadsByPath = {
			...projectThreadsByPath,
			[projectPath]: nextThreads
		};
		selectedProjectPath = projectPath;
		selectedThreadId =
			preferredThreadId && nextThreads.some((thread) => thread.id === preferredThreadId)
				? preferredThreadId
				: (nextThreads[0]?.id ?? null);
		projects = syncProjectSummary(projects, projectPath, nextThreads);
		return nextThreads;
	}

	async function refreshModels(): Promise<void> {
		try {
			const result = await api<{ data: ModelSummary[]; nextCursor: string | null }>('/api/models');
			models = sortModels(result.data);
		} catch (error) {
			banner = error instanceof Error ? error.message : 'Failed to load models.';
		}
	}

	async function fetchPendingRequests(threadId: string): Promise<void> {
		const result = await api<PendingServerRequestListResponse>(
			`/api/threads/${encodeURIComponent(threadId)}/requests`
		);
		pendingRequestsByThread = {
			...pendingRequestsByThread,
			[threadId]: sortPendingRequests(result.data)
		};
	}

	async function selectProject(projectPath: string): Promise<void> {
		if (projectPath === selectedProjectPath && projectThreads.length > 0) {
			if (!selectedThreadId && projectThreads[0]) {
				await ensureThreadReady(projectThreads[0].id);
			}
			return;
		}

		if (!(projectPath in expandedProjectPaths)) {
			expandedProjectPaths = {
				...expandedProjectPaths,
				[projectPath]: true
			};
		}

		selectedProjectPath = projectPath;
		selectedThreadId = null;
		threads = [];

		try {
			const nextThreads = await loadProjectThreads(projectPath);
			if (nextThreads[0]) {
				await ensureThreadReady(nextThreads[0].id);
			} else {
				banner = null;
			}
		} catch (error) {
			banner = error instanceof Error ? error.message : 'Failed to open project.';
		}
	}

	async function handleProjectSelect(projectPath: string): Promise<void> {
		collapseSidebarOnMobile();
		await selectProject(projectPath);
	}

	function toggleProjectPinned(event: MouseEvent, projectPath: string): void {
		event.preventDefault();
		event.stopPropagation();

		if (projectIsPinned(projectPath)) {
			pinnedProjectPaths = removeRecordEntry(pinnedProjectPaths, projectPath);
		} else {
			pinnedProjectPaths = {
				...pinnedProjectPaths,
				[projectPath]: true
			};
		}

		projects = sortProjects(projects);
	}

	async function toggleProjectExpanded(projectPath: string): Promise<void> {
		if (expandedProjectPaths[projectPath]) {
			const nextExpandedProjects = { ...expandedProjectPaths };
			delete nextExpandedProjects[projectPath];
			expandedProjectPaths = nextExpandedProjects;
			return;
		}

		expandedProjectPaths = {
			...expandedProjectPaths,
			[projectPath]: true
		};

		if (projectPath === selectedProjectPath || projectPath in projectThreadsByPath) {
			return;
		}

		loadingProjectThreadsByPath = {
			...loadingProjectThreadsByPath,
			[projectPath]: true
		};

		try {
			projectThreadsByPath = {
				...projectThreadsByPath,
				[projectPath]: await fetchProjectThreads(projectPath)
			};
			banner = null;
		} catch (error) {
			const nextExpandedProjects = { ...expandedProjectPaths };
			delete nextExpandedProjects[projectPath];
			expandedProjectPaths = nextExpandedProjects;
			banner = error instanceof Error ? error.message : 'Failed to expand project.';
		} finally {
			if (projectPath in loadingProjectThreadsByPath) {
				const nextLoadingProjects = { ...loadingProjectThreadsByPath };
				delete nextLoadingProjects[projectPath];
				loadingProjectThreadsByPath = nextLoadingProjects;
			}
		}
	}

	async function handleSidebarThreadSelect(projectPath: string, threadId: string): Promise<void> {
		collapseSidebarOnMobile();
		if (projectPath !== selectedProjectPath) {
			if (!(projectPath in expandedProjectPaths)) {
				expandedProjectPaths = {
					...expandedProjectPaths,
					[projectPath]: true
				};
			}
			await loadProjectThreads(projectPath, threadId);
		}
		await ensureThreadReady(threadId);
	}

	async function handleArchiveThread(
		event: MouseEvent,
		projectPath: string,
		thread: CodexThread
	): Promise<void> {
		event.preventDefault();
		event.stopPropagation();

		if (threadIsRunning(thread) || archivingThreadIds[thread.id]) {
			return;
		}

		const wasSelectedProject = projectPath === selectedProjectPath;
		const wasSelectedThread = thread.id === selectedThreadId;
		setThreadArchiving(thread.id);

		try {
			await api(`/api/threads/${encodeURIComponent(thread.id)}/archive`, {
				method: 'POST'
			});

			const nextVisibleThreads = removeThreadFromVisibleProject(projectPath, thread.id);
			clearArchivedThreadLocalState(thread.id);
			banner = null;

			if (!wasSelectedProject || !wasSelectedThread) {
				return;
			}

			if (nextVisibleThreads[0]) {
				await ensureThreadReady(nextVisibleThreads[0].id);
				return;
			}

			const fallbackProjectPath = projects[0]?.path ?? null;
			if (!fallbackProjectPath) {
				selectedProjectPath = null;
				selectedThreadId = null;
				threads = [];
				return;
			}

			await selectProject(fallbackProjectPath);
		} catch (error) {
			banner = error instanceof Error ? error.message : 'Failed to archive chat.';
		} finally {
			clearThreadArchiving(thread.id);
		}
	}

	async function createThread(
		projectPath = selectedProjectPath,
		firstPrompt?: PromptSubmitPayload
	): Promise<string | null> {
		if (!projectPath) {
			return null;
		}

		creatingThread = true;
		try {
			const result = await api<ThreadStartResponse>('/api/threads', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					cwd: projectPath,
					model: selectedModelSummary?.model ?? undefined,
					approvalPolicy: permissionPresetConfig.approvalPolicy,
					sandbox: permissionPresetConfig.sandbox
				})
			});

			threads = sortThreads([
				compactThreadSummary(result.thread),
				...threads.filter((thread) => thread.id !== result.thread.id)
			]);
			threadDetails = {
				...threadDetails,
				[result.thread.id]: result.thread
			};
			if (selectedPermissionPreset !== 'full') {
				threadPermissionPresets = {
					...threadPermissionPresets,
					[result.thread.id]: selectedPermissionPreset
				};
			}
			selectedProjectPath = projectPath;
			selectedThreadId = result.thread.id;
			if (!(projectPath in expandedProjectPaths)) {
				expandedProjectPaths = {
					...expandedProjectPaths,
					[projectPath]: true
				};
			}
			projects = insertProjectSummary(projects, projectPath, result.thread);
			pendingRequestsByThread = {
				...pendingRequestsByThread,
				[result.thread.id]: []
			};
			await ensureThreadEvents(result.thread.id);
			banner = null;

			if (firstPrompt && promptHasContent(firstPrompt)) {
				await sendTurn(result.thread.id, firstPrompt);
			}

			return result.thread.id;
		} catch (error) {
			if (firstPrompt && promptHasContent(firstPrompt)) {
				composer = firstPrompt.message;
				composerAttachments = firstPrompt.attachments;
				composerMentions = firstPrompt.mentions;
			}
			banner = error instanceof Error ? error.message : 'Failed to create chat.';
			return null;
		} finally {
			creatingThread = false;
		}
	}

	async function handleCreateThread(projectPath = selectedProjectPath): Promise<void> {
		collapseSidebarOnMobile();
		await createThread(projectPath);
	}

	async function sendMessage(
		submitPayload: PromptSubmitPayload = {
			message: composer,
			attachments: composerAttachments,
			mentions: composerMentions
		}
	): Promise<void> {
		const prompt = normalizePromptSubmit(submitPayload);
		if (!promptHasContent(prompt) || !selectedProjectPath) {
			return;
		}
		void ensureBrowserNotificationPermission();

		composer = '';
		composerAttachments = [];
		composerMentions = [];

		if (!selectedThreadId) {
			await createThread(selectedProjectPath, prompt);
			return;
		}

		await sendTurn(selectedThreadId, prompt);
	}

	async function sendTurn(threadId: string, prompt: PromptSubmitPayload): Promise<void> {
		markThreadActiveTurn(threadId, 'pending');
		clearThreadInterrupting(threadId);
		const optimisticState = applyOptimisticUserTurn(threadId, prompt);
		queuePendingAttachmentPreviews(threadId, prompt.attachments);

		try {
			await ensureThreadEvents(threadId);
			if (prompt.attachments.length > 0) {
				const formData = new FormData();
				formData.set('message', prompt.message);
				formData.set(
					'mentions',
					JSON.stringify(
						prompt.mentions.map((mention) => ({
							name: mention.name,
							path: mention.absolutePath
						}))
					)
				);
				if (selectedModelSummary?.model) {
					formData.set('model', selectedModelSummary.model);
				}
				if (selectedEffort) {
					formData.set('effort', selectedEffort);
				}
				formData.set('mode', selectedMode);
				formData.set('approvalPolicy', permissionPresetConfig.approvalPolicy);
				formData.set('sandbox', permissionPresetConfig.sandbox);
				for (const attachment of prompt.attachments) {
					formData.append('attachments', attachment.file, attachment.file.name);
				}

				await api(`/api/threads/${encodeURIComponent(threadId)}/turns`, {
					method: 'POST',
					body: formData
				});
			} else {
				await api(`/api/threads/${encodeURIComponent(threadId)}/turns`, {
					method: 'POST',
					headers: {
						'content-type': 'application/json'
					},
					body: JSON.stringify({
						message: prompt.message,
						mentions: prompt.mentions.map((mention) => ({
							name: mention.name,
							path: mention.absolutePath
						})),
						model: selectedModelSummary?.model ?? undefined,
						effort: selectedEffort,
						mode: selectedMode,
						approvalPolicy: permissionPresetConfig.approvalPolicy,
						sandbox: permissionPresetConfig.sandbox
					})
				});
			}

			await refreshThreads();
		} catch (error) {
			unqueuePendingAttachmentPreviews(threadId, prompt.attachments);
			restoreOptimisticUserTurn(threadId, optimisticState);
			composer = prompt.message;
			composerAttachments = prompt.attachments;
			composerMentions = prompt.mentions;
			clearThreadActiveTurn(threadId);
			banner = error instanceof Error ? error.message : 'Failed to send message.';
		}
	}

	async function interruptActiveTurn(): Promise<void> {
		if (
			!selectedThreadId ||
			!selectedActiveTurnId ||
			selectedActiveTurnId === 'pending' ||
			selectedThreadInterrupting
		) {
			return;
		}

		setThreadInterrupting(selectedThreadId);
		const turnId = selectedActiveTurnId;
		const elapsedSeconds = selectedActiveTurnStartedAt === null ? null : activeTurnElapsedSeconds;

		try {
			await api(`/api/threads/${encodeURIComponent(selectedThreadId)}/interrupt`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({ turnId })
			});

			if (elapsedSeconds !== null) {
				turnElapsedSeconds = {
					...turnElapsedSeconds,
					[turnId]: elapsedSeconds
				};
			}

			markTurnInterrupted(selectedThreadId, turnId);
			banner = null;
		} catch (error) {
			clearThreadInterrupting(selectedThreadId);
			banner = error instanceof Error ? error.message : 'Failed to interrupt turn.';
		}
	}

	async function refreshThreads(): Promise<void> {
		if (!selectedProjectPath) {
			threads = [];
			selectedThreadId = null;
			return;
		}

		try {
			await loadProjectThreads(selectedProjectPath, selectedThreadId);
		} catch (error) {
			banner = error instanceof Error ? error.message : 'Failed to refresh chats.';
		}
	}

	async function resolvePendingRequest(
		threadId: string,
		requestId: number,
		payload: unknown
	): Promise<void> {
		const previous = pendingRequestsByThread[threadId] ?? [];
		resolvingRequestId = requestId;

		try {
			await api(`/api/threads/${encodeURIComponent(threadId)}/requests/${requestId}/resolve`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify(payload)
			});
			banner = null;
		} catch (error) {
			pendingRequestsByThread = {
				...pendingRequestsByThread,
				[threadId]: previous
			};
			banner = error instanceof Error ? error.message : 'Failed to resolve request.';
		} finally {
			resolvingRequestId = null;
		}
	}

	function handleNotification(notification: RpcNotification): void {
		const threadId = readThreadId(notification);
		if (!threadId) {
			return;
		}
		const isSelectedThread = threadId === selectedThreadId;
		const shouldRenderStreamingState = isSelectedThread || threadId in threadDetails;

		if (notification.method === 'serverRequest/pending') {
			const pendingRequest = readPendingServerRequest(notification.params);
			if (pendingRequest) {
				upsertPendingRequest(threadId, pendingRequest);
				maybeNotifyPendingRequest(threadId, pendingRequest);
			}
			return;
		}

		if (notification.method === 'serverRequest/resolved') {
			const requestId = readRequestIdValue(notification.params?.requestId);
			if (requestId !== null) {
				removePendingRequest(threadId, requestId);
			}
			return;
		}

		if (notification.method === 'turn/started') {
			const turnId = readTurnId(notification.params) ?? 'pending';
			markThreadActiveTurn(threadId, turnId, activeTurnStartedAtByThread[threadId] ?? Date.now());
			applyThreadSummaryUpdate(threadId, (thread) => ({
				...thread,
				status: 'in_progress'
			}));
			if (turnId !== 'pending') {
				updateTurnStatus(threadId, turnId, readTurnStatus(notification.params) ?? 'inProgress');
			}
			return;
		}

		if (notification.method === 'item/started' || notification.method === 'item/completed') {
			if (!shouldRenderStreamingState) {
				return;
			}

			const item = readTurnItem(notification.params);
			if (!item) {
				return;
			}

			upsertStreamingTurnItem(threadId, readTurnId(notification.params), item);
			return;
		}

		if (notification.method === 'item/agentMessage/delta') {
			if (!shouldRenderStreamingState) {
				return;
			}

			appendStreamingAgentDelta(
				threadId,
				readTurnId(notification.params),
				readString(notification.params?.itemId),
				readString(notification.params?.delta) ?? ''
			);
			return;
		}

		if (notification.method === 'turn/completed') {
			const turnId = readTurnId(notification.params);
			const turnStatus = readTurnStatus(notification.params) ?? 'completed';
			if (turnId) {
				updateTurnStatus(threadId, turnId, turnStatus);
				applyThreadSummaryUpdate(threadId, (thread) => ({
					...thread,
					status: turnStatus
				}));
				const startedAt = activeTurnStartedAtByThread[threadId] ?? null;
				if (turnStatus === 'interrupted' && startedAt !== null) {
					turnElapsedSeconds = {
						...turnElapsedSeconds,
						[turnId]: elapsedSecondsFrom(startedAt)
					};
				}
				maybeNotifyTurnEvent(threadId, turnId, turnStatus);
			}
			void finalizeTurn(threadId);
			return;
		}
	}

	async function finalizeTurn(threadId: string): Promise<void> {
		const finalTurnId = activeTurnIdsByThread[threadId] ?? null;
		const finalStartedAt = activeTurnStartedAtByThread[threadId] ?? null;
		clearThreadActiveTurn(threadId);

		try {
			const tasks: Promise<void>[] = [refreshThreads()];
			if (threadId === selectedThreadId || threadId in threadDetails) {
				tasks.push(fetchThread(threadId));
			}
			await Promise.all(tasks);
			void refreshThreadUsage(threadId);
		} catch (error) {
			if (threadId === selectedThreadId) {
				banner = error instanceof Error ? error.message : 'Failed to finalize chat.';
			}
		} finally {
			if (
				finalTurnId &&
				finalTurnId !== 'pending' &&
				finalStartedAt !== null &&
				!(finalTurnId in turnElapsedSeconds)
			) {
				turnElapsedSeconds = {
					...turnElapsedSeconds,
					[finalTurnId]: elapsedSecondsFrom(finalStartedAt)
				};
			}
			releasePendingAttachmentPreviews(threadId);
			pruneInactiveThreadEventSubscriptions();
			void maybeGenerateThreadName(threadId);
		}
	}

	function chatLabel(thread: CodexThread): string {
		return thread.name || trimLine(thread.preview) || threadFallbackPreview(thread) || 'new chat';
	}

	function threadIsRunning(thread: CodexThread): boolean {
		if (threadHasActiveTurn(thread.id)) {
			return true;
		}

		const detailedThread = threadDetails[thread.id] ?? null;
		const latestTurn = detailedThread?.turns.at(-1) ?? thread.turns.at(-1) ?? null;
		if (latestTurn && isInProgressTurnStatus(latestTurn.status)) {
			return true;
		}
		if (detailedThread && latestTurn) {
			return false;
		}

		const normalizedStatus = normalizeTurnStatus(thread.status);
		return (
			normalizedStatus === 'inprogress' ||
			normalizedStatus === 'running' ||
			normalizedStatus === 'active'
		);
	}

	function projectChatCount(projectPath: string): number {
		return projects.find((project) => project.path === projectPath)?.threadCount ?? 0;
	}

	function projectIsPinned(projectPath: string): boolean {
		return Boolean(pinnedProjectPaths[projectPath]);
	}

	function projectIsExpanded(projectPath: string): boolean {
		return Boolean(expandedProjectPaths[projectPath]);
	}

	function projectThreadsLoading(projectPath: string): boolean {
		return Boolean(loadingProjectThreadsByPath[projectPath]);
	}

	function sidebarThreadsForProject(projectPath: string): CodexThread[] {
		if (projectPath === selectedProjectPath) {
			return projectThreads;
		}

		return projectThreadsByPath[projectPath] ?? [];
	}

	function projectNameFromPath(path: string): string {
		const segments = path.split('/').filter(Boolean);
		return segments.at(-1) ?? path;
	}

	function trimLine(value: string | null | undefined): string {
		return value?.replace(/\s+/g, ' ').trim() ?? '';
	}

	function threadFallbackPreview(thread: CodexThread): string {
		for (let turnIndex = thread.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
			const turn = thread.turns[turnIndex];
			if (!turn) {
				continue;
			}

			for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
				const item = turn.items[itemIndex];
				if (!item || !isUserMessageItem(item)) {
					continue;
				}

				const text = trimLine(renderUserText(item));
				if (text) {
					return text;
				}

				const imageCount = renderUserImages(item).length;
				if (imageCount > 0) {
					return describeImageAttachments(imageCount);
				}
			}
		}

		return '';
	}

	function shortPath(value: string): string {
		const root = status?.projectsRoot ?? '';
		if (root && value.startsWith(root)) {
			const relative = value.slice(root.length).replace(/^\/+/, '');
			return relative ? `~/${relative}` : '~';
		}

		return value;
	}

	function readErrorMessage(value: unknown): string {
		return typeof value === 'string' ? value : 'Unknown error';
	}

	function notificationSupported(): boolean {
		return typeof window !== 'undefined' && 'Notification' in window;
	}

	function syncNotificationPermission(): void {
		if (!notificationSupported()) {
			notificationPermission = 'unsupported';
			return;
		}

		notificationPermission = Notification.permission;
	}

	async function ensureBrowserNotificationPermission(): Promise<void> {
		if (!notificationSupported()) {
			return;
		}

		syncNotificationPermission();
		if (notificationPermission !== 'default') {
			return;
		}

		notificationPermission = await Notification.requestPermission();
		if (notificationPermission === 'denied') {
			banner = 'Browser notifications are blocked for this app.';
		}
	}

	function shouldSendBrowserNotification(): boolean {
		if (notificationPermission !== 'granted') {
			return false;
		}

		return document.visibilityState !== 'visible' || !document.hasFocus();
	}

	function notifyBrowser(title: string, body: string, tag: string): boolean {
		syncNotificationPermission();
		if (!shouldSendBrowserNotification()) {
			return false;
		}

		const notification = new Notification(title, {
			body,
			tag,
			silent: false
		});

		notification.onclick = () => {
			window.focus();
			notification.close();
		};

		return true;
	}

	function threadNotificationLabel(threadId: string): string {
		const thread =
			threadDetails[threadId] ?? threads.find((entry) => entry.id === threadId) ?? null;
		return thread ? chatLabel(thread) : 'current chat';
	}

	function maybeNotifyPendingRequest(threadId: string, request: PendingServerRequest): void {
		const requestKey = `${threadId}:${request.requestId}`;
		if (notifiedRequestIds[requestKey]) {
			return;
		}

		const threadLabel = threadNotificationLabel(threadId);
		let notified = false;
		if (request.method === 'item/tool/requestUserInput') {
			notified = notifyBrowser(
				'Follow-up needed',
				`${threadLabel} is waiting for your answer.`,
				requestKey
			);
		} else if (
			request.method === 'item/commandExecution/requestApproval' ||
			request.method === 'item/fileChange/requestApproval' ||
			request.method === 'item/permissions/requestApproval'
		) {
			notified = notifyBrowser(
				'Approval needed',
				`${threadLabel} is waiting for confirmation.`,
				requestKey
			);
		} else {
			notified = notifyBrowser(
				'Action needed',
				`${threadLabel} is waiting for your input.`,
				requestKey
			);
		}

		if (!notified) {
			return;
		}

		notifiedRequestIds = {
			...notifiedRequestIds,
			[requestKey]: true
		};
	}

	function maybeNotifyTurnEvent(threadId: string, turnId: string, turnStatus: string): void {
		const eventKey = `${threadId}:${turnId}:${turnStatus}`;
		if (notifiedTurnEvents[eventKey]) {
			return;
		}

		const threadLabel = threadNotificationLabel(threadId);
		let notified = false;
		if (turnStatus === 'completed') {
			notified = notifyBrowser(
				'Assistant finished',
				`${threadLabel} has a new reply ready.`,
				eventKey
			);
		} else if (turnStatus === 'interrupted') {
			notified = notifyBrowser(
				'Assistant interrupted',
				`${threadLabel} stopped before finishing.`,
				eventKey
			);
		} else if (turnStatus === 'failed' || turnStatus === 'error') {
			notified = notifyBrowser(
				'Assistant needs attention',
				`${threadLabel} ended with an error.`,
				eventKey
			);
		}

		if (!notified) {
			return;
		}

		notifiedTurnEvents = {
			...notifiedTurnEvents,
			[eventKey]: true
		};
	}

	function readString(value: unknown): string | null {
		return typeof value === 'string' ? value : null;
	}

	function readThreadId(notification: RpcNotification): string | null {
		const threadId = readString(notification.params?.threadId);
		if (threadId) {
			return threadId;
		}

		const thread = notification.params?.thread;
		if (thread && typeof thread === 'object' && 'id' in thread) {
			return readString(thread.id);
		}

		return null;
	}

	function readTurnId(params?: Record<string, unknown>): string | null {
		const turn = params?.turn;
		if (!turn || typeof turn !== 'object' || !('id' in turn)) {
			return readString(params?.turnId);
		}

		return readString(turn.id);
	}

	function readRequestIdValue(value: unknown): number | null {
		return typeof value === 'number' ? value : null;
	}

	function readTurnStatus(params?: Record<string, unknown>): string | null {
		const turn = params?.turn;
		if (turn && typeof turn === 'object' && 'status' in turn) {
			return readStatusToken(turn.status);
		}

		return (
			readStatusToken(params?.turnStatus) ??
			readStatusToken(params?.status) ??
			readStatusToken(params?.state)
		);
	}

	function readTurnItem(params?: Record<string, unknown>): CodexThreadItem | null {
		const item = params?.item;
		if (!item || typeof item !== 'object') {
			return null;
		}

		if (!('type' in item) || !('id' in item)) {
			return null;
		}

		return item as CodexThreadItem;
	}

	function readStatusToken(status: unknown): string | null {
		if (typeof status === 'string' && status.trim()) {
			return status;
		}

		if (!status || typeof status !== 'object') {
			return null;
		}

		if ('type' in status && typeof status.type === 'string' && status.type.trim()) {
			return status.type;
		}

		if ('status' in status && typeof status.status === 'string' && status.status.trim()) {
			return status.status;
		}

		if ('state' in status && typeof status.state === 'string' && status.state.trim()) {
			return status.state;
		}

		return null;
	}

	function readPendingServerRequest(params?: Record<string, unknown>): PendingServerRequest | null {
		const requestId = readRequestIdValue(params?.requestId);
		const request = params?.request;
		if (!requestId || !request || typeof request !== 'object') {
			return null;
		}

		const requestRecord = request as Record<string, unknown>;
		const method = readString(requestRecord.method);
		const requestParams =
			requestRecord.params && typeof requestRecord.params === 'object'
				? (requestRecord.params as Record<string, unknown>)
				: null;

		if (!method || !requestParams) {
			return null;
		}

		return {
			requestId,
			method,
			threadId: readString(params?.threadId) ?? '',
			createdAt: Date.now(),
			params: requestParams
		} as PendingServerRequest;
	}

	function applyThreadNameLocally(threadId: string, name: string): void {
		applyThreadSummaryUpdate(threadId, (thread) => ({
			...thread,
			name
		}));

		const detailedThread = threadDetails[threadId];
		if (detailedThread) {
			threadDetails = {
				...threadDetails,
				[threadId]: {
					...detailedThread,
					name
				}
			};
		}
	}

	function shouldGenerateThreadName(thread: CodexThread | null): boolean {
		if (!thread || thread.name || namingThreadIds[thread.id]) {
			return false;
		}

		const firstTurn = findFirstCompletedNamingTurn(thread);
		if (!firstTurn || firstTurn.status !== 'completed') {
			return false;
		}

		const hasAssistantMessage = firstTurn.items.some(
			(item) =>
				item.type === 'agentMessage' &&
				typeof item.text === 'string' &&
				trimLine(item.text).length > 0
		);

		return hasUserMessage(firstTurn.items) && hasAssistantMessage;
	}

	function hasUserMessage(items: CodexThreadItem[]): boolean {
		return items.some((item) => item.type === 'userMessage');
	}

	function findFirstCompletedNamingTurn(thread: CodexThread): CodexTurn | null {
		for (const turn of thread.turns) {
			if (turn.status !== 'completed') {
				continue;
			}

			const hasAssistantMessage = turn.items.some(
				(item) =>
					item.type === 'agentMessage' &&
					typeof item.text === 'string' &&
					trimLine(item.text).length > 0
			);
			if (hasUserMessage(turn.items) && hasAssistantMessage) {
				return turn;
			}
		}

		return null;
	}

	async function maybeGenerateThreadName(threadId: string): Promise<void> {
		const thread = threadDetails[threadId] ?? null;
		if (!shouldGenerateThreadName(thread)) {
			return;
		}

		await requestThreadNameGeneration(threadId);
	}

	async function requestThreadNameGeneration(threadId: string): Promise<boolean> {
		if (namingThreadIds[threadId]) {
			return false;
		}

		namingThreadIds = {
			...namingThreadIds,
			[threadId]: true
		};

		try {
			const result = await api<ThreadNameGenerateResponse>(
				`/api/threads/${encodeURIComponent(threadId)}/generate-name`,
				{
					method: 'POST'
				}
			);
			if (result.name) {
				applyThreadNameLocally(threadId, result.name);
				return true;
			}
		} catch {
			// Keep the existing preview fallback when background naming fails.
		} finally {
			const next = { ...namingThreadIds };
			delete next[threadId];
			namingThreadIds = next;
		}

		return false;
	}

	function shouldBackfillThreadName(thread: CodexThread): boolean {
		return !trimLine(thread.name).length;
	}

	async function listAllThreadsForBackfill(): Promise<CodexThread[]> {
		const threads: CodexThread[] = [];
		let cursor: string | null = null;

		do {
			const suffix: string = cursor
				? `?limit=200&cursor=${encodeURIComponent(cursor)}`
				: '?limit=200';
			const page: ThreadListResponse = await api<ThreadListResponse>(`/api/threads${suffix}`);
			threads.push(...page.data);
			cursor = page.nextCursor;
		} while (cursor);

		return threads;
	}

	async function maybeRunThreadNameBackfill(): Promise<void> {
		try {
			if (window.localStorage.getItem(THREAD_NAME_BACKFILL_KEY) === 'done') {
				return;
			}

			const targets = (await listAllThreadsForBackfill())
				.filter(shouldBackfillThreadName)
				.map((thread) => thread.id);
			if (targets.length === 0) {
				window.localStorage.setItem(THREAD_NAME_BACKFILL_KEY, 'done');
				return;
			}

			let failed = false;
			const concurrency = 3;
			let cursor = 0;
			const worker = async () => {
				while (cursor < targets.length) {
					const threadId = targets[cursor];
					cursor += 1;
					const success = await requestThreadNameGeneration(threadId);
					if (!success) {
						failed = true;
					}
				}
			};

			await Promise.all(
				Array.from({ length: Math.min(concurrency, targets.length) }, () => worker())
			);
			if (!failed) {
				window.localStorage.setItem(THREAD_NAME_BACKFILL_KEY, 'done');
			}
		} catch {
			// retry on a later reload if the migration request fails
		}
	}

	function sortThreads(list: CodexThread[]): CodexThread[] {
		return [...list].sort((left, right) => right.updatedAt - left.updatedAt);
	}

	function sortProjects(list: ProjectSummary[]): ProjectSummary[] {
		return [...list].sort((left, right) => {
			const leftPinned = Boolean(pinnedProjectPaths[left.path]);
			const rightPinned = Boolean(pinnedProjectPaths[right.path]);
			if (leftPinned !== rightPinned) {
				return leftPinned ? -1 : 1;
			}

			const byName = left.name.localeCompare(right.name, undefined, {
				sensitivity: 'base'
			});
			if (byName !== 0) {
				return byName;
			}

			return left.path.localeCompare(right.path, undefined, {
				sensitivity: 'base'
			});
		});
	}

	function sortModels(list: ModelSummary[]): ModelSummary[] {
		return [...list].sort((left, right) => {
			if (left.isDefault !== right.isDefault) {
				return left.isDefault ? -1 : 1;
			}

			return formatModelDisplayName(left.model).localeCompare(formatModelDisplayName(right.model));
		});
	}

	function sortPendingRequests(list: PendingServerRequest[]): PendingServerRequest[] {
		return [...list].sort((left, right) => left.createdAt - right.createdAt);
	}

	function compactThreadSummary(thread: CodexThread): CodexThread {
		return {
			...thread,
			turns: []
		};
	}

	function applyThreadSummaryUpdate(
		threadId: string,
		updater: (thread: CodexThread) => CodexThread
	): void {
		let foundInVisibleThreads = false;
		const nextThreads = threads.map((thread) => {
			if (thread.id !== threadId) {
				return thread;
			}

			foundInVisibleThreads = true;
			return updater(thread);
		});
		if (foundInVisibleThreads) {
			threads = sortThreads(nextThreads);
		}

		let updatedCache = false;
		const nextProjectThreadsByPath: Record<string, CodexThread[]> = {};
		for (const [projectPath, projectThreadList] of Object.entries(projectThreadsByPath)) {
			let foundInProject = false;
			const nextProjectThreads = projectThreadList.map((thread) => {
				if (thread.id !== threadId) {
					return thread;
				}

				foundInProject = true;
				return updater(thread);
			});

			nextProjectThreadsByPath[projectPath] = foundInProject
				? sortThreads(nextProjectThreads)
				: projectThreadList;
			updatedCache ||= foundInProject;
		}
		if (updatedCache) {
			projectThreadsByPath = nextProjectThreadsByPath;
		}
	}

	function buildThreadReadPath(threadId: string, options: FetchThreadOptions = {}): string {
		const searchParams = new URLSearchParams({
			includeTurns: 'true',
			includeUsage: options.includeUsage ? 'true' : 'false'
		});
		const shouldLoadFullHistory = options.fullHistory ?? Boolean(fullHistoryThreadIds[threadId]);
		if (!shouldLoadFullHistory) {
			searchParams.set('tailTurns', `${INITIAL_THREAD_TAIL_TURNS}`);
		}
		return `/api/threads/${encodeURIComponent(threadId)}?${searchParams.toString()}`;
	}

	function setThreadTruncatedTurnCount(threadId: string, truncatedTurnCount: number): void {
		if (truncatedTurnCount > 0) {
			threadTruncatedTurnCountByThread = {
				...threadTruncatedTurnCountByThread,
				[threadId]: truncatedTurnCount
			};
			return;
		}

		if (!(threadId in threadTruncatedTurnCountByThread)) {
			return;
		}

		const next = { ...threadTruncatedTurnCountByThread };
		delete next[threadId];
		threadTruncatedTurnCountByThread = next;
	}

	function setThreadHistoryExpanded(threadId: string, expanded: boolean): void {
		if (expanded) {
			fullHistoryThreadIds = {
				...fullHistoryThreadIds,
				[threadId]: true
			};
			return;
		}

		if (!(threadId in fullHistoryThreadIds)) {
			return;
		}

		const next = { ...fullHistoryThreadIds };
		delete next[threadId];
		fullHistoryThreadIds = next;
	}

	async function loadFullThreadHistory(): Promise<void> {
		if (!selectedThreadId || currentThreadTruncatedTurnCount === 0) {
			return;
		}

		const threadId = selectedThreadId;
		loadingFullHistoryThreadIds = {
			...loadingFullHistoryThreadIds,
			[threadId]: true
		};
		suppressNextAutoScroll = true;
		try {
			await fetchThread(threadId, { fullHistory: true });
			void refreshThreadUsage(threadId);
			banner = null;
		} catch (error) {
			setThreadHistoryExpanded(threadId, false);
			banner = error instanceof Error ? error.message : 'Failed to load full chat history.';
		} finally {
			const next = { ...loadingFullHistoryThreadIds };
			delete next[threadId];
			loadingFullHistoryThreadIds = next;
		}
	}

	function resolveInitialModel(list: ModelSummary[]): string | null {
		return list.find((model) => model.isDefault)?.model ?? list[0]?.model ?? null;
	}

	function resolveInitialEffort(list: ModelSummary[]): ReasoningEffort | null {
		return (
			list.find((model) => model.isDefault)?.defaultReasoningEffort ??
			list[0]?.defaultReasoningEffort ??
			null
		);
	}

	function resolvePermissionPreset(preset: PermissionPreset): {
		approvalPolicy: 'on-request' | 'never';
		sandbox: 'workspace-write' | 'danger-full-access';
	} {
		switch (preset) {
			case 'auto':
				return { approvalPolicy: 'never', sandbox: 'workspace-write' };
			case 'full':
				return { approvalPolicy: 'never', sandbox: 'danger-full-access' };
			case 'ask':
			default:
				return { approvalPolicy: 'on-request', sandbox: 'workspace-write' };
		}
	}

	function permissionPresetForThread(threadId: string | null): PermissionPreset {
		if (!threadId) {
			return draftPermissionPreset;
		}

		return threadPermissionPresets[threadId] ?? 'full';
	}

	function isPermissionPreset(value: unknown): value is PermissionPreset {
		return value === 'ask' || value === 'auto' || value === 'full';
	}

	function upsertPendingRequest(threadId: string, request: PendingServerRequest): void {
		const current = pendingRequestsByThread[threadId] ?? [];
		const next = current.filter((entry) => entry.requestId !== request.requestId);
		pendingRequestsByThread = {
			...pendingRequestsByThread,
			[threadId]: sortPendingRequests([...next, request])
		};
	}

	function removePendingRequest(threadId: string, requestId: number): void {
		const current = pendingRequestsByThread[threadId] ?? [];
		pendingRequestsByThread = {
			...pendingRequestsByThread,
			[threadId]: current.filter((entry) => entry.requestId !== requestId)
		};
	}

	function restorePromptPreferences(): void {
		try {
			const raw = window.localStorage.getItem(PROMPT_PREFERENCES_KEY);
			if (!raw) {
				return;
			}

			const parsed = JSON.parse(raw) as {
				model?: string;
				effort?: ReasoningEffort;
				mode?: PromptMode;
			};

			if (typeof parsed.model === 'string') {
				selectedModel = parsed.model;
			}

			if (parsed.effort) {
				selectedEffort = parsed.effort;
			}

			if (parsed.mode === 'build' || parsed.mode === 'plan') {
				selectedMode = parsed.mode;
			}
		} catch {
			// ignore malformed saved prompt preferences
		}
	}

	function persistPromptPreferences(): void {
		window.localStorage.setItem(
			PROMPT_PREFERENCES_KEY,
			JSON.stringify({
				model: selectedModel,
				effort: selectedEffort,
				mode: selectedMode
			})
		);
	}

	function restoreDesktopSidebarPreference(): void {
		try {
			const raw = window.localStorage.getItem(DESKTOP_SIDEBAR_OPEN_KEY);
			if (raw === 'true') {
				desktopSidebarPreference = true;
				return;
			}

			if (raw === 'false') {
				desktopSidebarPreference = false;
			}
		} catch {
			// ignore malformed saved sidebar state
		}
	}

	function restorePinnedProjects(): void {
		try {
			const raw = window.localStorage.getItem(PINNED_PROJECTS_KEY);
			if (!raw) {
				return;
			}

			const parsed = JSON.parse(raw);
			if (!parsed || typeof parsed !== 'object') {
				return;
			}

			const nextPinnedProjects: Record<string, true> = {};
			for (const [projectPath, pinned] of Object.entries(parsed)) {
				if (projectPath && pinned === true) {
					nextPinnedProjects[projectPath] = true;
				}
			}

			pinnedProjectPaths = nextPinnedProjects;
			projects = sortProjects(projects);
		} catch {
			// ignore malformed saved pinned projects
		}
	}

	function persistPinnedProjects(): void {
		window.localStorage.setItem(PINNED_PROJECTS_KEY, JSON.stringify(pinnedProjectPaths));
	}

	function persistDesktopSidebarPreference(value: boolean): void {
		if (!hasMounted || !isDesktopViewport) {
			return;
		}

		desktopSidebarPreference = value;
		window.localStorage.setItem(DESKTOP_SIDEBAR_OPEN_KEY, value ? 'true' : 'false');
	}

	function restoreThreadPermissionPresets(): void {
		try {
			const raw = window.localStorage.getItem(THREAD_PERMISSION_PRESETS_KEY);
			if (!raw) {
				return;
			}

			const parsed = JSON.parse(raw);
			if (!parsed || typeof parsed !== 'object') {
				return;
			}

			const nextPresets: Record<string, PermissionPreset> = {};
			for (const [threadId, preset] of Object.entries(parsed)) {
				if (threadId && isPermissionPreset(preset) && preset !== 'full') {
					nextPresets[threadId] = preset;
				}
			}

			threadPermissionPresets = nextPresets;
		} catch {
			// ignore malformed saved thread permission presets
		}
	}

	function persistThreadPermissionPresets(): void {
		window.localStorage.setItem(
			THREAD_PERMISSION_PRESETS_KEY,
			JSON.stringify(threadPermissionPresets)
		);
	}

	function syncProjectSummary(
		projectList: ProjectSummary[],
		projectPath: string,
		threadList: CodexThread[]
	): ProjectSummary[] {
		if (threadList.length === 0) {
			return sortProjects(projectList.filter((project) => project.path !== projectPath));
		}

		return sortProjects(
			projectList.map((project) =>
				project.path === projectPath
					? {
							...project,
							threadCount: threadList.length,
							updatedAt: threadList[0].updatedAt
						}
					: project
			)
		);
	}

	function insertProjectSummary(
		projectList: ProjectSummary[],
		projectPath: string,
		thread: CodexThread
	): ProjectSummary[] {
		const existing = projectList.find((project) => project.path === projectPath);
		if (!existing) {
			return sortProjects([
				{
					name: projectNameFromPath(projectPath),
					path: projectPath,
					threadCount: 1,
					updatedAt: thread.updatedAt
				},
				...projectList
			]);
		}

		return sortProjects(
			projectList.map((project) =>
				project.path === projectPath
					? {
							...project,
							threadCount: project.threadCount + 1,
							updatedAt: Math.max(project.updatedAt, thread.updatedAt)
						}
					: project
			)
		);
	}

	function normalizePromptSubmit(payload: PromptSubmitPayload): PromptSubmitPayload {
		const message = payload.message.trim();
		return {
			message,
			attachments: [...payload.attachments],
			mentions: payload.mentions.filter((mention) => message.includes(mention.token))
		};
	}

	function promptHasContent(payload: PromptSubmitPayload): boolean {
		return (
			payload.message.length > 0 || payload.attachments.length > 0 || payload.mentions.length > 0
		);
	}

	function describeImageAttachments(count: number): string {
		return count === 1 ? '1 image attached' : `${count} images attached`;
	}

	function describeFileMentions(count: number): string {
		return count === 1 ? '1 file mentioned' : `${count} files mentioned`;
	}

	function promptPreview(payload: PromptSubmitPayload): string {
		return (
			trimLine(payload.message) ||
			(payload.attachments.length > 0
				? describeImageAttachments(payload.attachments.length)
				: payload.mentions.length > 0
					? describeFileMentions(payload.mentions.length)
					: '')
		);
	}

	function emptyPromptDraft(): PromptDraft {
		return {
			message: '',
			attachments: [],
			mentions: []
		};
	}

	function readComposerDraft(): PromptDraft {
		return {
			message: composer,
			attachments: [...composerAttachments],
			mentions: [...composerMentions]
		};
	}

	function clonePromptDraft(draft: PromptDraft): PromptDraft {
		return {
			message: draft.message,
			attachments: [...draft.attachments],
			mentions: [...draft.mentions]
		};
	}

	function applyComposerDraft(draft: PromptDraft): void {
		composer = draft.message;
		composerAttachments = [...draft.attachments];
		composerMentions = [...draft.mentions];
	}

	function samePromptDraft(left: PromptDraft, right: PromptDraft): boolean {
		return (
			left.message === right.message &&
			left.attachments.length === right.attachments.length &&
			left.attachments.every(
				(attachment, index) => attachment.id === right.attachments[index]?.id
			) &&
			left.mentions.length === right.mentions.length &&
			left.mentions.every((mention, index) => mention.id === right.mentions[index]?.id)
		);
	}

	function upsertPromptDraft(
		drafts: Record<string, PromptDraft>,
		key: string,
		draft: PromptDraft
	): Record<string, PromptDraft> {
		if (!promptHasContent(draft)) {
			if (!(key in drafts)) {
				return drafts;
			}

			const next = { ...drafts };
			delete next[key];
			return next;
		}

		const normalized = clonePromptDraft(draft);
		const existing = drafts[key];
		if (existing && samePromptDraft(existing, normalized)) {
			return drafts;
		}

		return {
			...drafts,
			[key]: normalized
		};
	}

	function releaseAttachmentPreviews(attachments: PromptAttachmentDraft[]): void {
		for (const attachment of attachments) {
			URL.revokeObjectURL(attachment.previewUrl);
		}
	}

	function queuePendingAttachmentPreviews(
		threadId: string,
		attachments: PromptAttachmentDraft[]
	): void {
		if (attachments.length === 0) {
			return;
		}

		pendingAttachmentReleases = {
			...pendingAttachmentReleases,
			[threadId]: [...(pendingAttachmentReleases[threadId] ?? []), ...attachments]
		};
	}

	function unqueuePendingAttachmentPreviews(
		threadId: string,
		attachments: PromptAttachmentDraft[]
	): void {
		if (attachments.length === 0 || !(threadId in pendingAttachmentReleases)) {
			return;
		}

		const attachmentIds = new Set(attachments.map((attachment) => attachment.id));
		const remaining = (pendingAttachmentReleases[threadId] ?? []).filter(
			(attachment) => !attachmentIds.has(attachment.id)
		);
		if (remaining.length > 0) {
			pendingAttachmentReleases = {
				...pendingAttachmentReleases,
				[threadId]: remaining
			};
			return;
		}

		const next = { ...pendingAttachmentReleases };
		delete next[threadId];
		pendingAttachmentReleases = next;
	}

	function releasePendingAttachmentPreviews(threadId: string): void {
		const attachments = pendingAttachmentReleases[threadId] ?? [];
		if (attachments.length === 0) {
			return;
		}

		releaseAttachmentPreviews(attachments);
		const next = { ...pendingAttachmentReleases };
		delete next[threadId];
		pendingAttachmentReleases = next;
	}

	function renderUserText(item: CodexThreadItem): string {
		if (!isUserMessageItem(item)) {
			return '';
		}

		return item.content
			.filter((entry): entry is { type: 'text'; text: string } => entry.type === 'text')
			.map((entry: { type: 'text'; text: string }) => entry.text)
			.join('\n\n');
	}

	function renderUserImages(item: CodexThreadItem): UserImageAttachment[] {
		if (!isUserMessageItem(item)) {
			return [];
		}

		return item.content
			.map((entry, index) => {
				if (entry.type === 'image' && typeof entry.url === 'string') {
					return {
						src: entry.url,
						alt: `Attached image ${index + 1}`
					};
				}

				if (entry.type === 'localImage' && typeof entry.path === 'string') {
					return {
						src: `/api/input-images?path=${encodeURIComponent(entry.path)}`,
						alt: imageAltFromPath(entry.path, index)
					};
				}

				return null;
			})
			.filter((entry): entry is UserImageAttachment => entry !== null);
	}

	function imageAltFromPath(path: string, index: number): string {
		const fileName = path.split('/').filter(Boolean).at(-1);
		return fileName ? `Attached image ${index + 1}: ${fileName}` : `Attached image ${index + 1}`;
	}

	function applyOptimisticUserTurn(
		threadId: string,
		prompt: PromptSubmitPayload
	): { previousDetailedThread: CodexThread | null; previousThreads: CodexThread[] } | null {
		const previousDetailedThread = threadDetails[threadId] ?? null;
		const previousThreads = threads;
		const baseThread =
			previousDetailedThread ?? threads.find((thread) => thread.id === threadId) ?? null;

		if (!baseThread) {
			return null;
		}

		const optimisticTurnId = `optimistic:${threadId}:${++optimisticTurnCounter}`;
		const optimisticTurn: CodexTurn = {
			id: optimisticTurnId,
			status: 'in_progress',
			error: null,
			items: [
				createOptimisticUserMessage(optimisticTurnId, prompt),
				createStreamingAgentMessage(optimisticTurnId)
			]
		};
		const optimisticPreview = promptPreview(prompt) || baseThread.preview;
		const optimisticUpdatedAt = Date.now();
		const optimisticThread: CodexThread = {
			...baseThread,
			preview: optimisticPreview,
			updatedAt: optimisticUpdatedAt,
			turns: [...baseThread.turns, optimisticTurn]
		};

		threadDetails = {
			...threadDetails,
			[threadId]: optimisticThread
		};
		threads = sortThreads(
			threads.map((thread) =>
				thread.id === threadId
					? {
							...thread,
							preview: optimisticPreview,
							updatedAt: optimisticUpdatedAt
						}
					: thread
			)
		);

		return { previousDetailedThread, previousThreads };
	}

	function restoreOptimisticUserTurn(
		threadId: string,
		state: { previousDetailedThread: CodexThread | null; previousThreads: CodexThread[] } | null
	): void {
		if (!state) {
			return;
		}

		threads = state.previousThreads;

		if (state.previousDetailedThread) {
			threadDetails = {
				...threadDetails,
				[threadId]: state.previousDetailedThread
			};
			return;
		}

		const nextThreadDetails = { ...threadDetails };
		delete nextThreadDetails[threadId];
		threadDetails = nextThreadDetails;
	}

	function createOptimisticUserMessage(
		turnId: string,
		prompt: PromptSubmitPayload
	): Extract<CodexThreadItem, { type: 'userMessage' }> {
		return {
			type: 'userMessage',
			id: `${turnId}:user`,
			content: [
				...(prompt.message
					? [
							{
								type: 'text',
								text: prompt.message,
								text_elements: []
							}
						]
					: []),
				...prompt.mentions.map((mention) => ({
					type: 'mention',
					name: mention.name,
					path: mention.absolutePath
				})),
				...prompt.attachments.map((attachment) => ({
					type: 'image',
					url: attachment.previewUrl
				}))
			]
		};
	}

	function createStreamingAgentMessage(
		turnId: string
	): Extract<CodexThreadItem, { type: 'agentMessage' }> {
		return {
			type: 'agentMessage',
			id: `${turnId}:assistant`,
			text: '',
			phase: 'streaming'
		};
	}

	function appendStreamingAgentDelta(
		threadId: string,
		turnId: string | null,
		itemId: string | null,
		delta: string
	): void {
		if (!delta) {
			return;
		}

		const thread = threadDetails[threadId];
		if (!thread) {
			return;
		}

		const turnIndex = findStreamingTurnIndex(thread, turnId);
		if (turnIndex < 0) {
			return;
		}

		const lastTurn = thread.turns[turnIndex];
		const items = [...lastTurn.items];
		const itemIndex = (itemId ? items.findIndex((item) => item.id === itemId) : -1) ?? -1;
		const fallbackIndex =
			itemIndex >= 0
				? itemIndex
				: items.findIndex(
						(item) =>
							item.type === 'agentMessage' && (item.phase === 'streaming' || item.text === '')
					);

		if (fallbackIndex >= 0 && items[fallbackIndex]?.type === 'agentMessage') {
			const target = items[fallbackIndex];
			items[fallbackIndex] = {
				...target,
				id: itemId ?? target.id,
				text: `${target.text}${delta}`,
				phase: 'streaming'
			};
		} else {
			items.push({
				...createStreamingAgentMessage(lastTurn.id),
				id: itemId ?? `${lastTurn.id}:assistant`,
				text: delta
			});
		}

		const turns = [...thread.turns];
		turns[turnIndex] = {
			...lastTurn,
			status: 'in_progress',
			items
		};

		threadDetails = {
			...threadDetails,
			[threadId]: {
				...thread,
				turns
			}
		};
	}

	function upsertStreamingTurnItem(
		threadId: string,
		turnId: string | null,
		item: CodexThreadItem
	): void {
		const thread = threadDetails[threadId];
		if (!thread) {
			return;
		}

		const turnIndex = findStreamingTurnIndex(thread, turnId);
		if (turnIndex < 0) {
			return;
		}

		const turn = thread.turns[turnIndex];
		const items = [...turn.items];
		const exactIndex = items.findIndex((entry) => entry.id === item.id);
		if (exactIndex >= 0) {
			items[exactIndex] = item;
		} else {
			const fallbackIndex = findStreamingItemReplacementIndex(items, item);
			if (fallbackIndex >= 0) {
				items[fallbackIndex] = item;
			} else {
				items.push(item);
			}
		}

		const turns = [...thread.turns];
		turns[turnIndex] = {
			...turn,
			status: 'in_progress',
			items
		};

		threadDetails = {
			...threadDetails,
			[threadId]: {
				...thread,
				turns
			}
		};
	}

	function findStreamingTurnIndex(thread: CodexThread, turnId: string | null): number {
		if (turnId) {
			const exactIndex = thread.turns.findIndex((turn) => turn.id === turnId);
			if (exactIndex >= 0) {
				return exactIndex;
			}
		}

		for (let index = thread.turns.length - 1; index >= 0; index -= 1) {
			if (isInProgressTurnStatus(thread.turns[index]?.status ?? null)) {
				return index;
			}
		}

		return thread.turns.length - 1;
	}

	function updateTurnStatus(threadId: string, turnId: string, turnStatus: string): void {
		const thread = threadDetails[threadId];
		if (!thread) {
			return;
		}

		const turnIndex = (() => {
			const exactIndex = thread.turns.findIndex((turn) => turn.id === turnId);
			if (exactIndex >= 0) {
				return exactIndex;
			}

			return findStreamingTurnIndex(thread, turnId);
		})();
		if (turnIndex < 0) {
			return;
		}

		const turns = [...thread.turns];
		turns[turnIndex] = {
			...turns[turnIndex],
			id: turnId,
			status: turnStatus
		};

		threadDetails = {
			...threadDetails,
			[threadId]: {
				...thread,
				status: turnStatus,
				turns
			}
		};
	}

	function markTurnInterrupted(threadId: string, turnId: string): void {
		updateTurnStatus(threadId, turnId, 'interrupted');
	}

	function findLastTurnStatusAnchorIndex(items: CodexThreadItem[]): number {
		for (let index = items.length - 1; index >= 0; index -= 1) {
			const item = items[index];
			if (item && shouldRenderConversationItem(item) && !isUserMessageItem(item)) {
				return index;
			}
		}

		return -1;
	}

	function normalizeTurnStatus(status: unknown): string {
		const token = readStatusToken(status);
		return token ? token.toLowerCase().replace(/[_\s-]/g, '') : '';
	}

	function isInterruptedTurnStatus(status: unknown): boolean {
		return normalizeTurnStatus(status) === 'interrupted';
	}

	function isInProgressTurnStatus(status: unknown): boolean {
		return normalizeTurnStatus(status) === 'inprogress';
	}

	function elapsedSecondsFrom(startedAt: number, now = Date.now()): number {
		return Math.max(0, Math.floor((now - startedAt) / 1_000));
	}

	function entryElapsedSeconds(entry: RenderedConversationEntry): number | null {
		if (entry.turnId in turnElapsedSeconds) {
			return turnElapsedSeconds[entry.turnId] ?? null;
		}

		if (
			selectedActiveTurnStartedAt !== null &&
			entry.showStatusNote &&
			isInProgressTurnStatus(entry.turnStatus)
		) {
			return activeTurnElapsedSeconds;
		}

		return null;
	}

	function entryIsStreaming(entry: RenderedConversationEntry): boolean {
		return (
			entry.showStatusNote &&
			selectedActiveTurnStartedAt !== null &&
			isInProgressTurnStatus(entry.turnStatus)
		);
	}

	function entryIsInterrupted(entry: RenderedConversationEntry): boolean {
		return entry.showStatusNote && isInterruptedTurnStatus(entry.turnStatus);
	}

	function entryContextLeftPercent(entry: RenderedConversationEntry): number | null {
		if (!entry.showStatusNote) {
			return null;
		}

		return currentThreadUsage[entry.turnId]?.contextLeftPercent ?? null;
	}

	function findStreamingItemReplacementIndex(
		items: CodexThreadItem[],
		item: CodexThreadItem
	): number {
		if (item.type === 'userMessage') {
			return items.findIndex((entry) => entry.type === 'userMessage');
		}

		if (item.type === 'agentMessage') {
			return items.findIndex(
				(entry) =>
					entry.type === 'agentMessage' && (entry.phase === 'streaming' || entry.text === '')
			);
		}

		return -1;
	}

	function isUserMessageItem(
		item: CodexThreadItem
	): item is Extract<CodexThreadItem, { type: 'userMessage' }> {
		return item.type === 'userMessage';
	}

	function isFileChangeItem(
		item: CodexThreadItem
	): item is Extract<CodexThreadItem, { type: 'fileChange' }> {
		return item.type === 'fileChange';
	}

	function isCommandExecutionItem(
		item: CodexThreadItem
	): item is Extract<CodexThreadItem, { type: 'commandExecution' }> {
		return item.type === 'commandExecution';
	}

	function isPlanItem(item: CodexThreadItem): item is Extract<CodexThreadItem, { type: 'plan' }> {
		return item.type === 'plan' && typeof item.text === 'string';
	}

	function isAgentMessageRenderItem(
		item: CodexThreadItem
	): item is Extract<CodexThreadItem, { type: 'agentMessage' }> {
		return item.type === 'agentMessage';
	}

	function shouldRenderConversationItem(item: CodexThreadItem): boolean {
		if (isPlanItem(item)) {
			return false;
		}

		return (
			isUserMessageItem(item) ||
			isAgentMessageRenderItem(item) ||
			isCommandExecutionItem(item) ||
			isFileChangeItem(item)
		);
	}

	function syncConversationScrollState(): void {
		if (!conversationBody) {
			showScrollToBottom = false;
			return;
		}

		const distanceFromBottom =
			conversationBody.scrollHeight - conversationBody.scrollTop - conversationBody.clientHeight;
		showScrollToBottom = distanceFromBottom > conversationBottomThresholdPx;
	}

	function handleConversationScroll(): void {
		syncConversationScrollState();
	}

	async function scrollConversationToBottom(behavior: ScrollBehavior = 'auto'): Promise<void> {
		await tick();
		conversationBody?.scrollTo({ top: conversationBody.scrollHeight, behavior });
		showScrollToBottom = false;
	}

	function toggleSidebar(): void {
		const next = !sidebarOpen;
		sidebarOpen = next;
		persistDesktopSidebarPreference(next);
	}

	function closeSidebar(): void {
		sidebarOpen = false;
		persistDesktopSidebarPreference(false);
	}

	function collapseSidebarOnMobile(): void {
		if (!isDesktopViewport) {
			sidebarOpen = false;
		}
	}

	function goHome(): void {
		selectedProjectPath = null;
		selectedThreadId = null;
		threads = [];
		banner = null;
		collapseSidebarOnMobile();
	}

	function syncUrlState(): void {
		const url = new URL(window.location.href);

		if (selectedProjectPath) {
			url.searchParams.set('project', selectedProjectPath);
		} else {
			url.searchParams.delete('project');
		}

		if (selectedThreadId) {
			url.searchParams.set('thread', selectedThreadId);
		} else {
			url.searchParams.delete('thread');
		}

		const nextUrl = `${url.pathname}${url.search}${url.hash}`;
		const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
		if (nextUrl !== currentUrl) {
			window.history.replaceState(window.history.state, '', nextUrl);
		}
	}

	function closeThreadEvents(threadId?: string): void {
		if (threadId) {
			threadEventSources.get(threadId)?.close();
			threadEventSources.delete(threadId);
			threadEventsReadyByThread.delete(threadId);
			return;
		}

		for (const source of threadEventSources.values()) {
			source.close();
		}
		threadEventSources.clear();
		threadEventsReadyByThread.clear();
	}

	function ensureThreadEvents(threadId: string): Promise<void> {
		const existing = threadEventsReadyByThread.get(threadId);
		if (existing) {
			return existing;
		}

		const readyPromise = new Promise<void>((resolve, reject) => {
			const source = new EventSource(`/api/threads/${encodeURIComponent(threadId)}/events`);
			let settled = false;
			const clearTrackedThread = () => {
				if (threadEventSources.get(threadId) === source) {
					threadEventSources.delete(threadId);
				}
				if (threadEventsReadyByThread.get(threadId) === readyPromise) {
					threadEventsReadyByThread.delete(threadId);
				}
			};
			const onReady = () => {
				if (settled) {
					return;
				}

				settled = true;
				window.clearTimeout(timeout);
				source.removeEventListener('ready', onReady);
				source.removeEventListener('error', onInitialError);
				resolve();
			};
			const onRpc = (event: Event) => {
				const message = event as MessageEvent<string>;
				handleNotification(JSON.parse(message.data) as RpcNotification);
			};
			const onInitialError = () => {
				if (settled) {
					return;
				}

				settled = true;
				window.clearTimeout(timeout);
				source.removeEventListener('ready', onReady);
				source.removeEventListener('error', onInitialError);
				source.close();
				clearTrackedThread();
				reject(new Error('Failed to subscribe to thread events.'));
			};

			const timeout = window.setTimeout(() => {
				if (settled) {
					return;
				}

				settled = true;
				source.removeEventListener('ready', onReady);
				source.removeEventListener('error', onInitialError);
				source.close();
				clearTrackedThread();
				reject(new Error('Timed out waiting for thread events.'));
			}, 5_000);

			source.addEventListener('ready', onReady, { once: true });
			source.addEventListener('rpc', onRpc);
			source.addEventListener('error', onInitialError);
			threadEventSources.set(threadId, source);
		});

		threadEventsReadyByThread.set(threadId, readyPromise);
		return readyPromise;
	}
</script>

<svelte:head>
	<title>Codex Hub</title>
	<meta name="description" content="Tailnet-hosted coding workspace." />
</svelte:head>

<div class="relative h-dvh max-h-dvh overflow-hidden bg-surface-0">
	{#if sidebarOpen}
		<button
			type="button"
			class="fixed inset-0 z-30 bg-black/60 min-[821px]:hidden"
			onclick={closeSidebar}
			aria-label="Close sidebar"
		></button>
	{/if}

	<aside
		class={`fixed inset-y-0 left-0 z-40 flex w-[19rem] max-w-[calc(100vw-2.5rem)] min-w-0 flex-col overflow-hidden rounded-none border-r border-line bg-surface-1 transition-transform duration-200 ease-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
	>
		<div
			class="flex min-h-[4.9rem] min-w-0 items-center justify-between gap-3 rounded-none border-b border-line px-[1.1rem] py-[1.05rem]"
		>
			<button
				type="button"
				class="flex min-w-0 flex-1 items-center border-0 bg-transparent p-0 text-left"
				onclick={goHome}
				aria-label="Go to home"
			>
				<h1 class="truncate text-[0.95rem] font-medium uppercase tracking-[0.12em] text-muted">
					Codex Hub
				</h1>
			</button>

			<div class="flex shrink-0 items-center gap-2">
				<button
					class={`${iconButtonClass} rounded-none border-0`}
					type="button"
					onclick={closeSidebar}
					aria-label="Hide sidebar"
				>
					<XIcon size={18} />
				</button>
			</div>
		</div>

		<div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-[1.1rem]">
			{#if banner}
				<div
					class="mx-[1.1rem] mt-4 border border-notice-soft-line bg-notice-soft-fill p-[0.85rem] text-[0.82rem] text-notice"
				>
					{banner}
				</div>
			{/if}

			<div class="mt-4">
				{#each projects as project, index (project.path)}
					<section class:border-t={index > 0} class:border-line={index > 0}>
						<div
							class={projectRowClass}
							class:border-l-accent={project.path === selectedProjectPath}
							class:bg-surface-2={project.path === selectedProjectPath}
						>
							<button
								type="button"
								class={projectExpandButtonClass}
								onclick={() => void toggleProjectExpanded(project.path)}
								aria-label={projectIsExpanded(project.path) ? 'Collapse project' : 'Expand project'}
								aria-expanded={projectIsExpanded(project.path)}
							>
								{#if projectIsExpanded(project.path)}
									<CaretDownIcon size={15} />
								{:else}
									<CaretRightIcon size={15} />
								{/if}
							</button>
							<button
								type="button"
								class={projectSelectButtonClass}
								onclick={() => void handleProjectSelect(project.path)}
							>
								<span class="min-w-0 flex-1 truncate font-sans text-[0.85rem]">{project.name}</span>
							</button>
							<button
								type="button"
								class={projectPinButtonClass}
								class:pointer-events-auto={projectIsPinned(project.path)}
								class:opacity-100={projectIsPinned(project.path)}
								class:border-line={projectIsPinned(project.path)}
								class:bg-surface-1={projectIsPinned(project.path)}
								class:text-accent={projectIsPinned(project.path)}
								onclick={(event) => toggleProjectPinned(event, project.path)}
								aria-label={projectIsPinned(project.path) ? 'Unpin project' : 'Pin project'}
								title={projectIsPinned(project.path) ? 'Unpin project' : 'Pin project'}
							>
								<PushPinIcon
									size={14}
									weight={projectIsPinned(project.path) ? 'fill' : 'regular'}
								/>
							</button>
							<button
								type="button"
								class={projectCreateButtonClass}
								class:pointer-events-auto={project.path === selectedProjectPath}
								class:opacity-100={project.path === selectedProjectPath}
								class:border-line={project.path === selectedProjectPath}
								class:bg-surface-1={project.path === selectedProjectPath}
								class:text-fg={project.path === selectedProjectPath}
								onclick={() => void handleCreateThread(project.path)}
								disabled={creatingThread}
								aria-label={`New chat in ${project.name}`}
								title={`New chat in ${project.name}`}
							>
								<PlusIcon size={14} />
							</button>
						</div>

						{#if projectIsExpanded(project.path)}
							<div class="pb-2">
								{#if projectThreadsLoading(project.path)}
									<div class="px-[1.1rem] py-3 pl-[1.85rem] font-mono text-[0.78rem] text-muted">
										loading chats...
									</div>
								{:else if sidebarThreadsForProject(project.path).length === 0}
									<div class="px-[1.1rem] py-3 pl-[1.85rem] font-mono text-[0.78rem] text-muted">
										no chats yet
									</div>
								{:else}
									{#each sidebarThreadsForProject(project.path) as thread (thread.id)}
										<div
											class={chatRowClass}
											class:border-l-accent={thread.id === selectedThreadId}
											class:bg-surface-2={thread.id === selectedThreadId}
											class:text-accent={thread.id === selectedThreadId}
										>
											<button
												type="button"
												class={chatSelectButtonClass}
												onclick={() => void handleSidebarThreadSelect(project.path, thread.id)}
												aria-current={thread.id === selectedThreadId ? 'page' : undefined}
											>
												<span
													class={`h-2.5 w-2.5 shrink-0 rounded-full border transition-[transform,background-color,border-color,opacity] duration-150 ${
														thread.id === selectedThreadId
															? 'border-accent bg-accent opacity-100'
															: 'border-line bg-transparent opacity-55 group-hover:opacity-80'
													}`}
													aria-hidden="true"
												></span>
												<span class="flex min-w-0 flex-1 items-center gap-2 text-[0.79rem]">
													<span class="min-w-0 flex-1 truncate">{chatLabel(thread)}</span>
													{#if threadIsRunning(thread)}
														<SpinnerGapIcon size={13} class="shrink-0 animate-spin text-accent" />
													{/if}
												</span>
											</button>
											<button
												type="button"
												class={threadArchiveButtonClass}
												disabled={Boolean(archivingThreadIds[thread.id]) || threadIsRunning(thread)}
												onclick={(event) => void handleArchiveThread(event, project.path, thread)}
												aria-label={`Archive ${chatLabel(thread)}`}
												title={threadIsRunning(thread)
													? 'Active chats cannot be archived'
													: 'Archive chat'}
											>
												<ArchiveIcon size={14} />
											</button>
										</div>
									{/each}
								{/if}
							</div>
						{/if}
					</section>
				{:else}
					<div
						class="grid gap-[0.35rem] border-t border-line px-[1.1rem] py-4 font-mono text-[0.78rem] text-muted"
					>
						<span class="font-semibold text-fg">no projects yet</span>
						<span>projects appear once they have codex chats</span>
					</div>
				{/each}
			</div>
		</div>

		<SidebarAccountStatus {status} />
	</aside>

	<main
		class={`relative grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-surface-0 transition-[padding] duration-200 ${sidebarOpen ? 'min-[821px]:pl-[19rem]' : ''}`}
	>
		<div class="pointer-events-none absolute inset-x-0 top-0 z-[2] px-[1.1rem] pt-[1.1rem]">
			<div class="flex w-full items-center justify-between gap-3">
				<div class="min-w-0">
					<button
						class={`${iconButtonClass} pointer-events-auto bg-surface-1/88 backdrop-blur-sm ${sidebarOpen ? 'min-[821px]:hidden' : ''}`}
						type="button"
						onclick={toggleSidebar}
						aria-label={sidebarOpen ? 'Toggle sidebar' : 'Show sidebar'}
						aria-expanded={sidebarOpen}
					>
						<ListIcon size={18} />
					</button>
				</div>

				{#if selectedEditorHref}
					<a
						class={toolbarLinkClass}
						href={selectedEditorHref}
						target="_blank"
						rel="noreferrer"
						aria-label="Open current thread project in editor"
					>
						<img class="h-4 w-4 shrink-0" src={vscodeLogo} alt="" />
						<span>Open Editor</span>
					</a>
				{/if}
			</div>
		</div>

		<section
			class="min-h-0 overflow-x-hidden overflow-y-auto px-[1.1rem] pt-[5rem] pb-8 min-[821px]:pt-8"
			bind:this={conversationBody}
			onscroll={handleConversationScroll}
		>
			<div
				class={`mx-auto flex min-h-full w-full flex-col ${showHomeScreen ? 'max-w-[720px]' : 'max-w-[680px]'}`}
			>
				{#if showHomeScreen}
					<div class="flex flex-1 flex-col items-center justify-center px-3 py-10 text-center min-[821px]:py-16">
						<h2 class="text-[clamp(1.4rem,4vw,2rem)] font-medium tracking-[-0.04em] text-fg">
							Codex Hub
						</h2>
						<div class="mt-10 w-full rounded-none border-t border-line">
							{#each homeProjects as project (project.path)}
								<div class="group flex items-center gap-3 rounded-none border-b border-line py-4 text-left transition-colors duration-150 hover:bg-surface-1/35">
									<button
										type="button"
										class="min-w-0 flex-1 cursor-pointer rounded-none border-0 bg-transparent p-0 text-left"
										onclick={() => void handleProjectSelect(project.path)}
									>
										<p class="truncate text-[0.95rem] font-normal tracking-[-0.03em] text-fg transition-colors duration-150 group-hover:text-accent">
											{project.name}
										</p>
										<p class="truncate font-mono text-[0.72rem] text-muted transition-colors duration-150 group-hover:text-fg/72">
											{shortPath(project.path)}
										</p>
									</button>
								</div>
							{/each}
						</div>
					</div>
				{:else if !selectedProjectPath}
					<div class="mb-4 grid w-full gap-[0.4rem] border border-line p-[1.15rem] text-muted">
						<strong>no projects yet</strong>
						<span>projects appear once they have codex chats.</span>
					</div>
				{:else if !selectedThreadId && !creatingThread}
					<div class="mb-4 grid w-full gap-[0.4rem] border border-line p-[1.15rem] text-muted">
						<strong>{currentProject?.name ?? 'project'}</strong>
						<span>Start a chat for this repo.</span>
					</div>
				{:else if isOpeningThread}
					<div
						class="mb-4 grid w-full gap-[0.35rem] border border-line bg-surface-1 p-[1.15rem] text-muted"
					>
						<strong class="truncate text-fg">{selectedThreadLabel}</strong>
						<span>loading chat...</span>
					</div>
				{:else}
					{#if currentThreadTruncatedTurnCount > 0}
						<div
							class="mb-4 flex flex-wrap items-center justify-between gap-3 border border-line bg-surface-1 px-[1rem] py-[0.9rem] text-[0.82rem] text-muted"
						>
							<div class="min-w-0">
								<strong class="block text-fg">Showing recent history</strong>
								<span>
									Loaded the latest {currentThread?.turns.length ?? 0} turns. {currentThreadTruncatedTurnCount}
									older turn{currentThreadTruncatedTurnCount === 1 ? '' : 's'} hidden.
								</span>
							</div>
							<button
								type="button"
								class="inline-flex h-10 shrink-0 items-center justify-center border border-line px-4 font-mono text-[0.74rem] uppercase tracking-[0.12em] text-fg transition-[border-color,color] duration-150 hover:border-accent hover:text-accent disabled:cursor-default disabled:opacity-50"
								onclick={() => void loadFullThreadHistory()}
								disabled={Boolean(
									selectedThreadId && loadingFullHistoryThreadIds[selectedThreadId]
								)}
							>
								{selectedThreadId && loadingFullHistoryThreadIds[selectedThreadId]
									? 'loading...'
									: 'load full history'}
							</button>
						</div>
					{/if}

					{#each renderedConversationEntries as entry (entry.item.id)}
						{#if entry.item.type === 'userMessage'}
							<ChatMessage
								role="user"
								content={renderUserText(entry.item)}
								imageAttachments={renderUserImages(entry.item)}
							/>
						{:else if isAgentMessageRenderItem(entry.item)}
							<ChatMessage
								role="assistant"
								content={entry.item.text}
								streaming={entryIsStreaming(entry)}
								interrupted={entryIsInterrupted(entry)}
								elapsedSeconds={entryElapsedSeconds(entry)}
								showStatusNote={entry.showStatusNote}
								contextLeftPercent={entryContextLeftPercent(entry)}
							/>
						{:else if isCommandExecutionItem(entry.item) || isFileChangeItem(entry.item)}
							<ToolActivity
								item={entry.item}
								projectsRoot={status?.projectsRoot ?? ''}
								streaming={entryIsStreaming(entry)}
								interrupted={entryIsInterrupted(entry)}
								elapsedSeconds={entryElapsedSeconds(entry)}
								showStatusNote={entry.showStatusNote}
								contextLeftPercent={entryContextLeftPercent(entry)}
							/>
						{/if}
					{/each}

					{#if activeQuestionRequests.length > 0}
						<div class="grid gap-3">
							{#each activeQuestionRequests as request (request.requestId)}
								<ServerRequestPanel
									{request}
									inline
									resolving={resolvingRequestId === request.requestId}
									onresolve={(payload) =>
										resolvePendingRequest(request.threadId, request.requestId, payload)}
								/>
							{/each}
						</div>
					{/if}
				{/if}
			</div>
		</section>

		<footer class="relative z-[1] bg-transparent px-[1.1rem] pt-4 pb-4">
			<div
				class="theme-bg-footer-fade pointer-events-none absolute inset-x-0 top-0 h-20 backdrop-blur-[10px]"
			></div>
			<div class="relative mx-auto w-full max-w-[680px]">
				{#if showScrollToBottom}
					<div class="pointer-events-none absolute right-3 bottom-full mb-3">
						<button
							type="button"
							class="pointer-events-auto inline-flex h-10 w-10 items-center justify-center border border-line bg-surface-1/88 text-fg backdrop-blur-sm transition-[border-color,background-color,color] duration-150 hover:border-accent hover:text-accent"
							onclick={() => void scrollConversationToBottom('smooth')}
							aria-label="Scroll to bottom"
						>
							<CaretDownIcon size={18} />
						</button>
					</div>
				{/if}

				{#if activeFooterRequests.length > 0}
					<div class="mb-3 grid gap-3">
						{#each activeFooterRequests as request (request.requestId)}
							<ServerRequestPanel
								{request}
								resolving={resolvingRequestId === request.requestId}
								onresolve={(payload) =>
									resolvePendingRequest(request.threadId, request.requestId, payload)}
							/>
						{/each}
					</div>
				{/if}

				<PromptInput
					bind:value={composer}
					bind:attachments={composerAttachments}
					bind:mentions={composerMentions}
					bind:selectedModel
					bind:selectedEffort
					bind:selectedMode
					bind:selectedPermissionPreset
					{models}
					projectPath={selectedProjectPath}
					placeholder={showHomeScreen ? 'pick a project to start building' : 'enter your message'}
					disabled={!selectedProjectPath}
					isStreaming={selectedActiveTurnId !== null}
					canInterrupt={canInterruptActiveTurn}
					isInterrupting={selectedThreadInterrupting}
					onsubmit={sendMessage}
					oninterrupt={interruptActiveTurn}
				/>
			</div>
		</footer>
	</main>
</div>
