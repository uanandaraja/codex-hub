import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createInterface, Interface } from 'node:readline';
import type {
	AppServerNotification,
	GatewayConfig,
	GatewayStatus,
	JsonRpcErrorPayload,
	PendingServerRequest
} from './types';

type PendingRequest = {
	method: string;
	resolve: (value: any) => void;
	reject: (error: Error) => void;
	timeout: ReturnType<typeof setTimeout>;
};

type NotificationListener = (notification: AppServerNotification) => void;

export class JsonRpcError extends Error {
	code: number;
	data?: unknown;

	constructor(payload: JsonRpcErrorPayload) {
		super(payload.message);
		this.name = 'JsonRpcError';
		this.code = payload.code;
		this.data = payload.data;
	}
}

export class CodexAppServerBridge {
	private child: ChildProcessWithoutNullStreams | null = null;
	private stdout: Interface | null = null;
	private requestCounter = 0;
	private readyPromise: Promise<void> | null = null;
	private pending = new Map<number, PendingRequest>();
	private subscribers = new Map<string, Set<NotificationListener>>();
	private pendingServerRequests = new Map<number, PendingServerRequest>();
	private warnings: string[] = [];
	private recentStderr: string[] = [];
	private state: GatewayStatus['state'] = 'starting';
	private startedAt: string | null = null;
	private lastError: string | null = null;

	constructor(private readonly config: GatewayConfig) {}

	async ensureReady(): Promise<void> {
		if (!this.readyPromise) {
			this.readyPromise = this.start();
		}

		try {
			await this.readyPromise;
		} catch (error) {
			this.readyPromise = null;
			throw error;
		}
	}

	async stop(): Promise<void> {
		if (!this.child) {
			return;
		}

		const child = this.child;
		this.child = null;
		this.stdout?.close();
		this.stdout = null;
		child.kill('SIGTERM');
	}

	getStatus(): GatewayStatus {
		return {
			state: this.state,
			codexBin: this.config.codexBin,
			defaultCwd: this.config.defaultCwd,
			projectsRoot: this.config.projectsRoot,
			defaultApprovalPolicy: this.config.defaultApprovalPolicy,
			defaultSandboxMode: this.config.defaultSandboxMode,
			autoApproveServerRequests: this.config.autoApproveServerRequests,
			warnings: [...this.warnings],
			recentStderr: [...this.recentStderr],
			lastError: this.lastError,
			startedAt: this.startedAt
		};
	}

	async request<T>(method: string, params?: unknown): Promise<T> {
		await this.ensureReady();
		return this.sendRequest<T>(method, params);
	}

	subscribe(threadId: string, listener: NotificationListener): () => void {
		const listeners = this.subscribers.get(threadId) ?? new Set<NotificationListener>();
		listeners.add(listener);
		this.subscribers.set(threadId, listeners);

		return () => {
			const current = this.subscribers.get(threadId);
			if (!current) {
				return;
			}

			current.delete(listener);
			if (current.size === 0) {
				this.subscribers.delete(threadId);
			}
		};
	}

	listPendingServerRequests(threadId: string): PendingServerRequest[] {
		return [...this.pendingServerRequests.values()]
			.filter((request) => request.threadId === threadId)
			.sort((left, right) => left.createdAt - right.createdAt);
	}

	resolveServerRequest(threadId: string, requestId: number, result: unknown): void {
		const pending = this.pendingServerRequests.get(requestId);
		if (!pending || pending.threadId !== threadId) {
			throw new Error(`server request ${requestId} was not found for thread ${threadId}`);
		}

		this.pendingServerRequests.delete(requestId);
		this.sendResponse(requestId, result);
	}

	resolvePath(inputPath?: string | null): string {
		if (!inputPath) {
			return this.config.defaultCwd;
		}

		return resolve(this.config.defaultCwd, inputPath);
	}

	private async start(): Promise<void> {
		this.state = 'starting';
		this.startedAt = new Date().toISOString();
		this.lastError = null;

		const child = spawn(this.config.codexBin, ['app-server', '--listen', 'stdio://'], {
			stdio: ['pipe', 'pipe', 'pipe'],
			cwd: this.config.defaultCwd,
			env: process.env
		});

		this.child = child;
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');

		this.stdout = createInterface({ input: child.stdout });
		this.stdout.on('line', (line) => this.handleStdoutLine(line));
		child.stderr.on('data', (chunk) => this.handleStderr(String(chunk)));
		child.on('error', (error) => this.handleProcessFailure(error));
		child.on('exit', (code, signal) => {
			this.handleProcessFailure(new Error(`codex app-server exited (${code ?? 'null'} / ${signal ?? 'null'})`));
		});

		await this.sendRequest('initialize', {
			clientInfo: {
				name: 'codex_hub_gateway',
				title: 'Codex Hub Gateway',
				version: '0.1.0'
			},
			capabilities: {
				experimentalApi: true
			}
		});
		this.sendNotification('initialized');
		this.state = 'ready';
	}

	private handleStdoutLine(line: string): void {
		if (!line.trim()) {
			return;
		}

		let payload: Record<string, unknown>;
		try {
			payload = JSON.parse(line) as Record<string, unknown>;
		} catch (error) {
			this.recordError(`failed to parse app-server stdout: ${String(error)}`);
			return;
		}

		if (typeof payload.method === 'string' && typeof payload.id === 'number') {
			this.handleServerRequest(payload);
			return;
		}

		if (typeof payload.id === 'number') {
			this.handleResponse(payload);
			return;
		}

		if (typeof payload.method === 'string') {
			this.handleNotification(payload as unknown as AppServerNotification);
		}
	}

	private handleResponse(payload: Record<string, unknown>): void {
		const id = payload.id as number;
		const pending = this.pending.get(id);
		if (!pending) {
			return;
		}

		clearTimeout(pending.timeout);
		this.pending.delete(id);

		if (payload.error) {
			pending.reject(new JsonRpcError(payload.error as JsonRpcErrorPayload));
			return;
		}

		pending.resolve(payload.result);
	}

	private handleNotification(notification: AppServerNotification): void {
		if (notification.method === 'configWarning') {
			const summary = notification.params?.summary;
			if (typeof summary === 'string') {
				this.pushUnique(this.warnings, summary, 20);
			}
		}

		if (notification.method === 'error') {
			this.recordError(JSON.stringify(notification.params ?? {}));
		}

		if (notification.method === 'serverRequest/resolved') {
			const requestId = this.extractRequestId(notification.params);
			if (requestId !== null) {
				this.pendingServerRequests.delete(requestId);
			}
		}

		const threadId = this.extractThreadId(notification.params);
		if (!threadId) {
			return;
		}

		this.emitThreadNotification(threadId, notification);
	}

	private handleServerRequest(payload: Record<string, unknown>): void {
		const method = String(payload.method);
		const id = payload.id as number;
		if (this.config.autoApproveServerRequests) {
			if (method === 'item/commandExecution/requestApproval') {
				this.sendResponse(id, { decision: 'accept' });
				return;
			}

			if (method === 'item/fileChange/requestApproval') {
				this.sendResponse(id, { decision: 'accept' });
				return;
			}
		}

		const params =
			payload.params && typeof payload.params === 'object'
				? (payload.params as Record<string, unknown>)
				: undefined;
		const threadId = this.extractThreadId(params);
		if (params && threadId && this.shouldQueueServerRequest(method)) {
			const pending: PendingServerRequest = {
				requestId: id,
				method,
				threadId,
				createdAt: Date.now(),
				params
			};
			this.pendingServerRequests.set(id, pending);
			this.emitThreadNotification(threadId, {
				method: 'serverRequest/pending',
				params: {
					threadId,
					requestId: id,
					request: {
						method,
						params
					}
				}
			});
			return;
		}

		this.sendError(id, -32601, `Unsupported server request: ${method}`);
		this.recordError(`unsupported server request from app-server: ${method}`);
	}

	private handleStderr(chunk: string): void {
		for (const line of chunk.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}

			this.pushUnique(this.recentStderr, trimmed, 40);
		}
	}

	private handleProcessFailure(error: unknown): void {
		if (this.child) {
			this.child.removeAllListeners();
			this.child = null;
		}

		this.stdout?.close();
		this.stdout = null;
		this.readyPromise = null;
		this.pendingServerRequests.clear();
		this.state = 'error';
		this.recordError(String(error));

		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timeout);
			pending.reject(new Error(`app-server connection closed while waiting for ${pending.method}`));
			this.pending.delete(id);
		}
	}

	private sendNotification(method: string, params?: unknown): void {
		this.writeMessage(params === undefined ? { method } : { method, params });
	}

	private async sendRequest<T>(method: string, params?: unknown): Promise<T> {
		const child = this.child;
		if (!child || child.killed || child.exitCode !== null) {
			throw new Error('codex app-server is not running');
		}

		const id = ++this.requestCounter;

		return new Promise<T>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`timed out waiting for ${method}`));
			}, 60_000);

			this.pending.set(id, { method, resolve, reject, timeout });

			try {
				this.writeMessage(params === undefined ? { id, method } : { id, method, params });
			} catch (error) {
				clearTimeout(timeout);
				this.pending.delete(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	private writeMessage(payload: unknown): void {
		const child = this.child;
		if (!child || child.stdin.destroyed) {
			throw new Error('app-server stdin is unavailable');
		}

		child.stdin.write(`${JSON.stringify(payload)}\n`);
	}

	private sendResponse(id: number, result: unknown): void {
		this.writeMessage({ id, result });
	}

	private sendError(id: number, code: number, message: string): void {
		this.writeMessage({ id, error: { code, message } });
	}

	private extractThreadId(params?: Record<string, unknown>): string | null {
		if (!params) {
			return null;
		}

		if (typeof params.threadId === 'string') {
			return params.threadId;
		}

		const thread = params.thread;
		if (thread && typeof thread === 'object' && 'id' in thread && typeof thread.id === 'string') {
			return thread.id;
		}

		return null;
	}

	private extractRequestId(params?: Record<string, unknown>): number | null {
		return typeof params?.requestId === 'number' ? params.requestId : null;
	}

	private emitThreadNotification(threadId: string, notification: AppServerNotification): void {
		const listeners = this.subscribers.get(threadId);
		if (!listeners) {
			return;
		}

		for (const listener of listeners) {
			listener(notification);
		}
	}

	private shouldQueueServerRequest(method: string): boolean {
		return (
			method === 'item/commandExecution/requestApproval' ||
			method === 'item/fileChange/requestApproval' ||
			method === 'item/permissions/requestApproval' ||
			method === 'item/tool/requestUserInput'
		);
	}

	private pushUnique(target: string[], value: string, maxSize: number): void {
		if (target[target.length - 1] === value) {
			return;
		}

		target.push(value);
		while (target.length > maxSize) {
			target.shift();
		}
	}

	private recordError(message: string): void {
		this.lastError = message;
	}
}
