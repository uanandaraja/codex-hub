<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import type { PageData } from './$types';
	import type {
		CodexThread,
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

	let status = $state<GatewayStatus | null>(initialStatus);
	let projects = $state<ProjectSummary[]>(initialProjects);
	let threads = $state<CodexThread[]>(initialThreads);
	let threadDetails = $state<Record<string, CodexThread>>({});
	let selectedProjectPath = $state<string | null>(initialProjectPath);
	let selectedThreadId = $state<string | null>(resolveInitialThreadId(initialThreads));
	let creatingThread = $state(false);
	let refreshingWorkspace = $state(false);
	let banner = $state<string | null>(initialBanner);
	let composer = $state('');
	let activeTurnId = $state<string | null>(null);
	let liveAgentText = $state('');
	let conversationBody = $state<HTMLElement | null>(null);

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
		if (selectedThreadId) {
			void ensureThreadReady(selectedThreadId);
			return;
		}

		if (selectedProjectPath) {
			void loadProjectThreads(selectedProjectPath);
		}
	});

	$effect(() => {
		void conversationItems;
		void liveAgentText;
		void activeTurnId;
		void scrollConversationToBottom();
	});

	$effect(() => {
		if (!selectedThreadId) {
			return;
		}

		const source = new EventSource(`/api/threads/${encodeURIComponent(selectedThreadId)}/events`);
		const onRpc = (event: Event) => {
			const message = event as MessageEvent<string>;
			handleNotification(JSON.parse(message.data) as RpcNotification);
		};

		source.addEventListener('rpc', onRpc);

		return () => {
			source.removeEventListener('rpc', onRpc);
			source.close();
		};
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

			await loadProjectThreads(nextProjectPath, nextProjectPath === selectedProjectPath ? selectedThreadId : null);
			banner = null;
		} catch (error) {
			banner = error instanceof Error ? error.message : 'Failed to refresh workspace.';
		} finally {
			refreshingWorkspace = false;
		}
	}

	async function ensureThreadReady(threadId: string): Promise<void> {
		selectedThreadId = threadId;
		try {
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

	async function sendMessage(): Promise<void> {
		const message = composer.trim();
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
		liveAgentText = '';
		activeTurnId = 'pending';

		try {
			const knownThread = threadDetails[threadId] ?? null;
			const generatedName = shouldAutoNameThread(knownThread) ? generateThreadName(message) : null;

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
			liveAgentText = '';
			return;
		}

		if (notification.method === 'item/agentMessage/delta') {
			liveAgentText = `${liveAgentText}${readString(notification.params?.delta) ?? ''}`;
			return;
		}

		if (notification.method === 'turn/completed') {
			activeTurnId = null;
			liveAgentText = '';
			void fetchThread(threadId);
			void refreshThreads();
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
			return null;
		}

		return readString(turn.id);
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

	function formatTimestamp(seconds: number): string {
		return new Date(seconds * 1000).toLocaleString([], {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
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

	function renderFileChanges(item: CodexThreadItem): string {
		if (!isFileChangeItem(item)) {
			return '';
		}

		return item.changes.map((change: { path: string }) => change.path).join('\n');
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

	async function scrollConversationToBottom(): Promise<void> {
		await tick();
		conversationBody?.scrollTo({ top: conversationBody.scrollHeight });
	}
</script>

<svelte:head>
	<title>Codex Hub</title>
	<meta name="description" content="Tailnet-hosted coding workspace." />
</svelte:head>

<div class="shell">
	<aside class="sidebar">
		<div class="sidebar-head">
			<div>
				<p class="kicker">Codex Hub</p>
				<h1>Projects</h1>
			</div>
			<button class="ghost" type="button" onclick={() => void refreshWorkspace()}>
				{refreshingWorkspace ? 'syncing' : 'sync'}
			</button>
		</div>

		{#if banner}
			<div class="notice">{banner}</div>
		{/if}

		<div class="project-list">
			{#each projects as project (project.path)}
				<section class="project-block">
					<button
						type="button"
						class:selected={project.path === selectedProjectPath}
						class="project-row"
						onclick={() => void selectProject(project.path)}
					>
						<span class="project-name">{project.name}</span>
						<span class="project-count">{projectChatCount(project.path)}</span>
					</button>

					{#if project.path === selectedProjectPath}
						<div class="chat-list">
							<button
								type="button"
								class="chat-row chat-row-new"
								onclick={() => void createThread(project.path)}
								disabled={creatingThread}
							>
								<span>{creatingThread ? 'starting…' : '+ new chat'}</span>
							</button>

							{#if projectThreads.length === 0}
								<div class="chat-empty">no chats yet</div>
							{:else}
								{#each projectThreads as thread (thread.id)}
									<button
										type="button"
										class:selected={thread.id === selectedThreadId}
										class="chat-row"
										onclick={() => void ensureThreadReady(thread.id)}
									>
										<strong>{chatLabel(thread)}</strong>
										<span>{chatPreview(thread)}</span>
									</button>
								{/each}
							{/if}
						</div>
					{/if}
				</section>
			{:else}
				<div class="sidebar-empty">
					<strong>no projects yet</strong>
					<span>projects appear once they have codex chats</span>
				</div>
			{/each}
		</div>
	</aside>

	<main class="workspace">
		<header class="workspace-head">
			<div>
				<p class="kicker">{currentProject?.name ?? 'No project'}</p>
				<h2>{currentThread ? chatLabel(currentThread) : 'New chat'}</h2>
			</div>
			<div class="workspace-actions">
				<span class:online={status?.state === 'ready'} class="status-dot"></span>
				<button class="ghost" type="button" onclick={() => void createThread(selectedProjectPath)} disabled={!selectedProjectPath || creatingThread}>
					new chat
				</button>
			</div>
		</header>

		<section class="conversation" bind:this={conversationBody}>
			{#if !selectedProjectPath}
				<div class="empty-state">
					<strong>no projects yet</strong>
					<span>projects appear once they have codex chats.</span>
				</div>
			{:else if !selectedThreadId && !creatingThread}
				<div class="empty-state">
					<strong>{currentProject?.name ?? 'project'}</strong>
					<span>Start a chat for this repo.</span>
				</div>
			{:else}
				{#each conversationItems as item (item.id)}
					{#if item.type === 'userMessage'}
						<article class="message message-user">
							<pre class="message-body">{renderUserText(item)}</pre>
						</article>
					{:else if item.type === 'agentMessage'}
						<article class="message message-agent">
							<pre class="message-body">{item.text}</pre>
						</article>
					{:else if item.type === 'commandExecution'}
						<article class="tool-block">
							<div class="tool-head">
								<span>command</span>
								<span>{item.status}</span>
							</div>
							<code>{item.command}</code>
						</article>
					{:else if item.type === 'fileChange'}
						<article class="tool-block">
							<div class="tool-head">
								<span>files</span>
								<span>{item.status}</span>
							</div>
							<pre>{renderFileChanges(item)}</pre>
						</article>
					{:else if item.type === 'plan'}
						<article class="tool-block subtle">
							<div class="tool-head">
								<span>plan</span>
							</div>
							<pre>{item.text}</pre>
						</article>
					{/if}
				{/each}

				{#if liveAgentText}
					<article class="message message-agent live">
						<pre class="message-body">{liveAgentText}</pre>
					</article>
				{/if}
			{/if}
		</section>

		<footer class="composer">
			<div class="composer-meta">
				<span>{currentProject ? shortPath(currentProject.path) : 'select a project'}</span>
				{#if currentThread}
					<span>{formatTimestamp(currentThread.updatedAt)}</span>
				{/if}
			</div>

			<div class="composer-row">
				<textarea
					bind:value={composer}
					rows="4"
					placeholder={selectedProjectPath ? `message ${currentProject?.name ?? 'project'}` : 'select a project'}
					disabled={!selectedProjectPath || activeTurnId !== null}
				></textarea>

				<div class="composer-side">
					{#if activeTurnId}
						<span class="streaming">streaming</span>
					{/if}
					<button
						type="button"
						onclick={() => void sendMessage()}
						disabled={!selectedProjectPath || !composer.trim() || activeTurnId !== null}
					>
						send
					</button>
				</div>
			</div>
		</footer>
	</main>
</div>

<style>
	.shell {
		display: grid;
		grid-template-columns: 21rem minmax(0, 1fr);
		height: 100dvh;
		max-height: 100dvh;
		overflow: hidden;
	}

	.sidebar {
		border-right: 1px solid var(--line);
		background: var(--surface-1);
		padding: 1.1rem 0;
		min-height: 0;
		overflow-y: auto;
		overflow-x: hidden;
	}

	.sidebar-head,
	.workspace-head,
	.composer {
		padding: 0 1.1rem;
	}

	.sidebar-head,
	.workspace-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		min-width: 0;
	}

	.sidebar-head > div,
	.workspace-head > div {
		min-width: 0;
	}

	.kicker {
		margin: 0 0 0.35rem;
		color: var(--text-muted);
		font-size: 0.72rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h1,
	h2,
	p {
		margin: 0;
	}

	h1,
	h2 {
		font-size: 1rem;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	.notice {
		margin: 1rem 1.1rem 0;
		padding: 0.85rem;
		border: 1px solid rgba(255, 124, 96, 0.24);
		background: rgba(255, 124, 96, 0.08);
		color: #ff9b85;
		font-size: 0.82rem;
	}

	.project-list {
		margin-top: 1rem;
	}

	.project-block + .project-block {
		border-top: 1px solid var(--line);
	}

	.project-row,
	.chat-row {
		display: flex;
		width: 100%;
		min-width: 0;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		border: 0;
		border-left: 2px solid transparent;
		background: transparent;
		color: var(--text);
		cursor: pointer;
		text-align: left;
	}

	.project-row {
		padding: 0.95rem 1.1rem;
		font-family: 'Space Grotesk', sans-serif;
	}

	.project-row.selected,
	.chat-row.selected {
		border-left-color: var(--accent);
		background: var(--surface-2);
	}

	.project-name,
	.project-count,
	.chat-row span,
	.chat-empty {
		font-family: 'IBM Plex Mono', monospace;
		font-size: 0.78rem;
	}

	.project-name {
		min-width: 0;
		flex: 1 1 auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.project-count,
	.chat-row span,
	.chat-empty {
		color: var(--text-muted);
	}

	.chat-list {
		padding-bottom: 0.5rem;
	}

	.chat-row {
		display: grid;
		grid-template-columns: 1fr;
		padding: 0.75rem 1.1rem 0.75rem 1.85rem;
	}

	.chat-row strong {
		font-weight: 500;
		font-size: 0.85rem;
	}

	.chat-row strong,
	.chat-row span {
		display: block;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chat-row-new {
		color: var(--accent);
	}

	.chat-empty {
		padding: 0.75rem 1.1rem 0.75rem 1.85rem;
	}

	.sidebar-empty {
		display: grid;
		gap: 0.35rem;
		padding: 1rem 1.1rem;
		color: var(--text-muted);
		font-family: 'IBM Plex Mono', monospace;
		font-size: 0.78rem;
		border-top: 1px solid var(--line);
	}

	.workspace {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		min-height: 0;
		min-width: 0;
		overflow: hidden;
		background: var(--surface-0);
	}

	.workspace-head {
		height: 4.75rem;
		border-bottom: 1px solid var(--line);
	}

	.workspace-actions {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		flex: 0 0 auto;
	}

	.status-dot {
		width: 0.6rem;
		height: 0.6rem;
		background: #525866;
	}

	.status-dot.online {
		background: #78e08f;
	}

	.conversation {
		min-height: 0;
		overflow-y: auto;
		overflow-x: hidden;
		padding: 1.35rem 1.1rem 2rem;
	}

	.message,
	.tool-block,
	.empty-state {
		width: min(100%, 58rem);
		min-width: 0;
		max-width: 58rem;
		border: 1px solid var(--line);
		margin-bottom: 1rem;
	}

	.message {
		padding: 1rem 1.1rem;
	}

	.message-user {
		margin-left: auto;
		background: rgba(137, 180, 250, 0.08);
	}

	.message-agent {
		background: var(--surface-1);
	}

	.message-body,
	.tool-block pre {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		word-break: break-word;
		line-height: 1.6;
	}

	.message-body {
		display: block;
	}

	.tool-block {
		background: #0b0d11;
	}

	.tool-head {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		min-width: 0;
		padding: 0.7rem 0.9rem;
		border-bottom: 1px solid var(--line);
		color: var(--text-muted);
		font-family: 'IBM Plex Mono', monospace;
		font-size: 0.72rem;
		text-transform: lowercase;
	}

	.tool-block code,
	.tool-block pre {
		display: block;
		padding: 0.9rem;
		font-family: 'IBM Plex Mono', monospace;
		font-size: 0.82rem;
	}

	.tool-block code {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	.tool-block.subtle {
		background: var(--surface-1);
	}

	.live {
		border-color: rgba(137, 180, 250, 0.3);
	}

	.empty-state {
		display: grid;
		gap: 0.4rem;
		padding: 1.15rem;
		color: var(--text-muted);
	}

	.composer {
		position: relative;
		z-index: 1;
		border-top: 1px solid var(--line);
		padding-top: 0.9rem;
		padding-bottom: 1rem;
		background: linear-gradient(180deg, rgba(13, 14, 18, 0), rgba(13, 14, 18, 0.94) 18%);
	}

	.composer-meta {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		min-width: 0;
		margin-bottom: 0.7rem;
		color: var(--text-muted);
		font-family: 'IBM Plex Mono', monospace;
		font-size: 0.72rem;
	}

	.composer-meta span {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.composer-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.75rem;
		align-items: start;
		min-width: 0;
	}

	textarea {
		width: 100%;
		min-height: 7rem;
		max-height: 14rem;
		border: 1px solid var(--line);
		background: var(--surface-1);
		color: var(--text);
		padding: 1rem;
		resize: none;
		overflow: auto;
		outline: none;
	}

	textarea::placeholder {
		color: var(--text-muted);
	}

	.composer-side {
		display: grid;
		gap: 0.65rem;
		justify-items: end;
	}

	button {
		border: 1px solid var(--line);
		background: var(--surface-1);
		color: var(--text);
		padding: 0.75rem 0.95rem;
		cursor: pointer;
		transition:
			background 120ms ease,
			border-color 120ms ease,
			color 120ms ease;
	}

	button:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
	}

	button:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.ghost {
		background: transparent;
	}

	.streaming {
		color: var(--accent);
		font-family: 'IBM Plex Mono', monospace;
		font-size: 0.72rem;
	}

	@media (max-width: 980px) {
		.shell {
			grid-template-columns: 18rem minmax(0, 1fr);
		}
	}

	@media (max-width: 820px) {
		.shell {
			grid-template-columns: 1fr;
			height: 100dvh;
		}

		.sidebar {
			border-right: 0;
			border-bottom: 1px solid var(--line);
		}
	}
</style>
