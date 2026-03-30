import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { basename, extname, join, relative, resolve } from 'node:path';
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
	FuzzyFileSearchResponse,
	GatewayAccountRateLimitWindow,
	GatewayAccountStatus,
	GatewayConfig,
	GatewayStatus,
	ModelListResponse,
	PendingServerRequest,
	ProjectSummary,
	SandboxMode,
	ThreadReadResponse,
	ThreadNameGenerateResponse,
	ThreadUsageResponse,
	TurnContextUsage,
} from './types';

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '127.0.0.1';
const THREAD_PAGE_SIZE = 200;
const EMPTY_THREAD_USAGE: ThreadUsageResponse = { turns: {} };
const CODEX_HOME = join(homedir(), '.codex');
const CODEX_AUTH_PATH = join(CODEX_HOME, 'auth.json');
const CODEX_SESSIONS_ROOT = join(CODEX_HOME, 'sessions');
const INPUT_IMAGES_ROOT = join(homedir(), '.codex-hub', 'input-images');
const ACCOUNT_STATUS_CACHE_TTL_MS = 15_000;
const IMAGE_MIME_TO_EXTENSION: Record<string, string> = {
	'image/png': '.png',
	'image/jpeg': '.jpg',
	'image/jpg': '.jpg',
	'image/webp': '.webp',
	'image/gif': '.gif',
	'image/bmp': '.bmp',
};
const IMAGE_EXTENSION_TO_MIME: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
	'.bmp': 'image/bmp',
};

type TurnImageUpload = {
	name: string;
	type: string;
	dataBase64: string;
};

type TurnFileMention = {
	name: string;
	path: string;
};

const config: GatewayConfig = {
	port: Number.parseInt(process.env.PORT ?? `${DEFAULT_PORT}`, 10),
	host: process.env.HOST ?? DEFAULT_HOST,
	codexBin: process.env.CODEX_BIN ?? 'codex',
	defaultCwd: process.env.DEFAULT_THREAD_CWD ?? resolve(import.meta.dirname, '..', '..', '..'),
	projectsRoot: process.env.PROJECTS_ROOT ?? join(homedir(), 'Dev'),
	defaultApprovalPolicy: parseApprovalPolicy(process.env.DEFAULT_APPROVAL_POLICY),
	defaultSandboxMode: parseSandboxMode(process.env.DEFAULT_SANDBOX_MODE),
	autoApproveServerRequests: parseBoolean(process.env.AUTO_APPROVE_SERVER_REQUESTS),
};

const bridge = new CodexAppServerBridge(config);
const threadUsageCache = new Map<string, { modifiedAtMs: number; usage: ThreadUsageResponse }>();
let accountStatusCache: {
	expiresAt: number;
	value: GatewayAccountStatus | null;
} | null = null;

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
			const status = await buildGatewayStatus();
			return sendJson(response, 200, { ok: true, status });
		}

		if (method === 'GET' && pathname === '/readyz') {
			const status = await buildGatewayStatus();
			const ready = status.state === 'ready';
			return sendJson(response, ready ? 200 : 503, { ready, status });
		}

		if (method === 'GET' && pathname === '/v1/status') {
			return sendJson(response, 200, await buildGatewayStatus());
		}

		if (method === 'GET' && pathname === '/v1/input-images') {
			const path = readOptionalString(url.searchParams.get('path'));
			if (!path) {
				return sendJson(response, 400, {
					error: { message: 'path is required' },
				});
			}

			return sendInputImage(response, path);
		}

		if (method === 'GET' && pathname === '/v1/projects') {
			await bridge.ensureReady();
			const result = collectProjects(
				await listAllThreads({
					archived: readOptionalBoolean(url.searchParams.get('archived')),
					searchTerm: url.searchParams.get('searchTerm'),
				}),
			);

			return sendJson(response, 200, {
				root: config.projectsRoot,
				data: result,
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
							searchTerm: url.searchParams.get('searchTerm'),
						})
					).filter((thread) => projectPathForThread(thread) === bridge.resolvePath(projectPath)),
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
				cwd: url.searchParams.get('cwd') ? bridge.resolvePath(url.searchParams.get('cwd')) : null,
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
				persistExtendedHistory: true,
			};
			const result = await bridge.request<Record<string, unknown>>('thread/start', payload);
			const name = readOptionalString(body.name);
			if (name && typeof result.thread === 'object' && result.thread && 'id' in result.thread) {
				await bridge.request('thread/name/set', {
					threadId: result.thread.id,
					name,
				});
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
			const message = readOptionalString(body.message)?.trim() ?? null;
			const attachments = readTurnImageUploads(body.attachments);
			const mentions = readTurnFileMentions(body.mentions);
			if (!message && attachments.length === 0 && mentions.length === 0) {
				return sendJson(response, 400, {
					error: { message: 'message, file mention, or image attachment is required' },
				});
			}

			const threadId = decodeURIComponent(threadTurnsMatch[1]);
			const model = readOptionalString(body.model);
			const effort = readOptionalReasoningEffort(body.effort);
			const collaborationMode = buildCollaborationMode(readOptionalMode(body.mode), model, effort);
			const input = [
				...(message
					? [
							{
								type: 'text',
								text: message,
								text_elements: [],
							},
						]
					: []),
				...mentions.map((mention) => ({
					type: 'mention',
					name: mention.name,
					path: mention.path,
				})),
				...(await persistTurnImageUploads(threadId, attachments)),
			];
			const result = await bridge.request<Record<string, unknown>>('turn/start', {
				threadId,
				input,
				cwd: readOptionalString(body.cwd) ? bridge.resolvePath(readOptionalString(body.cwd)) : undefined,
				model: collaborationMode ? undefined : model,
				effort: collaborationMode ? undefined : effort,
				approvalPolicy: readOptionalString(body.approvalPolicy) ?? undefined,
				sandboxPolicy: buildSandboxPolicy(readOptionalString(body.sandbox) ?? config.defaultSandboxMode),
				collaborationMode,
			});
			return sendJson(response, 202, result);
		}

		if (method === 'GET' && pathname === '/v1/fuzzy-file-search') {
			await bridge.ensureReady();
			const query = readOptionalString(url.searchParams.get('query'));
			const roots = url.searchParams
				.getAll('root')
				.map((root) => bridge.resolvePath(root))
				.filter((root, index, list) => root.length > 0 && list.indexOf(root) === index);

			if (!query || roots.length === 0) {
				return sendJson(response, 400, {
					error: { message: 'query and root are required' },
				});
			}

			const result = await bridge.request<FuzzyFileSearchResponse>('fuzzyFileSearch', {
				query,
				roots,
				cancellationToken: null,
			});
			return sendJson(response, 200, result);
		}

		const threadServerRequestsMatch = pathname.match(/^\/v1\/threads\/([^/]+)\/server-requests$/);
		if (method === 'GET' && threadServerRequestsMatch) {
			await bridge.ensureReady();
			const threadId = decodeURIComponent(threadServerRequestsMatch[1]);
			return sendJson(response, 200, {
				data: bridge.listPendingServerRequests(threadId),
			});
		}

		const threadServerRequestResolveMatch = pathname.match(
			/^\/v1\/threads\/([^/]+)\/server-requests\/([^/]+)\/resolve$/,
		);
		if (method === 'POST' && threadServerRequestResolveMatch) {
			await bridge.ensureReady();
			const threadId = decodeURIComponent(threadServerRequestResolveMatch[1]);
			const requestId = readRequestId(threadServerRequestResolveMatch[2]);
			if (requestId === null) {
				return sendJson(response, 400, {
					error: { message: 'requestId must be a number' },
				});
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
				return sendJson(response, 400, {
					error: { message: 'turnId is required' },
				});
			}

			const threadId = decodeURIComponent(threadInterruptMatch[1]);
			const result = await bridge.request<Record<string, unknown>>('turn/interrupt', {
				threadId,
				turnId,
			});
			return sendJson(response, 200, result);
		}

		const threadNameMatch = pathname.match(/^\/v1\/threads\/([^/]+)\/name$/);
		if (method === 'POST' && threadNameMatch) {
			await bridge.ensureReady();
			const body = await readJsonBody(request);
			const name = readOptionalString(body.name);
			if (!name) {
				return sendJson(response, 400, {
					error: { message: 'name is required' },
				});
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
				persistExtendedHistory: true,
			});
			return sendJson(response, 200, result);
		}

		const threadUsageMatch = pathname.match(/^\/v1\/threads\/([^/]+)\/usage$/);
		if (method === 'GET' && threadUsageMatch) {
			await bridge.ensureReady();
			const threadId = decodeURIComponent(threadUsageMatch[1]);
			const thread = await bridge.request<Record<string, unknown>>('thread/read', {
				threadId,
				includeTurns: false,
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
				includeTurns,
			});
			return sendJson(response, 200, {
				...result,
				usage: await readThreadUsageResponse(result),
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
						}),
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
					modifiedAtMs: metadata.modifiedAtMs,
				};
				return sendJson(response, 200, file);
			}

			return sendJson(response, 404, {
				error: { message: `path not found: ${path}` },
			});
		}

		if (method === 'PUT' && pathname === '/v1/fs') {
			await bridge.ensureReady();
			const body = await readJsonBody(request);
			const path = bridge.resolvePath(readOptionalString(body.path));
			const text = readOptionalString(body.text);

			if (!path || text === null) {
				return sendJson(response, 400, {
					error: { message: 'path and text are required' },
				});
			}

			await bridge.request('fs/writeFile', {
				path,
				dataBase64: Buffer.from(text, 'utf8').toString('base64'),
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
		'X-Accel-Buffering': 'no',
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
			cwd: null,
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
			includeHidden: false,
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
			updatedAt: thread.updatedAt,
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
		const byName = left.name.localeCompare(right.name, undefined, {
			sensitivity: 'base',
		});
		if (byName !== 0) {
			return byName;
		}

		return left.path.localeCompare(right.path, undefined, {
			sensitivity: 'base',
		});
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
		sendJson(response, status, {
			error: { message: error.message, code: error.code, data: error.data },
		});
		return;
	}

	sendJson(response, 500, {
		error: { message: error instanceof Error ? error.message : String(error) },
	});
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

async function sendInputImage(response: ServerResponse, inputPath: string): Promise<void> {
	const resolvedPath = resolve(inputPath);
	if (!isPathInsideRoot(resolvedPath, INPUT_IMAGES_ROOT)) {
		return sendJson(response, 403, {
			error: { message: 'input image path is not accessible' },
		});
	}

	let fileMetadata;
	try {
		fileMetadata = await stat(resolvedPath);
	} catch {
		return sendJson(response, 404, {
			error: { message: 'input image was not found' },
		});
	}

	if (!fileMetadata.isFile()) {
		return sendJson(response, 404, {
			error: { message: 'input image was not found' },
		});
	}

	const bytes = await readFile(resolvedPath);
	response.writeHead(200, {
		'Content-Type': mimeTypeForImagePath(resolvedPath),
		'Content-Length': `${bytes.byteLength}`,
		'Cache-Control': 'private, max-age=31536000, immutable',
	});
	response.end(bytes);
}

function readTurnImageUploads(value: unknown): TurnImageUpload[] {
	if (value === undefined || value === null) {
		return [];
	}

	if (!Array.isArray(value)) {
		throw new Error('attachments must be an array');
	}

	return value.map((entry, index) => {
		if (!entry || typeof entry !== 'object') {
			throw new Error(`attachment ${index + 1} is invalid`);
		}

		const name = readOptionalString((entry as Record<string, unknown>).name) ?? `image-${index + 1}`;
		const type = readOptionalString((entry as Record<string, unknown>).type);
		const dataBase64 = readOptionalString((entry as Record<string, unknown>).dataBase64);
		if (!type || !type.startsWith('image/')) {
			throw new Error(`attachment ${index + 1} must be an image`);
		}

		if (!dataBase64) {
			throw new Error(`attachment ${index + 1} is missing data`);
		}

		const extension = extensionForUploadedImage(name, type);
		if (!extension) {
			throw new Error(`attachment ${index + 1} uses an unsupported image type`);
		}

		return {
			name,
			type,
			dataBase64,
		};
	});
}

function readTurnFileMentions(value: unknown): TurnFileMention[] {
	if (value === undefined || value === null) {
		return [];
	}

	if (!Array.isArray(value)) {
		throw new Error('mentions must be an array');
	}

	return value.map((entry, index) => {
		if (!entry || typeof entry !== 'object') {
			throw new Error(`mention ${index + 1} is invalid`);
		}

		const path = readOptionalString((entry as Record<string, unknown>).path);
		if (!path) {
			throw new Error(`mention ${index + 1} is missing a path`);
		}

		return {
			name: readOptionalString((entry as Record<string, unknown>).name) ?? basename(path),
			path: bridge.resolvePath(path),
		};
	});
}

async function persistTurnImageUploads(
	threadId: string,
	uploads: TurnImageUpload[],
): Promise<Array<{ type: 'localImage'; path: string }>> {
	if (uploads.length === 0) {
		return [];
	}

	const threadDirectory = join(INPUT_IMAGES_ROOT, sanitizePathSegment(threadId));
	await mkdir(threadDirectory, { recursive: true });

	const results: Array<{ type: 'localImage'; path: string }> = [];
	for (const upload of uploads) {
		const extension = extensionForUploadedImage(upload.name, upload.type);
		if (!extension) {
			throw new Error(`unsupported image type: ${upload.type}`);
		}

		const filePath = join(threadDirectory, `${Date.now()}-${randomUUID()}${extension}`);
		await writeFile(filePath, Buffer.from(upload.dataBase64, 'base64'));
		results.push({
			type: 'localImage',
			path: filePath,
		});
	}

	return results;
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
		'Content-Type': 'application/json; charset=utf-8',
	});
	response.end(JSON.stringify(body));
}

function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
	const relativePath = relative(rootPath, targetPath);
	return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.startsWith('/'));
}

function sanitizePathSegment(value: string): string {
	const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, '_').trim();
	return sanitized || 'thread';
}

function extensionForUploadedImage(fileName: string, mimeType: string): string | null {
	const normalizedExtension = extname(fileName).toLowerCase();
	if (normalizedExtension && normalizedExtension in IMAGE_EXTENSION_TO_MIME) {
		return normalizedExtension === '.jpeg' ? '.jpg' : normalizedExtension;
	}

	return IMAGE_MIME_TO_EXTENSION[mimeType] ?? null;
}

function mimeTypeForImagePath(path: string): string {
	return IMAGE_EXTENSION_TO_MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
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

function readOptionalReasoningEffort(value: unknown): 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | null {
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
	effort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | null,
): Record<string, unknown> | undefined {
	if (!mode || !model) {
		return undefined;
	}

	return {
		mode,
		settings: {
			model,
			reasoning_effort: effort,
		},
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
		includeTurns: true,
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
			generated: false,
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
			generated: false,
		};
	}

	const generated = sanitizeGeneratedThreadName(
		await requestGeneratedThreadName(thread, context.userText, context.assistantText),
	);
	const finalName = generated ?? fallbackName;
	if (!finalName) {
		throw new Error('title generation returned an empty name');
	}

	await bridge.request('thread/name/set', { threadId, name: finalName });
	return {
		threadId,
		name: finalName,
		generated: generated !== null,
	};
}

function extractThreadNamingContext(thread: CodexThread): { userText: string; assistantText: string } | null {
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
		assistantText: assistantText.slice(0, 2_400),
	};
}

function readUserMessageTexts(item: CodexThread['turns'][number]['items'][number]): string[] {
	if (!('content' in item) || !Array.isArray(item.content)) {
		return [];
	}

	return item.content
		.map((entry) => {
			if (!entry || typeof entry !== 'object' || !('type' in entry)) {
				return null;
			}

			if (entry.type === 'text') {
				return readOptionalString(entry.text);
			}

			if (entry.type === 'image' || entry.type === 'localImage') {
				return '[image attached]';
			}

			return null;
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
	assistantText: string,
): Promise<string> {
	const promptThread = await bridge.request<Record<string, unknown> & { thread: { id: string } }>('thread/start', {
		cwd: thread.cwd,
		modelProvider: thread.modelProvider,
		approvalPolicy: 'never',
		sandbox: 'read-only',
		ephemeral: true,
		experimentalRawEvents: false,
		persistExtendedHistory: false,
	});
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
					text_elements: [],
				},
			],
			approvalPolicy: 'never',
			sandboxPolicy: buildSandboxPolicy('read-only'),
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
			usage,
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
		crlfDelay: Infinity,
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
			const totalTokens = lastTokenUsage ? readOptionalFiniteNumber(lastTokenUsage.total_tokens) : null;
			if (totalTokens !== null) {
				target.lastTokenUsageTotalTokens = totalTokens;
			}
		}
	} finally {
		lines.close();
		input.destroy();
	}

	for (const usage of Object.values(turns)) {
		usage.contextLeftPercent = computeContextLeftPercent(usage.lastTokenUsageTotalTokens, usage.modelContextWindow);
	}

	return { turns };
}

async function buildGatewayStatus(): Promise<GatewayStatus> {
	return {
		...bridge.getStatus(),
		account: await loadGatewayAccountStatus(),
	};
}

async function loadGatewayAccountStatus(): Promise<GatewayAccountStatus | null> {
	const cached = accountStatusCache;
	if (cached && cached.expiresAt > Date.now()) {
		return cached.value;
	}

	let nextValue: GatewayAccountStatus | null = null;

	try {
		nextValue = await readGatewayAccountStatus();
	} catch {
		nextValue = null;
	}

	accountStatusCache = {
		expiresAt: Date.now() + ACCOUNT_STATUS_CACHE_TTL_MS,
		value: nextValue,
	};

	return nextValue;
}

async function readGatewayAccountStatus(): Promise<GatewayAccountStatus | null> {
	const [identity, limits] = await Promise.all([readGatewayAccountIdentity(), readLatestGatewayRateLimits()]);

	if (!identity && !limits) {
		return null;
	}

	return {
		authMode: identity?.authMode ?? null,
		providerLabel: formatGatewayProviderLabel(identity?.authMode),
		email: identity?.email ?? null,
		name: identity?.name ?? null,
		accountId: identity?.accountId ?? null,
		planType: limits?.planType ?? null,
		fiveHourLimit: limits?.fiveHourLimit ?? null,
		weeklyLimit: limits?.weeklyLimit ?? null,
		rateLimitsUpdatedAt: limits?.updatedAt ?? null,
	};
}

async function readGatewayAccountIdentity(): Promise<{
	authMode: string | null;
	email: string | null;
	name: string | null;
	accountId: string | null;
} | null> {
	let raw: string;

	try {
		raw = await readFile(CODEX_AUTH_PATH, 'utf8');
	} catch {
		return null;
	}

	let parsed: unknown;

	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}

	if (!isRecord(parsed)) {
		return null;
	}

	const tokens = isRecord(parsed.tokens) ? parsed.tokens : null;
	const claims = parseJwtClaims(readOptionalString(tokens?.id_token));

	return {
		authMode: readOptionalString(parsed.auth_mode),
		email: readOptionalString(claims?.email),
		name: readOptionalString(claims?.name),
		accountId: readOptionalString(tokens?.account_id),
	};
}

function parseJwtClaims(token: string | null): Record<string, unknown> | null {
	if (!token) {
		return null;
	}

	const parts = token.split('.');
	if (parts.length < 2) {
		return null;
	}

	try {
		const decoded = Buffer.from(parts[1], 'base64url').toString('utf8');
		const payload = JSON.parse(decoded);
		return isRecord(payload) ? payload : null;
	} catch {
		return null;
	}
}

function formatGatewayProviderLabel(authMode: string | null | undefined): string {
	switch (authMode) {
		case 'chatgpt':
			return 'ChatGPT';
		case 'api_key':
			return 'API key';
		default:
			return 'Codex';
	}
}

async function readLatestGatewayRateLimits(): Promise<{
	planType: string | null;
	fiveHourLimit: GatewayAccountRateLimitWindow | null;
	weeklyLimit: GatewayAccountRateLimitWindow | null;
	updatedAt: string | null;
} | null> {
	const recentSessionFiles = await listRecentSessionFiles(CODEX_SESSIONS_ROOT, 12);
	for (const sessionFile of recentSessionFiles) {
		const snapshot = await parseLatestRateLimitsFromSessionFile(sessionFile.path);
		if (snapshot) {
			return snapshot;
		}
	}

	return null;
}

async function listRecentSessionFiles(root: string, limit: number): Promise<Array<{ path: string; mtimeMs: number }>> {
	const files: Array<{ path: string; mtimeMs: number }> = [];

	async function walk(directory: string): Promise<void> {
		let entries;

		try {
			entries = await readdir(directory, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const nextPath = join(directory, entry.name);
			if (entry.isDirectory()) {
				await walk(nextPath);
				continue;
			}

			if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
				continue;
			}

			try {
				const metadata = await stat(nextPath);
				files.push({ path: nextPath, mtimeMs: metadata.mtimeMs });
			} catch {
				// ignore stale session files that disappear between readdir and stat
			}
		}
	}

	await walk(root);

	return files.sort((left, right) => right.mtimeMs - left.mtimeMs).slice(0, limit);
}

async function parseLatestRateLimitsFromSessionFile(sessionPath: string): Promise<{
	planType: string | null;
	fiveHourLimit: GatewayAccountRateLimitWindow | null;
	weeklyLimit: GatewayAccountRateLimitWindow | null;
	updatedAt: string | null;
} | null> {
	const input = createReadStream(sessionPath, { encoding: 'utf8' });
	const lines = createInterface({
		input,
		crlfDelay: Infinity,
	});
	let latestSnapshot: {
		planType: string | null;
		fiveHourLimit: GatewayAccountRateLimitWindow | null;
		weeklyLimit: GatewayAccountRateLimitWindow | null;
		updatedAt: string | null;
	} | null = null;

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
			if (readOptionalString(payload.type) !== 'token_count') {
				continue;
			}

			const rateLimits = isRecord(payload.rate_limits) ? payload.rate_limits : null;
			if (!rateLimits) {
				continue;
			}

			const primaryWindow = parseRateLimitWindow(rateLimits.primary);
			const secondaryWindow = parseRateLimitWindow(rateLimits.secondary);

			latestSnapshot = {
				planType: readOptionalString(rateLimits.plan_type),
				fiveHourLimit: selectRateLimitWindow(primaryWindow, secondaryWindow, 300, 'primary'),
				weeklyLimit: selectRateLimitWindow(primaryWindow, secondaryWindow, 10_080, 'secondary'),
				updatedAt: readOptionalString(parsed.timestamp),
			};
		}
	} finally {
		lines.close();
		input.destroy();
	}

	return latestSnapshot;
}

function parseRateLimitWindow(value: unknown): GatewayAccountRateLimitWindow | null {
	if (!isRecord(value)) {
		return null;
	}

	return {
		usedPercent: readOptionalFiniteNumber(value.used_percent),
		windowMinutes: readOptionalFiniteNumber(value.window_minutes),
		resetsAt: parseResetTimestamp(readOptionalFiniteNumber(value.resets_at)),
	};
}

function selectRateLimitWindow(
	primary: GatewayAccountRateLimitWindow | null,
	secondary: GatewayAccountRateLimitWindow | null,
	targetWindowMinutes: number,
	fallbackKey: 'primary' | 'secondary',
): GatewayAccountRateLimitWindow | null {
	const match = [primary, secondary].find((window) => window?.windowMinutes === targetWindowMinutes);
	if (match) {
		return match;
	}

	return fallbackKey === 'primary' ? primary : secondary;
}

function parseResetTimestamp(value: number | null): string | null {
	if (value === null) {
		return null;
	}

	return new Date(value * 1_000).toISOString();
}

function getOrCreateTurnUsage(turns: Record<string, TurnContextUsage>, turnId: string): TurnContextUsage {
	turns[turnId] ??= {
		lastTokenUsageTotalTokens: null,
		modelContextWindow: null,
		contextLeftPercent: null,
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
