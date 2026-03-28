<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { ArrowsClockwiseIcon, ListIcon, PlusIcon } from 'phosphor-svelte';
	import ChatMessage from '$lib/components/ChatMessage.svelte';
	import PromptInput from '$lib/components/PromptInput.svelte';
	import type { PageData } from './$types';
	import type {
		CodexThread,
		CodexTurn,
		CodexThreadItem,
		GatewayStatus,
		ProjectSummary,
		RpcNotification,
		ThreadReadResponse,
		ThreadStartResponse
	} from '$lib/types';

	let { data } = $props<{ data: PageData }>();

	const initialStatus = untrack(() => data.status);
	const initialProjects = untrack(() => sortProjects(data.projects));
	const initialThreads = untrack(() => sortThreads(data.threads));
	const initialBanner = untrack(
		() => data.errors.status ?? data.errors.projects ?? data.errors.threads ?? null
	);
	const initialProjectPath = untrack(() => data.initialProjectPath ?? initialProjects[0]?.path ?? null);
	const initialThreadId = untrack(() => data.initialThreadId ?? resolveInitialThreadId(initialThreads));
	const initialDetailedThread = untrack(() => data.initialThread ?? null);

	let status = $state<GatewayStatus | null>(initialStatus);
	let projects = $state<ProjectSummary[]>(initialProjects);
	let threads = $state<CodexThread[]>(initialThreads);
	let threadDetails = $state<Record<string, CodexThread>>(
		initialDetailedThread ? { [initialDetailedThread.id]: initialDetailedThread } : {}
	);
	let selectedProjectPath = $state<string | null>(initialProjectPath);
	let selectedThreadId = $state<string | null>(initialThreadId);
	let creatingThread = $state(false);
	let refreshingWorkspace = $state(false);
	let banner = $state<string | null>(initialBanner);
	let composer = $state('');
	let activeTurnId = $state<string | null>(null);
	let conversationBody = $state<HTMLElement | null>(null);
	let sidebarOpen = $state(false);
	let isDesktopViewport = false;
	let hasMounted = false;
	let optimisticTurnCounter = 0;
	let eventSource = $state<EventSource | null>(null);
	let subscribedThreadId = $state<string | null>(null);
	let threadEventsReady = $state<Promise<void> | null>(null);

	const iconButtonClass =
		'inline-flex h-11 w-11 items-center justify-center border border-line bg-transparent text-fg transition-[background,border-color,color] duration-150 hover:border-accent hover:text-accent disabled:cursor-default disabled:opacity-[0.45]';
	const projectRowClass =
		'flex w-full min-w-0 items-center justify-between gap-3 border-0 border-l-2 border-l-transparent bg-transparent px-[1.1rem] py-[0.95rem] text-left text-fg';
	const chatRowClass =
		'grid w-full min-w-0 grid-cols-1 border-0 border-l-2 border-l-transparent bg-transparent px-[1.1rem] py-3 pl-[1.85rem] text-left text-fg';
	const activityRowClass =
		'mb-3 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-[14px] leading-[1.6] text-muted';
	const commandRowClass =
		'mb-3 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-[12px] leading-[1.6] text-muted';

	const currentProject = $derived.by<ProjectSummary | null>(
		() => projects.find((project) => project.path === selectedProjectPath) ?? null
	);

	const projectThreads = $derived.by<CodexThread[]>(() => sortThreads(threads));

	const currentThread = $derived.by<CodexThread | null>(() => {
		if (!selectedThreadId) {
			return null;
		}

		return threadDetails[selectedThreadId] ?? threads.find((thread) => thread.id === selectedThreadId) ?? null;
	});

	const conversationItems = $derived.by<CodexThreadItem[]>(() =>
		currentThread ? currentThread.turns.flatMap((turn) => turn.items) : []
	);

	const renderedConversationItems = $derived.by<CodexThreadItem[]>(() => conversationItems);

	$effect(() => {
		if (!selectedProjectPath && projects[0]) {
			selectedProjectPath = projects[0].path;
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

	onMount(() => {
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

		return () => {
			mediaQuery.removeEventListener('change', handleViewportChange);
			closeThreadEvents();
		};
	});

	$effect(() => {
		void renderedConversationItems;
		void scrollConversationToBottom();
	});

	$effect(() => {
		if (!hasMounted) {
			return;
		}

		syncUrlState();
	});

	$effect(() => {
		if (selectedThreadId || !hasMounted) {
			return;
		}

		closeThreadEvents();
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
			const [nextStatus, nextProjectsResult] = await Promise.all([
				api<GatewayStatus>('/api/status'),
				api<{ data: ProjectSummary[] }>('/api/projects')
			]);

			status = nextStatus;
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
			await fetchThread(threadId);
			banner = null;
		} catch (error) {
			banner = error instanceof Error ? error.message : 'Failed to open chat.';
		}
	}

	async function fetchThread(threadId: string): Promise<void> {
		const result = await api<ThreadReadResponse>(
			`/api/threads/${encodeURIComponent(threadId)}?includeTurns=true`
		);
		threadDetails[threadId] = result.thread;
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
			const generatedName = firstMessage ? generateThreadName(firstMessage) : null;
			const result = await api<ThreadStartResponse>('/api/threads', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					cwd: projectPath,
					name: generatedName
				})
			});

			threads = sortThreads([result.thread, ...threads.filter((thread) => thread.id !== result.thread.id)]);
			threadDetails[result.thread.id] = result.thread;
			selectedProjectPath = projectPath;
			selectedThreadId = result.thread.id;
			projects = insertProjectSummary(projects, projectPath, result.thread);
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
		const knownThread = threadDetails[threadId] ?? null;
		const generatedName = shouldAutoNameThread(knownThread) ? generateThreadName(message) : null;
		const optimisticState = applyOptimisticUserTurn(threadId, message);

		try {
			await api(`/api/threads/${encodeURIComponent(threadId)}/turns`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({ message })
			});

			if (generatedName) {
				void setThreadName(threadId, generatedName).catch(() => {});
			}

			await refreshThreads();
		} catch (error) {
			restoreOptimisticUserTurn(threadId, optimisticState);
			composer = message;
			activeTurnId = null;
			banner = error instanceof Error ? error.message : 'Failed to send message.';
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

	function handleNotification(notification: RpcNotification): void {
		const threadId = readThreadId(notification);
		if (!threadId || threadId !== selectedThreadId) {
			return;
		}

		if (notification.method === 'turn/started') {
			activeTurnId = readTurnId(notification.params) ?? 'pending';
			ensureStreamingAssistantMessage(threadId);
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
			void finalizeTurn(threadId);
			return;
		}
	}

	async function finalizeTurn(threadId: string): Promise<void> {
		try {
			await Promise.all([fetchThread(threadId), refreshThreads()]);
		} catch (error) {
			banner = error instanceof Error ? error.message : 'Failed to finalize chat.';
		} finally {
			activeTurnId = null;
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

	function resolveInitialThreadId(initialThreadsList: CodexThread[]): string | null {
		return initialThreadsList[0]?.id ?? null;
	}

	async function setThreadName(threadId: string, name: string): Promise<void> {
		await api(`/api/threads/${encodeURIComponent(threadId)}/name`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json'
			},
			body: JSON.stringify({ name })
		});

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

	function shouldAutoNameThread(thread: CodexThread | null): boolean {
		if (!thread || thread.name) {
			return false;
		}

		return thread.turns.length === 0 || !thread.turns.some((turn) => hasUserMessage(turn.items));
	}

	function hasUserMessage(items: CodexThreadItem[]): boolean {
		return items.some((item) => item.type === 'userMessage');
	}

	function generateThreadName(message: string): string | null {
		const normalized = message
			.replace(/```[\s\S]*?```/g, ' ')
			.replace(/`([^`]+)`/g, '$1')
			.replace(/\[(.*?)\]\((.*?)\)/g, '$1')
			.replace(/\s+/g, ' ')
			.trim();

		if (!normalized) {
			return null;
		}

		const firstClause = normalized.split(/[.!?](?:\s|$)/, 1)[0]?.trim() ?? normalized;
		const candidate = firstClause || normalized;
		if (candidate.length <= 72) {
			return candidate;
		}

		const clipped = candidate.slice(0, 69).trimEnd();
		return clipped ? `${clipped}...` : null;
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

	function summarizeCommand(item: Extract<CodexThreadItem, { type: 'commandExecution' }>): string {
		if (item.status === 'in_progress' || item.status === 'running' || item.status === 'pending') {
			return 'Running';
		}

		if (item.status === 'failed' || (item.exitCode !== null && item.exitCode !== 0)) {
			return 'Failed';
		}

		return 'Ran';
	}

	function summarizeFileChange(item: Extract<CodexThreadItem, { type: 'fileChange' }>): string {
		if (item.changes.length === 0) {
			return 'files';
		}

		if (item.changes.length === 1) {
			const [change] = item.changes;
			if (change.kind.type === 'update' && change.kind.move_path) {
				return `${shortPath(change.path)} to ${shortPath(change.kind.move_path)}`;
			}

			return shortPath(change.path);
		}

		const preview = item.changes
			.slice(0, 2)
			.map((change) => shortPath(change.path))
			.join(', ');
		const remaining = item.changes.length - 2;

		return remaining > 0 ? `${preview} +${remaining}` : preview;
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

	function ensureStreamingAssistantMessage(threadId: string): void {
		const thread = threadDetails[threadId];
		const lastTurn = thread?.turns.at(-1);
		if (!thread || !lastTurn) {
			return;
		}

		const items = [...lastTurn.items];
		const lastItem = items.at(-1);
		if (lastItem?.type === 'agentMessage') {
			items[items.length - 1] = {
				...lastItem,
				phase: 'streaming'
			};
		} else {
			items.push(createStreamingAgentMessage(lastTurn.id));
		}

		const turns = [...thread.turns];
		turns[turns.length - 1] = {
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

	function summarizeFileChangeAction(item: Extract<CodexThreadItem, { type: 'fileChange' }>): string {
		if (item.changes.length !== 1) {
			return 'Changed';
		}

		const [change] = item.changes;
		if (change.kind.type === 'update' && change.kind.move_path) {
			return 'Moved';
		}

		if (change.kind.type === 'add') {
			return 'Added';
		}

		if (change.kind.type === 'delete') {
			return 'Deleted';
		}

		return 'Updated';
	}

	function summarizePlan(text: string): string {
		const firstLine =
			text
				.split('\n')
				.map((line) => line.trim())
				.find(Boolean) ?? 'Next steps';

		return firstLine.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '');
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
							<span class="min-w-0 flex-1 truncate font-sans">{project.name}</span>
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
				{:else}
					{#each renderedConversationItems as item (item.id)}
						{#if item.type === 'userMessage'}
							<ChatMessage role="user" content={renderUserText(item)} />
						{:else if isAgentMessageRenderItem(item)}
							<ChatMessage
								role="assistant"
								content={item.text}
								streaming={activeTurnId !== null && item.phase === 'streaming'}
							/>
						{:else if isCommandExecutionItem(item)}
							<p class={commandRowClass}>
								<span class="shrink-0">{summarizeCommand(item)}</span>
								<code class="min-w-0 break-words font-mono text-[12px] text-fg [overflow-wrap:anywhere]">
									{item.command}
								</code>
							</p>
						{:else if isFileChangeItem(item)}
							<p class={activityRowClass}>
								<span class="shrink-0">{summarizeFileChangeAction(item)}</span>
								<span class="min-w-0 break-words text-fg">{summarizeFileChange(item)}</span>
							</p>
						{:else if isPlanItem(item)}
							<p class={activityRowClass}>
								<span class="shrink-0">Planned</span>
								<span class="min-w-0 break-words text-fg">{summarizePlan(item.text)}</span>
							</p>
						{/if}
					{/each}
				{/if}
			</div>
		</section>

		<footer class="relative z-[1] border-t border-line bg-[linear-gradient(180deg,rgba(13,14,18,0),rgba(13,14,18,0.94)_18%)] px-[1.1rem] pt-[0.9rem] pb-4">
			<div class="mx-auto w-full max-w-[680px]">
				<PromptInput
					bind:value={composer}
					placeholder="enter your message"
					disabled={!selectedProjectPath}
					isStreaming={activeTurnId !== null}
					onsubmit={sendMessage}
				/>
			</div>
		</footer>
	</main>
</div>
