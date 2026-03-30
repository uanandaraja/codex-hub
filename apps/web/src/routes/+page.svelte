<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import {
		CaretDownIcon,
		CaretRightIcon,
		ListIcon,
		PlusIcon,
		SpinnerGapIcon,
		XIcon
	} from 'phosphor-svelte';
	import vscodeLogo from '$lib/assets/vscode.svg';
	import ChatMessage from '$lib/components/ChatMessage.svelte';
	import PromptInput from '$lib/components/PromptInput.svelte';
	import ServerRequestPanel from '$lib/components/ServerRequestPanel.svelte';
	import SidebarAccountStatus from '$lib/components/SidebarAccountStatus.svelte';
	import ToolActivity from '$lib/components/ToolActivity.svelte';
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

	const PROMPT_PREFERENCES_KEY = 'codex-hub.prompt-preferences';
	const DESKTOP_SIDEBAR_OPEN_KEY = 'codex-hub.desktop-sidebar-open';
	const THREAD_PERMISSION_PRESETS_KEY = 'codex-hub.thread-permission-presets';
	const THREAD_NAME_BACKFILL_KEY = 'codex-hub.thread-name-backfill-v2';

	let { data } = $props<{ data: PageData }>();

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
	const initialProjectPath = untrack(
		() => data.initialProjectPath ?? initialProjects[0]?.path ?? null
	);
	const initialThreadId = untrack(
		() => data.initialThreadId ?? resolveInitialThreadId(initialThreads)
	);
	const initialDetailedThread = untrack(() => data.initialThread ?? null);
	const initialThreadUsage = untrack(() => data.initialThreadUsage ?? {});
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
	let notificationPermission = $state<NotificationPermission | 'unsupported'>('unsupported');
	let activeTurnIdsByThread = $state<Record<string, string>>({});
	let activeTurnStartedAtByThread = $state<Record<string, number>>({});
	let interruptingTurnsByThread = $state<Record<string, true>>({});
	let expandedProjectPaths = $state<Record<string, true>>(
		initialProjectPath ? { [initialProjectPath]: true } : {}
	);
	let loadingProjectThreadsByPath = $state<Record<string, true>>({});
	let streamTickMs = $state(Date.now());
	let turnElapsedSeconds = $state<Record<string, number>>({});
	let conversationBody = $state<HTMLElement | null>(null);
	let sidebarOpen = $state(false);
	let isDesktopViewport = false;
	let desktopSidebarPreference: boolean | null = null;
	let hasMounted = false;
	let optimisticTurnCounter = 0;
	let syncedPermissionThreadId: string | null | undefined = undefined;
	let notifiedRequestIds = $state<Record<string, true>>({});
	let notifiedTurnEvents = $state<Record<string, true>>({});
	const threadEventSources = new Map<string, EventSource>();
	const threadEventsReadyByThread = new Map<string, Promise<void>>();

	const iconButtonClass =
		'inline-flex h-11 w-11 items-center justify-center border border-line bg-transparent text-fg transition-[background,border-color,color] duration-150 hover:border-accent hover:text-accent disabled:cursor-default disabled:opacity-[0.45]';
	const toolbarLinkClass =
		'pointer-events-auto hidden h-11 items-center gap-2 border border-line bg-surface-1/88 px-4 font-mono text-[0.74rem] uppercase tracking-[0.16em] text-fg backdrop-blur-sm transition-[background,border-color,color] duration-150 hover:border-accent hover:text-accent min-[821px]:inline-flex';
	const projectRowClass =
		'flex w-full min-w-0 items-center gap-1 border-0 border-l-2 border-l-transparent bg-transparent pl-[0.45rem] text-fg';
	const projectExpandButtonClass =
		'inline-flex h-9 w-9 shrink-0 items-center justify-center border-0 bg-transparent text-muted transition-colors duration-150 hover:text-fg';
	const projectSelectButtonClass =
		'flex min-w-0 flex-1 items-center justify-between gap-3 border-0 bg-transparent py-[0.95rem] pr-[1.1rem] text-left text-fg';
	const chatRowClass =
		'flex w-full min-w-0 items-center border-0 border-l-2 border-l-transparent bg-transparent px-[1.1rem] py-[0.78rem] pl-[1.85rem] text-left text-fg';
	const currentProject = $derived.by<ProjectSummary | null>(
		() => projects.find((project) => project.path === selectedProjectPath) ?? null
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
		if (!selectedProjectPath && projects[0]) {
			const projectPath = projects[0].path;
			selectedProjectPath = projectPath;
			if (!(projectPath in expandedProjectPaths)) {
				expandedProjectPaths = {
					...expandedProjectPaths,
					[projectPath]: true
				};
			}
		}
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

		mediaQuery.addEventListener('change', handleViewportChange);
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
			window.clearInterval(statusInterval);
			releaseAttachmentPreviews(composerAttachments);
			for (const attachments of Object.values(pendingAttachmentReleases)) {
				releaseAttachmentPreviews(attachments);
			}
			closeThreadEvents();
		};
	});

	$effect(() => {
		void renderedConversationEntries;
		void activeQuestionRequests;
		void scrollConversationToBottom();
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

			const nextProjectPath =
				selectedProjectPath && nextProjects.some((project) => project.path === selectedProjectPath)
					? selectedProjectPath
					: (nextProjects[0]?.path ?? null);

			if (!nextProjectPath) {
				selectedProjectPath = null;
				selectedThreadId = null;
				threads = [];
				projectThreadsByPath = {};
				expandedProjectPaths = {};
				loadingProjectThreadsByPath = {};
				banner = null;
				return;
			}

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
			await ensureThreadEvents(threadId);
			await api(`/api/threads/${encodeURIComponent(threadId)}/resume`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({})
			});
			await Promise.all([fetchThread(threadId), fetchPendingRequests(threadId)]);
			banner = null;
		} catch (error) {
			banner = error instanceof Error ? error.message : 'Failed to open chat.';
		}
	}

	async function fetchThread(threadId: string): Promise<void> {
		const result = await api<ThreadReadResponse>(
			`/api/threads/${encodeURIComponent(threadId)}?includeTurns=true`
		);
		threadDetails = {
			...threadDetails,
			[threadId]: result.thread
		};
		if (threads.some((thread) => thread.id === threadId)) {
			threads = sortThreads(
				threads.map((thread) => (thread.id === threadId ? { ...thread, ...result.thread } : thread))
			);
		}
		threadUsageByThread = {
			...threadUsageByThread,
			[threadId]: result.usage.turns
		};
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
				result.thread,
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
			const turnStatus = readTurnStatus(notification.params);
			if (turnId && turnStatus) {
				updateTurnStatus(threadId, turnId, turnStatus);
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

		try {
			const tasks: Promise<void>[] = [refreshThreads()];
			if (threadId === selectedThreadId || threadId in threadDetails) {
				tasks.push(fetchThread(threadId));
			}
			await Promise.all(tasks);
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
			clearThreadActiveTurn(threadId);
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

		const normalizedStatus = normalizeTurnStatus(thread.status);
		return normalizedStatus === 'inprogress' || normalizedStatus === 'running' || normalizedStatus === 'active';
	}

	function projectChatCount(projectPath: string): number {
		return projects.find((project) => project.path === projectPath)?.threadCount ?? 0;
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

	function notifyBrowser(title: string, body: string, tag: string): void {
		if (!shouldSendBrowserNotification()) {
			return;
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

		notifiedRequestIds = {
			...notifiedRequestIds,
			[requestKey]: true
		};

		const threadLabel = threadNotificationLabel(threadId);
		if (request.method === 'item/tool/requestUserInput') {
			notifyBrowser('Follow-up needed', `${threadLabel} is waiting for your answer.`, requestKey);
			return;
		}

		if (
			request.method === 'item/commandExecution/requestApproval' ||
			request.method === 'item/fileChange/requestApproval' ||
			request.method === 'item/permissions/requestApproval'
		) {
			notifyBrowser('Approval needed', `${threadLabel} is waiting for confirmation.`, requestKey);
			return;
		}

		notifyBrowser('Action needed', `${threadLabel} is waiting for your input.`, requestKey);
	}

	function maybeNotifyTurnEvent(threadId: string, turnId: string, turnStatus: string): void {
		const eventKey = `${threadId}:${turnId}:${turnStatus}`;
		if (notifiedTurnEvents[eventKey]) {
			return;
		}

		notifiedTurnEvents = {
			...notifiedTurnEvents,
			[eventKey]: true
		};

		const threadLabel = threadNotificationLabel(threadId);
		if (turnStatus === 'completed') {
			notifyBrowser('Assistant finished', `${threadLabel} has a new reply ready.`, eventKey);
			return;
		}

		if (turnStatus === 'interrupted') {
			notifyBrowser('Assistant interrupted', `${threadLabel} stopped before finishing.`, eventKey);
			return;
		}

		if (turnStatus === 'failed' || turnStatus === 'error') {
			notifyBrowser('Assistant needs attention', `${threadLabel} ended with an error.`, eventKey);
		}
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
		if (!turn || typeof turn !== 'object' || !('status' in turn)) {
			return null;
		}

		return readString(turn.status);
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

	function resolveInitialThreadId(initialThreadsList: CodexThread[]): string | null {
		return initialThreadsList[0]?.id ?? null;
	}

	function applyThreadNameLocally(threadId: string, name: string): void {
		threads = threads.map((thread) => (thread.id === threadId ? { ...thread, name } : thread));

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

			return left.displayName.localeCompare(right.displayName);
		});
	}

	function sortPendingRequests(list: PendingServerRequest[]): PendingServerRequest[] {
		return [...list].sort((left, right) => left.createdAt - right.createdAt);
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
			return projectList;
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
		return payload.message.length > 0 || payload.attachments.length > 0 || payload.mentions.length > 0;
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

	function updateTurnStatus(threadId: string, turnId: string, status: string): void {
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
			status
		};

		threadDetails = {
			...threadDetails,
			[threadId]: {
				...thread,
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
			isInProgressTurnStatus(entry.turnStatus) &&
			isAgentMessageRenderItem(entry.item)
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

	async function scrollConversationToBottom(): Promise<void> {
		await tick();
		conversationBody?.scrollTo({ top: conversationBody.scrollHeight });
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
		class={`fixed inset-y-0 left-0 z-40 flex w-[19rem] max-w-[calc(100vw-2.5rem)] min-w-0 flex-col overflow-hidden border-r border-line bg-surface-1 transition-transform duration-200 ease-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
	>
		<div
			class="flex min-h-[4.9rem] min-w-0 items-center justify-between gap-3 border-b border-line px-[1.1rem] py-[1.05rem]"
		>
			<div class="min-w-0">
				<p class="mb-[0.35rem] truncate text-[0.72rem] uppercase tracking-[0.12em] text-muted">
					Codex Hub
				</p>
				<h1 class="truncate text-base font-semibold tracking-[-0.02em] text-fg">Projects</h1>
			</div>

			<div class="flex shrink-0 items-center gap-2">
				<button
					class={iconButtonClass}
					type="button"
					onclick={() => void handleCreateThread(selectedProjectPath)}
					disabled={!selectedProjectPath || creatingThread}
					aria-label="New chat"
				>
					<PlusIcon size={18} />
				</button>
				<button
					class={iconButtonClass}
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
					class="mx-[1.1rem] mt-4 border border-[rgba(255,124,96,0.24)] bg-[rgba(255,124,96,0.08)] p-[0.85rem] text-[0.82rem] text-notice"
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
								<span class="font-mono text-[0.78rem] text-muted"
									>{projectChatCount(project.path)}</span
								>
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
										<button
											type="button"
											class={chatRowClass}
											class:border-l-accent={thread.id === selectedThreadId}
											class:bg-surface-2={thread.id === selectedThreadId}
											onclick={() => void handleSidebarThreadSelect(project.path, thread.id)}
										>
											<strong class="flex min-w-0 flex-1 items-center gap-2 text-[0.79rem] font-medium">
												<span class="min-w-0 flex-1 truncate">{chatLabel(thread)}</span>
												{#if threadIsRunning(thread)}
													<SpinnerGapIcon size={13} class="shrink-0 animate-spin text-accent" />
												{/if}
											</strong>
										</button>
									{/each}
								{/if}
							</div>
						{/if}
					</section>
				{:else}
					<div
						class="grid gap-[0.35rem] border-t border-line px-[1.1rem] py-4 font-mono text-[0.78rem] text-muted"
					>
						<strong>no projects yet</strong>
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
		<div
			class="pointer-events-none absolute inset-x-0 top-0 z-[2] px-[1.1rem] pt-[1.1rem]"
		>
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
		>
			<div class="mx-auto flex w-full max-w-[680px] flex-col">
				{#if !selectedProjectPath}
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
				class="pointer-events-none absolute inset-x-0 top-0 h-20 bg-[linear-gradient(180deg,rgba(9,10,12,0),rgba(9,10,12,0.56)_42%,rgba(9,10,12,0.92)_100%)] backdrop-blur-[10px]"
			></div>
			<div class="relative mx-auto w-full max-w-[680px]">
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
					placeholder="enter your message"
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
