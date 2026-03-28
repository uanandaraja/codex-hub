import { Buffer } from 'node:buffer';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { URL } from 'node:url';
import { CodexAppServerBridge, JsonRpcError } from './codex-app-server';
import type {
	ApprovalPolicy,
	AppServerNotification,
	CodexThread,
	CodexThreadListResponse,
	DirectoryEntry,
	DirectoryListingResponse,
	FileContentsResponse,
	GatewayConfig,
	ModelListResponse,
	PendingServerRequest,
	ProjectSummary,
	SandboxMode,
	ThreadReadResponse,
	ThreadNameGenerateResponse,
	ThreadUsageResponse,
	TurnContextUsage
} from './types';

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '127.0.0.1';
const THREAD_PAGE_SIZE = 200;
const EMPTY_THREAD_USAGE: ThreadUsageResponse = { turns: {} };

const config: GatewayConfig = {
	port: Number.parseInt(process.env.PORT ?? `${DEFAULT_PORT}`, 10),
	host: process.env.HOST ?? DEFAULT_HOST,
	codexBin: process.env.CODEX_BIN ?? 'codex',
	defaultCwd: process.env.DEFAULT_THREAD_CWD ?? resolve(import.meta.dirname, '..', '..', '..'),
	projectsRoot: process.env.PROJECTS_ROOT ?? join(homedir(), 'Dev'),
	defaultApprovalPolicy: parseApprovalPolicy(process.env.DEFAULT_APPROVAL_POLICY),
	defaultSandboxMode: parseSandboxMode(process.env.DEFAULT_SANDBOX_MODE),
	autoApproveServerRequests: parseBoolean(process.env.AUTO_APPROVE_SERVER_REQUESTS)
};

const bridge = new CodexAppServerBridge(config);
const threadUsageCache = new Map<string, { modifiedAtMs: number; usage: ThreadUsageResponse }>();

const server = createServer((request, response) => {
	void handleRequest(request, response);
});

server.listen(config.port, config.host, () => {
	console.log(`gateway listening on http://${config.host}:${config.port}`);
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

void bridge.ensureReady().catch(() => {
	// keep the process up; the status endpoint exposes the startup failure and later requests can retry
});

async function shutdown(): Promise<void> {
	server.close();
	await bridge.stop();
	process.exit(0);
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
	const method = request.method ?? 'GET';
	const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${config.host}:${config.port}`}`);
	const pathname = url.pathname;

	try {
		if (method === 'GET' && pathname === '/healthz') {
			return sendJson(response, 200, { ok: true, status: bridge.getStatus() });
		}

		if (method === 'GET' && pathname === '/readyz') {
			const ready = bridge.getStatus().state === 'ready';
			return sendJson(response, ready ? 200 : 503, { ready, status: bridge.getStatus() });
		}

		if (method === 'GET' && pathname === '/v1/status') {
			return sendJson(response, 200, bridge.getStatus());
		}

		if (method === 'GET' && pathname === '/v1/projects') {
			await bridge.ensureReady();
			const result = collectProjects(
				await listAllThreads({
					archived: readOptionalBoolean(url.searchParams.get('archived')),
					searchTerm: url.searchParams.get('searchTerm')
				})
			);

			return sendJson(response, 200, {
				root: config.projectsRoot,
				data: result
			});
		}

		if (method === 'GET' && pathname === '/v1/models') {
			await bridge.ensureReady();
			return sendJson(response, 200, await listAllModels());
		}

		if (method === 'GET' && pathname === '/v1/threads') {
			await bridge.ensureReady();
			const projectPath = readOptionalString(url.searchParams.get('projectPath'));
			if (projectPath) {
				const allThreads = sortThreads(
					(
						await listAllThreads({
							archived: readOptionalBoolean(url.searchParams.get('archived')),
							searchTerm: url.searchParams.get('searchTerm')
						})
					).filter((thread) => projectPathForThread(thread) === bridge.resolvePath(projectPath))
				);
				const offset = readOptionalNumber(url.searchParams.get('cursor')) ?? 0;
				const limit = readOptionalNumber(url.searchParams.get('limit')) ?? allThreads.length;
				const data = allThreads.slice(offset, offset + limit);
				const nextCursor = offset + limit < allThreads.length ? `${offset + limit}` : null;
				return sendJson(response, 200, { data, nextCursor });
			}

			const params = {
				limit: readOptionalNumber(url.searchParams.get('limit')),
				cursor: url.searchParams.get('cursor'),
				archived: readOptionalBoolean(url.searchParams.get('archived')),
				searchTerm: url.searchParams.get('searchTerm'),
				cwd: url.searchParams.get('cwd') ? bridge.resolvePath(url.searchParams.get('cwd')) : null
			};
			const data = await bridge.request<CodexThreadListResponse>('thread/list', params);
			return sendJson(response, 200, data);
		}

		if (method === 'POST' && pathname === '/v1/threads') {
			await bridge.ensureReady();
			const body = await readJsonBody(request);
			const cwd = bridge.resolvePath(readOptionalString(body.cwd));
			const payload = {
				cwd,
				model: readOptionalString(body.model),
				approvalPolicy: readOptionalString(body.approvalPolicy) ?? config.defaultApprovalPolicy,
				sandbox: readOptionalString(body.sandbox) ?? config.defaultSandboxMode,
				developerInstructions: readOptionalString(body.developerInstructions),
				experimentalRawEvents: false,
				persistExtendedHistory: true
			};
			const result = await bridge.request<Record<string, unknown>>('thread/start', payload);
			const name = readOptionalString(body.name);
			if (name && typeof result.thread === 'object' && result.thread && 'id' in result.thread) {
				await bridge.request('thread/name/set', { threadId: result.thread.id, name });
				(result.thread as Record<string, unknown>).name = name;
			}
			return sendJson(response, 201, result);
		}

		const threadEventsMatch = pathname.match(/^\/v1\/threads\/([^/]+)\/events$/);
		if (method === 'GET' && threadEventsMatch) {
			await bridge.ensureReady();
			const threadId = decodeURIComponent(threadEventsMatch[1]);
			return streamThreadEvents(request, response, threadId);
		}

		const threadTurnsMatch = pathname.match(/^\/v1\/threads\/([^/]+)\/turns$/);
		if (method === 'POST' && threadTurnsMatch) {
			await bridge.ensureReady();
			const body = await readJsonBody(request);
			const message = readOptionalString(body.message)?.trim();
			if (!message) {
				return sendJson(response, 400, { error: { message: 'message is required' } });
			}

			const threadId = decodeURIComponent(threadTurnsMatch[1]);
			const model = readOptionalString(body.model);
			const effort = readOptionalReasoningEffort(body.effort);
			const collaborationMode = buildCollaborationMode(readOptionalMode(body.mode), model, effort);
			const result = await bridge.request<Record<string, unknown>>('turn/start', {
				threadId,
				input: [
					{
						type: 'text',
						text: message,
						text_elements: []
					}
				],
				cwd: readOptionalString(body.cwd) ? bridge.resolvePath(readOptionalString(body.cwd)) : undefined,
				model: collaborationMode ? undefined : model,
				effort: collaborationMode ? undefined : effort,
				approvalPolicy: readOptionalString(body.approvalPolicy) ?? undefined,
				sandboxPolicy: buildSandboxPolicy(
					readOptionalString(body.sandbox) ?? config.defaultSandboxMode
				),
				collaborationMode
			});
			return sendJson(response, 202, result);
		}

		const threadServerRequestsMatch = pathname.match(/^\/v1\/threads\/([^/]+)\/server-requests$/);
		if (method === 'GET' && threadServerRequestsMatch) {
			await bridge.ensureReady();
			const threadId = decodeURIComponent(threadServerRequestsMatch[1]);
			return sendJson(response, 200, {
				data: bridge.listPendingServerRequests(threadId)
			});
		}

		const threadServerRequestResolveMatch = pathname.match(
			/^\/v1\/threads\/([^/]+)\/server-requests\/([^/]+)\/resolve$/
		);
		if (method === 'POST' && threadServerRequestResolveMatch) {
			await bridge.ensureReady();
			const threadId = decodeURIComponent(threadServerRequestResolveMatch[1]);
			const requestId = readRequestId(threadServerRequestResolveMatch[2]);
			if (requestId === null) {
				return sendJson(response, 400, { error: { message: 'requestId must be a number' } });
			}

			const body = await readJsonBody(request);
			bridge.resolveServerRequest(threadId, requestId, body);
			return sendJson(response, 200, { ok: true, threadId, requestId });
		}

		const threadInterruptMatch = pathname.match(/^\/v1\/threads\/([^/]+)\/interrupt$/);
		if (method === 'POST' && threadInterruptMatch) {
			await bridge.ensureReady();
			const body = await readJsonBody(request);
			const turnId = readOptionalString(body.turnId);
			if (!turnId) {
				return sendJson(response, 400, { error: { message: 'turnId is required' } });
			}

			const threadId = decodeURIComponent(threadInterruptMatch[1]);
			const result = await bridge.request<Record<string, unknown>>('turn/interrupt', {
				threadId,
				turnId
			});
			return sendJson(response, 200, result);
		}

		const threadNameMatch = pathname.match(/^\/v1\/threads\/([^/]+)\/name$/);
		if (method === 'POST' && threadNameMatch) {
			await bridge.ensureReady();
			const body = await readJsonBody(request);
			const name = readOptionalString(body.name);
			if (!name) {
				return sendJson(response, 400, { error: { message: 'name is required' } });
			}

			const threadId = decodeURIComponent(threadNameMatch[1]);
			await bridge.request('thread/name/set', { threadId, name });
			return sendJson(response, 200, { ok: true, threadId, name });
		}

		const threadGenerateNameMatch = pathname.match(/^\/v1\/threads\/([^/]+)\/generate-name$/);
		if (method === 'POST' && threadGenerateNameMatch) {
			await bridge.ensureReady();
			const threadId = decodeURIComponent(threadGenerateNameMatch[1]);
			return sendJson(response, 200, await generateThreadName(threadId));
		}

		const threadArchiveMatch = pathname.match(/^\/v1\/threads\/([^/]+)\/archive$/);
		if (method === 'POST' && threadArchiveMatch) {
			await bridge.ensureReady();
			const threadId = decodeURIComponent(threadArchiveMatch[1]);
			await bridge.request('thread/archive', { threadId });
			return sendJson(response, 200, { ok: true, threadId });
		}

		const threadUnarchiveMatch = pathname.match(/^\/v1\/threads\/([^/]+)\/unarchive$/);
		if (method === 'POST' && threadUnarchiveMatch) {
			await bridge.ensureReady();
			const threadId = decodeURIComponent(threadUnarchiveMatch[1]);
			await bridge.request('thread/unarchive', { threadId });
			return sendJson(response, 200, { ok: true, threadId });
		}

		const threadResumeMatch = pathname.match(/^\/v1\/threads\/([^/]+)\/resume$/);
		if (method === 'POST' && threadResumeMatch) {
			await bridge.ensureReady();
			const body = await readJsonBody(request);
			const threadId = decodeURIComponent(threadResumeMatch[1]);
			const result = await bridge.request<Record<string, unknown>>('thread/resume', {
				threadId,
				cwd: readOptionalString(body.cwd) ? bridge.resolvePath(readOptionalString(body.cwd)) : undefined,
				model: readOptionalString(body.model),
				approvalPolicy: readOptionalString(body.approvalPolicy) ?? config.defaultApprovalPolicy,
				sandbox: readOptionalString(body.sandbox) ?? config.defaultSandboxMode,
				persistExtendedHistory: true
			});
			return sendJson(response, 200, result);
		}

		const threadUsageMatch = pathname.match(/^\/v1\/threads\/([^/]+)\/usage$/);
		if (method === 'GET' && threadUsageMatch) {
			await bridge.ensureReady();
			const threadId = decodeURIComponent(threadUsageMatch[1]);
			const thread = await bridge.request<Record<string, unknown>>('thread/read', {
				threadId,
				includeTurns: false
			});
			return sendJson(response, 200, await readThreadUsageResponse(thread));
		}

		const threadMatch = pathname.match(/^\/v1\/threads\/([^/]+)$/);
		if (method === 'GET' && threadMatch) {
			await bridge.ensureReady();
			const threadId = decodeURIComponent(threadMatch[1]);
			const includeTurns = readOptionalBoolean(url.searchParams.get('includeTurns')) ?? true;
			const result = await bridge.request<Record<string, unknown> & { thread: CodexThread }>('thread/read', {
				threadId,
				includeTurns
			});
			return sendJson(response, 200, {
				...result,
				usage: await readThreadUsageResponse(result)
			} satisfies ThreadReadResponse);
		}

		if (method === 'GET' && pathname === '/v1/fs') {
			await bridge.ensureReady();
			const path = bridge.resolvePath(url.searchParams.get('path'));
			const metadata = await bridge.request<{
				isDirectory: boolean;
				isFile: boolean;
				modifiedAtMs: number;
			}>('fs/getMetadata', { path });

			if (metadata.isDirectory) {
				const result = await bridge.request<{ entries: DirectoryEntry[] }>('fs/readDirectory', { path });
				const listing: DirectoryListingResponse = {
					kind: 'directory',
					path,
					entries: result.entries
						.map((entry) => ({ ...entry, path: join(path, entry.fileName) }))
						.sort((left, right) => {
							if (left.isDirectory !== right.isDirectory) {
								return left.isDirectory ? -1 : 1;
							}

							return left.fileName.localeCompare(right.fileName);
						})
				};
				return sendJson(response, 200, listing);
			}

			if (metadata.isFile) {
				const result = await bridge.request<{ dataBase64: string }>('fs/readFile', { path });
				const bytes = Buffer.from(result.dataBase64, 'base64');
				let text: string | null = null;
				let isBinary = false;

				try {
					text = new TextDecoder('utf8', { fatal: true }).decode(bytes);
				} catch {
					isBinary = true;
				}

				const file: FileContentsResponse = {
					kind: 'file',
					path,
					text,
					isBinary,
					byteLength: bytes.byteLength,
					modifiedAtMs: metadata.modifiedAtMs
				};
				return sendJson(response, 200, file);
			}

			return sendJson(response, 404, { error: { message: `path not found: ${path}` } });
		}

		if (method === 'PUT' && pathname === '/v1/fs') {
			await bridge.ensureReady();
			const body = await readJsonBody(request);
			const path = bridge.resolvePath(readOptionalString(body.path));
			const text = readOptionalString(body.text);

			if (!path || text === null) {
				return sendJson(response, 400, { error: { message: 'path and text are required' } });
			}

			await bridge.request('fs/writeFile', {
				path,
				dataBase64: Buffer.from(text, 'utf8').toString('base64')
			});

			return sendJson(response, 200, { ok: true, path });
		}

		sendJson(response, 404, { error: { message: 'not found' } });
	} catch (error) {
		handleError(response, error);
	}
}

function streamThreadEvents(request: IncomingMessage, response: ServerResponse, threadId: string): void {
	response.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no'
	});

	writeSseEvent(response, 'ready', { threadId });
	const unsubscribe = bridge.subscribe(threadId, (notification: AppServerNotification) => {
		writeSseEvent(response, 'rpc', notification);
	});

	const heartbeat = setInterval(() => {
		response.write(': keepalive\n\n');
	}, 15_000);

	request.on('close', () => {
		clearInterval(heartbeat);
		unsubscribe();
		response.end();
	});
}

function writeSseEvent(response: ServerResponse, event: string, data: unknown): void {
	response.write(`event: ${event}\n`);
	response.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function listAllThreads(options: {
	archived?: boolean | null;
	searchTerm?: string | null;
}): Promise<CodexThread[]> {
	const threads: CodexThread[] = [];
	let cursor: string | null = null;

	do {
		const page: CodexThreadListResponse = await bridge.request<CodexThreadListResponse>('thread/list', {
			limit: THREAD_PAGE_SIZE,
			cursor,
			archived: options.archived ?? null,
			searchTerm: options.searchTerm ?? null,
			cwd: null
		});
		threads.push(...page.data);
		cursor = page.nextCursor;
	} while (cursor);

	return threads;
}

async function listAllModels(): Promise<ModelListResponse> {
	const models: ModelListResponse['data'] = [];
	let cursor: string | null = null;

	do {
		const page: ModelListResponse = await bridge.request<ModelListResponse>('model/list', {
			limit: THREAD_PAGE_SIZE,
			cursor,
			includeHidden: false
		});
		models.push(...page.data);
		cursor = page.nextCursor;
	} while (cursor);

	return { data: models, nextCursor: null };
}

function collectProjects(threadList: CodexThread[]): ProjectSummary[] {
	const map = new Map<string, ProjectSummary>();

	for (const thread of sortThreads(threadList)) {
		const path = projectPathForThread(thread);
		const current = map.get(path);
		if (current) {
			current.threadCount += 1;
			current.updatedAt = Math.max(current.updatedAt, thread.updatedAt);
			continue;
		}

		map.set(path, {
			name: projectNameFromPath(path),
			path,
			threadCount: 1,
			updatedAt: thread.updatedAt
		});
	}

	return sortProjects([...map.values()]);
}

function projectPathForThread(thread: CodexThread): string {
	const gitInfo = thread.gitInfo;
	if (gitInfo && typeof gitInfo === 'object') {
		for (const key of ['root', 'repoRoot', 'worktreeRoot', 'worktree_root', 'rootPath', 'path']) {
			const value = gitInfo[key];
			if (typeof value === 'string' && value.startsWith('/')) {
				return value;
			}
		}
	}

	return thread.cwd;
}

function projectNameFromPath(path: string): string {
	const segments = path.split('/').filter(Boolean);
	return segments.at(-1) ?? path;
}

function sortProjects(list: ProjectSummary[]): ProjectSummary[] {
	return [...list].sort((left, right) => {
		if (left.updatedAt !== right.updatedAt) {
			return right.updatedAt - left.updatedAt;
		}

		return left.name.localeCompare(right.name);
	});
}

function sortThreads(list: CodexThread[]): CodexThread[] {
	return [...list].sort((left, right) => right.updatedAt - left.updatedAt);
}

function handleError(response: ServerResponse, error: unknown): void {
	if (error instanceof JsonRpcError) {
		const status =
			error.code === -32602 || error.code === -32600 || error.code === -32601
				? 400
				: error.code === -32001
					? 503
					: 502;
		sendJson(response, status, { error: { message: error.message, code: error.code, data: error.data } });
		return;
	}

	sendJson(response, 500, { error: { message: error instanceof Error ? error.message : String(error) } });
}

function readErrorMessage(value: unknown): string {
	if (typeof value === 'string' && value.trim()) {
		return value.trim();
	}

	if (value && typeof value === 'object') {
		if ('message' in value && typeof value.message === 'string' && value.message.trim()) {
			return value.message.trim();
		}

		if ('error' in value) {
			return readErrorMessage(value.error);
		}
	}

	return 'Unknown error';
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}

	if (chunks.length === 0) {
		return {};
	}

	return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
	response.writeHead(statusCode, {
		'Content-Type': 'application/json; charset=utf-8'
	});
	response.end(JSON.stringify(body));
}

function readOptionalString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readOptionalNumber(value: unknown): number | null {
	if (typeof value !== 'string' || !value) {
		return null;
	}

	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? null : parsed;
}

function readOptionalBoolean(value: unknown): boolean | null {
	if (typeof value !== 'string') {
		return null;
	}

	if (value === 'true') {
		return true;
	}

	if (value === 'false') {
		return false;
	}

	return null;
}

function readOptionalReasoningEffort(
	value: unknown
): 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | null {
	switch (value) {
		case 'none':
		case 'minimal':
		case 'low':
		case 'medium':
		case 'high':
		case 'xhigh':
			return value;
		default:
			return null;
	}
}

function readOptionalMode(value: unknown): 'plan' | 'default' | null {
	if (value === 'plan') {
		return 'plan';
	}

	if (value === 'build' || value === 'default') {
		return 'default';
	}

	return null;
}

function buildCollaborationMode(
	mode: 'plan' | 'default' | null,
	model: string | null,
	effort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | null
): Record<string, unknown> | undefined {
	if (!mode || !model) {
		return undefined;
	}

	return {
		mode,
		settings: {
			model,
			reasoning_effort: effort
		}
	};
}

function buildSandboxPolicy(mode: string | null): Record<string, unknown> | undefined {
	switch (mode) {
		case 'read-only':
			return { type: 'readOnly' };
		case 'workspace-write':
			return { type: 'workspaceWrite' };
		case 'danger-full-access':
			return { type: 'dangerFullAccess' };
		default:
			return undefined;
	}
}

function readRequestId(value: string): number | null {
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? null : parsed;
}

async function readThreadUsageResponse(threadReadResult: Record<string, unknown>): Promise<ThreadUsageResponse> {
	const threadPath = readThreadSessionPath(threadReadResult);
	if (!threadPath) {
		return EMPTY_THREAD_USAGE;
	}

	const cached = await readCachedThreadUsage(threadPath);
	return cached;
}

async function generateThreadName(threadId: string): Promise<ThreadNameGenerateResponse> {
	const result = await bridge.request<Record<string, unknown> & { thread: CodexThread }>('thread/read', {
		threadId,
		includeTurns: true
	});
	const thread = result.thread;
	if (!thread) {
		throw new Error(`thread ${threadId} was not found`);
	}

	const existingName = readOptionalString(thread.name);
	if (existingName) {
		return {
			threadId,
			name: existingName,
			generated: false
		};
	}

	const context = extractThreadNamingContext(thread);
	const fallbackName = fallbackThreadName(thread);
	if (!context) {
		if (!fallbackName) {
			throw new Error('thread does not have enough content to generate a name');
		}

		await bridge.request('thread/name/set', { threadId, name: fallbackName });
		return {
			threadId,
			name: fallbackName,
			generated: false
		};
	}

	const generated = sanitizeGeneratedThreadName(
		await requestGeneratedThreadName(thread, context.userText, context.assistantText)
	);
	const finalName = generated ?? fallbackName;
	if (!finalName) {
		throw new Error('title generation returned an empty name');
	}

	await bridge.request('thread/name/set', { threadId, name: finalName });
	return {
		threadId,
		name: finalName,
		generated: generated !== null
	};
}

function extractThreadNamingContext(
	thread: CodexThread
): { userText: string; assistantText: string } | null {
	const firstTurn = thread.turns[0];
	if (!firstTurn) {
		return null;
	}

	const userText = firstTurn.items
		.filter((item) => item.type === 'userMessage')
		.flatMap((item) => readUserMessageTexts(item))
		.join('\n')
		.trim();
	const assistantText = firstTurn.items
		.filter((item) => item.type === 'agentMessage')
		.map((item) => readOptionalString(item.text))
		.filter((value): value is string => value !== null)
		.join('\n')
		.trim();

	if (!userText || !assistantText) {
		return null;
	}

	return {
		userText: userText.slice(0, 1_800),
		assistantText: assistantText.slice(0, 2_400)
	};
}

function readUserMessageTexts(item: CodexThread['turns'][number]['items'][number]): string[] {
	if (!('content' in item) || !Array.isArray(item.content)) {
		return [];
	}

	return item.content
		.map((entry) => {
			if (!entry || typeof entry !== 'object' || !('type' in entry) || entry.type !== 'text') {
				return null;
			}

			return readOptionalString(entry.text);
		})
		.filter((value): value is string => value !== null);
}

function fallbackThreadName(thread: CodexThread): string | null {
	const preview = readOptionalString(thread.preview);
	if (!preview) {
		return null;
	}

	const normalized = preview.replace(/\s+/g, ' ').trim();
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

function sanitizeGeneratedThreadName(value: string): string | null {
	const normalized = value
		.replace(/^["'`]+|["'`]+$/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (!normalized) {
		return null;
	}

	const singleLine = normalized.split('\n', 1)[0]?.trim() ?? normalized;
	const withoutLabel = singleLine.replace(/^title:\s*/i, '').trim();
	if (!withoutLabel) {
		return null;
	}

	if (withoutLabel.length <= 72) {
		return withoutLabel;
	}

	const clipped = withoutLabel.slice(0, 69).trimEnd();
	return clipped ? `${clipped}...` : null;
}

async function requestGeneratedThreadName(
	thread: CodexThread,
	userText: string,
	assistantText: string
): Promise<string> {
	const promptThread = await bridge.request<Record<string, unknown> & { thread: { id: string } }>(
		'thread/start',
		{
			cwd: thread.cwd,
			modelProvider: thread.modelProvider,
			approvalPolicy: 'never',
			sandbox: 'read-only',
			ephemeral: true,
			experimentalRawEvents: false,
			persistExtendedHistory: false
		}
	);
	const promptThreadId =
		typeof promptThread.thread === 'object' && promptThread.thread && 'id' in promptThread.thread
			? readOptionalString(promptThread.thread.id)
			: null;
	if (!promptThreadId) {
		throw new Error('failed to start ephemeral title-generation thread');
	}

	let finalMessage = '';
	const unsubscribe = bridge.subscribe(promptThreadId, (notification: AppServerNotification) => {
		if (notification.method === 'item/agentMessage/delta') {
			const delta = readOptionalString(notification.params?.delta);
			if (delta) {
				finalMessage = `${finalMessage}${delta}`;
			}
			return;
		}

		if (notification.method === 'item/completed') {
			const item = notification.params?.item;
			if (!isRecord(item) || item.type !== 'agentMessage') {
				return;
			}

			const text = readOptionalString(item.text);
			if (text) {
				finalMessage = text;
			}
		}
	});

	try {
		const completionPromise = waitForThreadTurnCompletion(promptThreadId);
		await bridge.request('turn/start', {
			threadId: promptThreadId,
			input: [
				{
					type: 'text',
					text:
						'Generate a concise title for this coding conversation.\n' +
						'Rules:\n' +
						'- Return only the title.\n' +
						'- 2 to 6 words.\n' +
						'- No quotes.\n' +
						'- No markdown.\n' +
						'- Reflect the main task clearly.\n\n' +
						`User request:\n${userText}\n\n` +
						`Assistant reply:\n${assistantText}`,
					text_elements: []
				}
			],
			approvalPolicy: 'never',
			sandboxPolicy: buildSandboxPolicy('read-only')
		});

		await completionPromise;
		return finalMessage;
	} finally {
		unsubscribe();
		await bridge.request('thread/unsubscribe', { threadId: promptThreadId }).catch(() => {});
	}
}

async function waitForThreadTurnCompletion(threadId: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			unsubscribe();
			reject(new Error('timed out waiting for title generation'));
		}, 60_000);

		const unsubscribe = bridge.subscribe(threadId, (notification: AppServerNotification) => {
			if (notification.method === 'error') {
				clearTimeout(timeout);
				unsubscribe();
				reject(new Error(readErrorMessage(notification.params?.error)));
				return;
			}

			if (notification.method === 'serverRequest/pending') {
				clearTimeout(timeout);
				unsubscribe();
				reject(new Error('title generation requested unexpected user input'));
				return;
			}

			if (notification.method !== 'turn/completed') {
				return;
			}

			clearTimeout(timeout);
			unsubscribe();
			resolve();
		});
	});
}

async function readCachedThreadUsage(threadPath: string): Promise<ThreadUsageResponse> {
	try {
		const metadata = await stat(threadPath);
		if (!metadata.isFile()) {
			threadUsageCache.delete(threadPath);
			return EMPTY_THREAD_USAGE;
		}

		const cached = threadUsageCache.get(threadPath);
		if (cached && cached.modifiedAtMs === metadata.mtimeMs) {
			return cached.usage;
		}

		const usage = await parseThreadUsage(threadPath);
		threadUsageCache.set(threadPath, {
			modifiedAtMs: metadata.mtimeMs,
			usage
		});
		return usage;
	} catch {
		threadUsageCache.delete(threadPath);
		return EMPTY_THREAD_USAGE;
	}
}

async function parseThreadUsage(threadPath: string): Promise<ThreadUsageResponse> {
	const turns: Record<string, TurnContextUsage> = {};
	const input = createReadStream(threadPath, { encoding: 'utf8' });
	const lines = createInterface({
		input,
		crlfDelay: Infinity
	});
	let activeTurnId: string | null = null;

	try {
		for await (const line of lines) {
			if (!line) {
				continue;
			}

			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				continue;
			}

			if (!isRecord(parsed) || parsed.type !== 'event_msg' || !isRecord(parsed.payload)) {
				continue;
			}

			const payload = parsed.payload;
			const eventType = readOptionalString(payload.type);
			if (!eventType) {
				continue;
			}

			if (eventType === 'task_started') {
				activeTurnId = readOptionalString(payload.turn_id);
				if (!activeTurnId) {
					continue;
				}

				const target = getOrCreateTurnUsage(turns, activeTurnId);
				const contextWindow = readOptionalFiniteNumber(payload.model_context_window);
				if (contextWindow !== null) {
					target.modelContextWindow = contextWindow;
				}
				continue;
			}

			if (eventType === 'task_complete') {
				activeTurnId = null;
				continue;
			}

			if (eventType !== 'token_count' || !activeTurnId) {
				continue;
			}

			const info = isRecord(payload.info) ? payload.info : null;
			if (!info) {
				continue;
			}

			const target = getOrCreateTurnUsage(turns, activeTurnId);
			const contextWindow = readOptionalFiniteNumber(info.model_context_window);
			if (contextWindow !== null) {
				target.modelContextWindow = contextWindow;
			}

			const lastTokenUsage = isRecord(info.last_token_usage) ? info.last_token_usage : null;
			const totalTokens = lastTokenUsage
				? readOptionalFiniteNumber(lastTokenUsage.total_tokens)
				: null;
			if (totalTokens !== null) {
				target.lastTokenUsageTotalTokens = totalTokens;
			}
		}
	} finally {
		lines.close();
		input.destroy();
	}

	for (const usage of Object.values(turns)) {
		usage.contextLeftPercent = computeContextLeftPercent(
			usage.lastTokenUsageTotalTokens,
			usage.modelContextWindow
		);
	}

	return { turns };
}

function getOrCreateTurnUsage(
	turns: Record<string, TurnContextUsage>,
	turnId: string
): TurnContextUsage {
	turns[turnId] ??= {
		lastTokenUsageTotalTokens: null,
		modelContextWindow: null,
		contextLeftPercent: null
	};
	return turns[turnId];
}

function computeContextLeftPercent(tokensUsed: number | null, contextWindow: number | null): number | null {
	if (tokensUsed === null || contextWindow === null || contextWindow <= 0) {
		return null;
	}

	const remaining = 1 - tokensUsed / contextWindow;
	return Math.max(0, Math.min(100, Math.round(remaining * 100)));
}

function readThreadSessionPath(threadReadResult: Record<string, unknown>): string | null {
	const thread = isRecord(threadReadResult.thread) ? threadReadResult.thread : null;
	return thread ? readOptionalString(thread.path) : null;
}

function readOptionalFiniteNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function parseBoolean(value: string | undefined): boolean {
	return value === 'true' || value === '1';
}

function parseApprovalPolicy(value: string | undefined): ApprovalPolicy {
	switch (value) {
		case 'untrusted':
		case 'on-failure':
		case 'on-request':
		case 'never':
			return value;
		default:
			return 'never';
	}
}

function parseSandboxMode(value: string | undefined): SandboxMode {
	switch (value) {
		case 'read-only':
		case 'workspace-write':
		case 'danger-full-access':
			return value;
		default:
			return 'danger-full-access';
	}
}
