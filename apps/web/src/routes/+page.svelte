<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { ArrowsClockwiseIcon, ListIcon, PlusIcon } from 'phosphor-svelte';
	import ChatMessage from '$lib/components/ChatMessage.svelte';
	import PromptInput from '$lib/components/PromptInput.svelte';
	import ServerRequestPanel from '$lib/components/ServerRequestPanel.svelte';
	import ToolActivity from '$lib/components/ToolActivity.svelte';
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

	const PROMPT_PREFERENCES_KEY = 'codex-hub.prompt-preferences';
	const THREAD_PERMISSION_PRESETS_KEY = 'codex-hub.thread-permission-presets';
	const THREAD_NAME_BACKFILL_KEY = 'codex-hub.thread-name-backfill-v2';

	let { data } = $props<{ data: PageData }>();

	const initialStatus = untrack(() => data.status);
	const initialModels = untrack(() => sortModels(data.models));
	const initialProjects = untrack(() => sortProjects(data.projects));
	const initialThreads = untrack(() => sortThreads(data.threads));
	const initialBanner = untrack(
		() => data.errors.status ?? data.errors.projects ?? data.errors.models ?? data.errors.threads ?? null
	);
	const initialProjectPath = untrack(() => data.initialProjectPath ?? initialProjects[0]?.path ?? null);
	const initialThreadId = untrack(() => data.initialThreadId ?? resolveInitialThreadId(initialThreads));
	const initialDetailedThread = untrack(() => data.initialThread ?? null);
	const initialThreadUsage = untrack(() => data.initialThreadUsage ?? {});
	const initialPendingRequests = untrack(() => data.initialPendingRequests ?? []);

	let status = $state<GatewayStatus | null>(initialStatus);
	let models = $state<ModelSummary[]>(initialModels);
	let projects = $state<ProjectSummary[]>(initialProjects);
	let threads = $state<CodexThread[]>(initialThreads);
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
	let creatingThread = $state(false);
	let refreshingWorkspace = $state(false);
	let resolvingRequestId = $state<number | null>(null);
	let banner = $state<string | null>(initialBanner);
	let composer = $state('');
	let notificationPermission = $state<NotificationPermission | 'unsupported'>('unsupported');
	let activeTurnId = $state<string | null>(null);
	let activeTurnStartedAt = $state<number | null>(null);
	let interruptingTurn = $state(false);
	let streamTickMs = $state(Date.now());
	let turnElapsedSeconds = $state<Record<string, number>>({});
	let conversationBody = $state<HTMLElement | null>(null);
	let sidebarOpen = $state(false);
	let isDesktopViewport = false;
	let hasMounted = false;
	let optimisticTurnCounter = 0;
	let syncedPermissionThreadId: string | null | undefined = undefined;
	let eventSource = $state<EventSource | null>(null);
	let subscribedThreadId = $state<string | null>(null);
	let threadEventsReady = $state<Promise<void> | null>(null);
	let notifiedRequestIds = $state<Record<string, true>>({});
	let notifiedTurnEvents = $state<Record<string, true>>({});

	const iconButtonClass =
		'inline-flex h-11 w-11 items-center justify-center border border-line bg-transparent text-fg transition-[background,border-color,color] duration-150 hover:border-accent hover:text-accent disabled:cursor-default disabled:opacity-[0.45]';
	const projectRowClass =
		'flex w-full min-w-0 items-center justify-between gap-3 border-0 border-l-2 border-l-transparent bg-transparent px-[1.1rem] py-[0.95rem] text-left text-fg';
	const chatRowClass =
		'grid w-full min-w-0 grid-cols-1 border-0 border-l-2 border-l-transparent bg-transparent px-[1.1rem] py-3 pl-[1.85rem] text-left text-fg';
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
	const permissionPresetConfig = $derived.by(() => resolvePermissionPreset(selectedPermissionPreset));

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
					const lastAgentIndex = findLastAgentMessageIndex(turn.items);
					return turn.items
						.map((item, index) =>
							shouldRenderConversationItem(item)
								? {
										item,
										turnId: turn.id,
										turnStatus: turn.status,
										showStatusNote:
											index === lastAgentIndex && isAgentMessageRenderItem(item)
									}
								: null
						)
						.filter((entry): entry is RenderedConversationEntry => entry !== null);
				})
			: []
	);
	const activeTurnElapsedSeconds = $derived.by(() =>
		activeTurnStartedAt === null ? 0 : elapsedSecondsFrom(activeTurnStartedAt, streamTickMs)
	);
	const canInterruptActiveTurn = $derived(
		selectedThreadId !== null && activeTurnId !== null && activeTurnId !== 'pending' && !interruptingTurn
	);

	$effect(() => {
		if (!selectedProjectPath && projects[0]) {
			selectedProjectPath = projects[0].path;
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
		syncNotificationPermission();
		void ensureBrowserNotificationPermission();
		syncedPermissionThreadId = undefined;
		selectedPermissionPreset = permissionPresetForThread(selectedThreadId);
		hasMounted = true;
		const mediaQuery = window.matchMedia('(min-width: 821px)');
		const syncViewport = (matches: boolean) => {
			isDesktopViewport = matches;
			sidebarOpen = matches;
		};

		syncViewport(mediaQuery.matches);
		const handleViewportChange = (event: MediaQueryListEvent) => {
			syncViewport(event.matches);
		};

		mediaQuery.addEventListener('change', handleViewportChange);

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
			closeThreadEvents();
		};
	});

	$effect(() => {
		void renderedConversationEntries;
		void activeQuestionRequests;
		void scrollConversationToBottom();
	});

	$effect(() => {
		if (!activeTurnId || activeTurnStartedAt === null) {
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
		if (!selectedThreadId || !activeTurnId || activeTurnStartedAt === null) {
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
		if (selectedThreadId || !hasMounted) {
			return;
		}

		closeThreadEvents();
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
					: nextProjects[0]?.path ?? null;

			if (!nextProjectPath) {
				selectedProjectPath = null;
				selectedThreadId = null;
				threads = [];
				banner = null;
				return;
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

	async function ensureThreadReady(threadId: string): Promise<void> {
		if (threadId !== selectedThreadId) {
			activeTurnId = null;
			activeTurnStartedAt = null;
			interruptingTurn = false;
		}

		selectedThreadId = threadId;
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
		const result = await api<{ data: CodexThread[] }>(
			`/api/threads?projectPath=${encodeURIComponent(projectPath)}`
		);
		const nextThreads = sortThreads(result.data);
		threads = nextThreads;
		selectedProjectPath = projectPath;
		selectedThreadId =
			preferredThreadId && nextThreads.some((thread) => thread.id === preferredThreadId)
				? preferredThreadId
				: nextThreads[0]?.id ?? null;
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

	async function handleThreadSelect(threadId: string): Promise<void> {
		collapseSidebarOnMobile();
		await ensureThreadReady(threadId);
	}

	async function createThread(projectPath = selectedProjectPath, firstMessage?: string): Promise<string | null> {
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

			threads = sortThreads([result.thread, ...threads.filter((thread) => thread.id !== result.thread.id)]);
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
			projects = insertProjectSummary(projects, projectPath, result.thread);
			pendingRequestsByThread = {
				...pendingRequestsByThread,
				[result.thread.id]: []
			};
			await ensureThreadEvents(result.thread.id);
			banner = null;

			if (firstMessage) {
				await sendTurn(result.thread.id, firstMessage);
			}

			return result.thread.id;
		} catch (error) {
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

	async function sendMessage(messageValue = composer): Promise<void> {
		const message = messageValue.trim();
		if (!message || !selectedProjectPath) {
			return;
		}

		composer = '';

		if (!selectedThreadId) {
			await createThread(selectedProjectPath, message);
			return;
		}

		await sendTurn(selectedThreadId, message);
	}

	async function sendTurn(threadId: string, message: string): Promise<void> {
		activeTurnId = 'pending';
		activeTurnStartedAt = Date.now();
		interruptingTurn = false;
		const optimisticState = applyOptimisticUserTurn(threadId, message);

		try {
			await api(`/api/threads/${encodeURIComponent(threadId)}/turns`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					message,
					model: selectedModelSummary?.model ?? undefined,
					effort: selectedEffort,
					mode: selectedMode,
					approvalPolicy: permissionPresetConfig.approvalPolicy,
					sandbox: permissionPresetConfig.sandbox
				})
			});

			await refreshThreads();
		} catch (error) {
			restoreOptimisticUserTurn(threadId, optimisticState);
			composer = message;
			activeTurnId = null;
			activeTurnStartedAt = null;
			interruptingTurn = false;
			banner = error instanceof Error ? error.message : 'Failed to send message.';
		}
	}

	async function interruptActiveTurn(): Promise<void> {
		if (!selectedThreadId || !activeTurnId || activeTurnId === 'pending' || interruptingTurn) {
			return;
		}

		interruptingTurn = true;
		const turnId = activeTurnId;
		const elapsedSeconds = activeTurnStartedAt === null ? null : activeTurnElapsedSeconds;

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
			interruptingTurn = false;
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
		if (!threadId || threadId !== selectedThreadId) {
			return;
		}

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
			activeTurnId = turnId;
			if (activeTurnStartedAt === null) {
				activeTurnStartedAt = Date.now();
			}
			if (turnId !== 'pending') {
				updateTurnStatus(threadId, turnId, readTurnStatus(notification.params) ?? 'inProgress');
			}
			return;
		}

		if (notification.method === 'item/started' || notification.method === 'item/completed') {
			const item = readTurnItem(notification.params);
			if (!item) {
				return;
			}

			upsertStreamingTurnItem(threadId, readTurnId(notification.params), item);
			return;
		}

		if (notification.method === 'item/agentMessage/delta') {
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
				if (turnStatus === 'interrupted' && activeTurnStartedAt !== null) {
					turnElapsedSeconds = {
						...turnElapsedSeconds,
						[turnId]: activeTurnElapsedSeconds
					};
				}
				maybeNotifyTurnEvent(threadId, turnId, turnStatus);
			}
			void finalizeTurn(threadId);
			return;
		}
	}

	async function finalizeTurn(threadId: string): Promise<void> {
		const finalTurnId = activeTurnId;
		const finalStartedAt = activeTurnStartedAt;

		try {
			await Promise.all([fetchThread(threadId), refreshThreads()]);
		} catch (error) {
			banner = error instanceof Error ? error.message : 'Failed to finalize chat.';
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
			activeTurnId = null;
			activeTurnStartedAt = null;
			interruptingTurn = false;
			void maybeGenerateThreadName(threadId);
		}
	}

	function chatLabel(thread: CodexThread): string {
		return thread.name || trimLine(thread.preview) || 'new chat';
	}

	function chatPreview(thread: CodexThread): string {
		return trimLine(thread.preview) || shortPath(thread.cwd);
	}

	function projectChatCount(projectPath: string): number {
		return projects.find((project) => project.path === projectPath)?.threadCount ?? 0;
	}

	function projectNameFromPath(path: string): string {
		const segments = path.split('/').filter(Boolean);
		return segments.at(-1) ?? path;
	}

	function trimLine(value: string | null | undefined): string {
		return value?.replace(/\s+/g, ' ').trim() ?? '';
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
		const thread = threadDetails[threadId] ?? threads.find((entry) => entry.id === threadId) ?? null;
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

			await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()));
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
			if (left.updatedAt !== right.updatedAt) {
				return right.updatedAt - left.updatedAt;
			}

			return left.name.localeCompare(right.name);
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
		return list.find((model) => model.isDefault)?.defaultReasoningEffort ?? list[0]?.defaultReasoningEffort ?? null;
	}

	function resolvePermissionPreset(
		preset: PermissionPreset
	): { approvalPolicy: 'on-request' | 'never'; sandbox: 'workspace-write' | 'danger-full-access' } {
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

	function renderUserText(item: CodexThreadItem): string {
		if (!isUserMessageItem(item)) {
			return '';
		}

		return item.content
			.filter((entry): entry is { type: 'text'; text: string } => entry.type === 'text')
			.map((entry: { type: 'text'; text: string }) => entry.text)
			.join('\n\n');
	}

	function applyOptimisticUserTurn(
		threadId: string,
		message: string
	): { previousDetailedThread: CodexThread | null; previousThreads: CodexThread[] } | null {
		const previousDetailedThread = threadDetails[threadId] ?? null;
		const previousThreads = threads;
		const baseThread = previousDetailedThread ?? threads.find((thread) => thread.id === threadId) ?? null;

		if (!baseThread) {
			return null;
		}

		const optimisticTurnId = `optimistic:${threadId}:${++optimisticTurnCounter}`;
		const optimisticTurn: CodexTurn = {
			id: optimisticTurnId,
			status: 'in_progress',
			error: null,
			items: [
				createOptimisticUserMessage(optimisticTurnId, message),
				createStreamingAgentMessage(optimisticTurnId)
			]
		};
		const optimisticPreview = trimLine(message) || baseThread.preview;
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
		message: string
	): Extract<CodexThreadItem, { type: 'userMessage' }> {
		return {
			type: 'userMessage',
			id: `${turnId}:user`,
			content: [
				{
					type: 'text',
					text: message,
					text_elements: []
				}
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
		const itemIndex =
			(itemId ? items.findIndex((item) => item.id === itemId) : -1) ??
			-1;
		const fallbackIndex =
			itemIndex >= 0
				? itemIndex
				: items.findIndex(
						(item) => item.type === 'agentMessage' && (item.phase === 'streaming' || item.text === '')
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
			if (thread.turns[index]?.status === 'in_progress') {
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

	function findLastAgentMessageIndex(items: CodexThreadItem[]): number {
		for (let index = items.length - 1; index >= 0; index -= 1) {
			if (isAgentMessageRenderItem(items[index]) && shouldRenderConversationItem(items[index])) {
				return index;
			}
		}

		return -1;
	}

	function normalizeTurnStatus(status: string): string {
		return status.toLowerCase().replace(/[_\s-]/g, '');
	}

	function isInterruptedTurnStatus(status: string): boolean {
		return normalizeTurnStatus(status) === 'interrupted';
	}

	function isInProgressTurnStatus(status: string): boolean {
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
			activeTurnStartedAt !== null &&
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
			activeTurnStartedAt !== null &&
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

	function findStreamingItemReplacementIndex(items: CodexThreadItem[], item: CodexThreadItem): number {
		if (item.type === 'userMessage') {
			return items.findIndex((entry) => entry.type === 'userMessage');
		}

		if (item.type === 'agentMessage') {
			return items.findIndex(
				(entry) => entry.type === 'agentMessage' && (entry.phase === 'streaming' || entry.text === '')
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

	function isPlanItem(
		item: CodexThreadItem
	): item is Extract<CodexThreadItem, { type: 'plan' }> {
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

		return isUserMessageItem(item) || isAgentMessageRenderItem(item) || isCommandExecutionItem(item) || isFileChangeItem(item);
	}

	async function scrollConversationToBottom(): Promise<void> {
		await tick();
		conversationBody?.scrollTo({ top: conversationBody.scrollHeight });
	}

	function toggleSidebar(): void {
		sidebarOpen = !sidebarOpen;
	}

	function closeSidebar(): void {
		sidebarOpen = false;
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

	function closeThreadEvents(): void {
		eventSource?.close();
		eventSource = null;
		subscribedThreadId = null;
		threadEventsReady = null;
	}

	function ensureThreadEvents(threadId: string): Promise<void> {
		if (subscribedThreadId === threadId && threadEventsReady) {
			return threadEventsReady;
		}

		closeThreadEvents();
		subscribedThreadId = threadId;
		threadEventsReady = new Promise<void>((resolve, reject) => {
			const source = new EventSource(`/api/threads/${encodeURIComponent(threadId)}/events`);
			let settled = false;
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
				if (eventSource === source) {
					eventSource = null;
					subscribedThreadId = null;
					threadEventsReady = null;
				}
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
				if (eventSource === source) {
					eventSource = null;
					subscribedThreadId = null;
					threadEventsReady = null;
				}
				reject(new Error('Timed out waiting for thread events.'));
			}, 5_000);

			source.addEventListener('ready', onReady, { once: true });
			source.addEventListener('rpc', onRpc);
			source.addEventListener('error', onInitialError);
			eventSource = source;
		});

		return threadEventsReady;
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
		<div class="flex h-[4.75rem] min-w-0 items-center justify-between gap-3 border-b border-line px-[1.1rem]">
			<div class="min-w-0">
				<p class="mb-[0.35rem] truncate text-[0.72rem] uppercase tracking-[0.12em] text-muted">Codex Hub</p>
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
					onclick={() => void refreshWorkspace()}
					aria-label={refreshingWorkspace ? 'Syncing workspace' : 'Sync workspace'}
				>
					<ArrowsClockwiseIcon size={18} class={refreshingWorkspace ? 'animate-spin' : undefined} />
				</button>
			</div>
		</div>

		<div class="min-h-0 overflow-x-hidden overflow-y-auto pb-[1.1rem]">
			{#if banner}
				<div class="mx-[1.1rem] mt-4 border border-[rgba(255,124,96,0.24)] bg-[rgba(255,124,96,0.08)] p-[0.85rem] text-[0.82rem] text-notice">
					{banner}
				</div>
			{/if}

			<div class="mt-4">
				{#each projects as project, index (project.path)}
					<section class:border-t={index > 0} class:border-line={index > 0}>
						<button
							type="button"
							class={projectRowClass}
							class:border-l-accent={project.path === selectedProjectPath}
							class:bg-surface-2={project.path === selectedProjectPath}
							onclick={() => void handleProjectSelect(project.path)}
						>
							<span class="min-w-0 flex-1 truncate font-sans text-[0.85rem]">{project.name}</span>
							<span class="font-mono text-[0.78rem] text-muted">{projectChatCount(project.path)}</span>
						</button>

						{#if project.path === selectedProjectPath}
							<div class="pb-2">
								{#if projectThreads.length === 0}
									<div class="px-[1.1rem] py-3 pl-[1.85rem] font-mono text-[0.78rem] text-muted">
										no chats yet
									</div>
								{:else}
									{#each projectThreads as thread (thread.id)}
										<button
											type="button"
											class={chatRowClass}
											class:border-l-accent={thread.id === selectedThreadId}
											class:bg-surface-2={thread.id === selectedThreadId}
											onclick={() => void handleThreadSelect(thread.id)}
										>
											<strong class="block min-w-0 truncate text-[0.85rem] font-medium">
												{chatLabel(thread)}
											</strong>
											<span class="block min-w-0 truncate font-mono text-[0.78rem] text-muted">
												{chatPreview(thread)}
											</span>
										</button>
									{/each}
								{/if}
							</div>
						{/if}
					</section>
				{:else}
					<div class="grid gap-[0.35rem] border-t border-line px-[1.1rem] py-4 font-mono text-[0.78rem] text-muted">
						<strong>no projects yet</strong>
						<span>projects appear once they have codex chats</span>
					</div>
				{/each}
			</div>
		</div>
	</aside>

	<main
		class={`relative grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-surface-0 transition-[padding] duration-200 ${sidebarOpen ? 'min-[821px]:pl-[19rem]' : ''}`}
	>
		<div class="pointer-events-none absolute inset-x-0 top-0 z-[2] px-[1.1rem] pt-[1.1rem] min-[821px]:hidden">
			<div class="mx-auto flex w-full max-w-[680px] items-center">
				<button
					class={`${iconButtonClass} pointer-events-auto bg-surface-1/88 backdrop-blur-sm`}
					type="button"
					onclick={toggleSidebar}
					aria-label={sidebarOpen ? 'Toggle sidebar' : 'Show sidebar'}
					aria-expanded={sidebarOpen}
				>
					<ListIcon size={18} />
				</button>
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
					<div class="mb-4 grid w-full gap-[0.35rem] border border-line bg-surface-1 p-[1.15rem] text-muted">
						<strong class="truncate text-fg">{selectedThreadLabel}</strong>
						<span>loading chat...</span>
					</div>
				{:else}
					{#each renderedConversationEntries as entry (entry.item.id)}
						{#if entry.item.type === 'userMessage'}
							<ChatMessage role="user" content={renderUserText(entry.item)} />
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
							<ToolActivity item={entry.item} projectsRoot={status?.projectsRoot ?? ''} />
						{/if}
					{/each}

					{#if activeQuestionRequests.length > 0}
						<div class="grid gap-3">
							{#each activeQuestionRequests as request (request.requestId)}
								<ServerRequestPanel
									{request}
									inline
									resolving={resolvingRequestId === request.requestId}
									onresolve={(payload) => resolvePendingRequest(request.threadId, request.requestId, payload)}
								/>
							{/each}
						</div>
					{/if}
				{/if}
			</div>
		</section>

		<footer class="relative z-[1] bg-transparent px-[1.1rem] pt-4 pb-4">
			<div class="pointer-events-none absolute inset-x-0 top-0 h-20 bg-[linear-gradient(180deg,rgba(9,10,12,0),rgba(9,10,12,0.56)_42%,rgba(9,10,12,0.92)_100%)] backdrop-blur-[10px]"></div>
			<div class="relative mx-auto w-full max-w-[680px]">
				{#if activeFooterRequests.length > 0}
					<div class="mb-3 grid gap-3">
						{#each activeFooterRequests as request (request.requestId)}
							<ServerRequestPanel
								{request}
								resolving={resolvingRequestId === request.requestId}
								onresolve={(payload) => resolvePendingRequest(request.threadId, request.requestId, payload)}
							/>
						{/each}
					</div>
				{/if}

				<PromptInput
					bind:value={composer}
					bind:selectedModel
					bind:selectedEffort
					bind:selectedMode
					bind:selectedPermissionPreset
					{models}
					placeholder="enter your message"
					disabled={!selectedProjectPath}
					isStreaming={activeTurnId !== null}
					canInterrupt={canInterruptActiveTurn}
					isInterrupting={interruptingTurn}
					onsubmit={sendMessage}
					oninterrupt={interruptActiveTurn}
				/>
			</div>
		</footer>
	</main>
</div>
