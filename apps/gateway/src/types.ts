export type ApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never';
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface JsonRpcErrorPayload {
	code: number;
	message: string;
	data?: unknown;
}

export interface JsonRpcRequest {
	id?: number;
	method: string;
	params?: unknown;
}

export interface JsonRpcResponse<T = unknown> {
	id: number;
	result?: T;
	error?: JsonRpcErrorPayload;
}

export interface AppServerNotification {
	method: string;
	params?: Record<string, unknown>;
}

export interface GatewayStatus {
	state: 'starting' | 'ready' | 'error';
	codexBin: string;
	defaultCwd: string;
	projectsRoot: string;
	defaultApprovalPolicy: ApprovalPolicy;
	defaultSandboxMode: SandboxMode;
	autoApproveServerRequests: boolean;
	warnings: string[];
	recentStderr: string[];
	lastError: string | null;
	startedAt: string | null;
	account: GatewayAccountStatus | null;
}

export interface GatewayAccountRateLimitWindow {
	usedPercent: number | null;
	windowMinutes: number | null;
	resetsAt: string | null;
}

export interface GatewayAccountStatus {
	authMode: string | null;
	providerLabel: string;
	email: string | null;
	name: string | null;
	accountId: string | null;
	planType: string | null;
	fiveHourLimit: GatewayAccountRateLimitWindow | null;
	weeklyLimit: GatewayAccountRateLimitWindow | null;
	rateLimitsUpdatedAt: string | null;
}

export interface GatewayConfig {
	port: number;
	host: string;
	codexBin: string;
	defaultCwd: string;
	projectsRoot: string;
	defaultApprovalPolicy: ApprovalPolicy;
	defaultSandboxMode: SandboxMode;
	autoApproveServerRequests: boolean;
}

export interface ProjectSummary {
	name: string;
	path: string;
	threadCount: number;
	updatedAt: number;
}

export interface ProjectListResponse {
	root: string;
	data: ProjectSummary[];
}

export interface ModelReasoningEffortOption {
	reasoningEffort: string;
	description: string;
}

export interface ModelSummary {
	id: string;
	model: string;
	displayName: string;
	description: string;
	hidden: boolean;
	isDefault: boolean;
	defaultReasoningEffort: string;
	supportedReasoningEfforts: ModelReasoningEffortOption[];
}

export interface ModelListResponse {
	data: ModelSummary[];
	nextCursor: string | null;
}

export interface PendingServerRequest {
	requestId: number;
	method: string;
	threadId: string;
	createdAt: number;
	params: Record<string, unknown>;
}

export interface CodexThreadItem {
	type: string;
	id: string;
	[key: string]: unknown;
}

export interface CodexTurn {
	id: string;
	status: string;
	error: { message?: string } | null;
	items: CodexThreadItem[];
}

export interface CodexThread {
	id: string;
	preview: string;
	ephemeral: boolean;
	modelProvider: string;
	createdAt: number;
	updatedAt: number;
	status: string;
	path: string | null;
	cwd: string;
	cliVersion: string;
	source: string;
	agentNickname: string | null;
	agentRole: string | null;
	gitInfo: Record<string, unknown> | null;
	name: string | null;
	turns: CodexTurn[];
}

export interface CodexThreadListResponse {
	data: CodexThread[];
	nextCursor: string | null;
}

export interface TurnContextUsage {
	lastTokenUsageTotalTokens: number | null;
	modelContextWindow: number | null;
	contextLeftPercent: number | null;
}

export interface ThreadUsageResponse {
	turns: Record<string, TurnContextUsage>;
}

export interface ThreadReadResponse {
	thread: CodexThread;
	usage: ThreadUsageResponse;
}

export interface ThreadNameGenerateResponse {
	threadId: string;
	name: string;
	generated: boolean;
}

export interface DirectoryEntry {
	fileName: string;
	isDirectory: boolean;
	isFile: boolean;
}

export interface DirectoryListingResponse {
	kind: 'directory';
	path: string;
	entries: Array<DirectoryEntry & { path: string }>;
}

export interface FileContentsResponse {
	kind: 'file';
	path: string;
	text: string | null;
	isBinary: boolean;
	byteLength: number;
	modifiedAtMs: number;
}

export type FuzzyFileSearchMatchType = 'file' | 'directory';

export type FuzzyFileSearchResult = {
	root: string;
	path: string;
	match_type: FuzzyFileSearchMatchType;
	file_name: string;
	score: number;
	indices: number[] | null;
};

export type FuzzyFileSearchResponse = {
	files: FuzzyFileSearchResult[];
};
