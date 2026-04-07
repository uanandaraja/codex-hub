export interface GatewayStatus {
	state: 'starting' | 'ready' | 'error';
	codexBin: string;
	defaultCwd: string;
	projectsRoot: string;
	defaultApprovalPolicy: string;
	defaultSandboxMode: string;
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

export type UserInputText = {
	type: 'text';
	text: string;
	text_elements: Array<{ byteRange: { start: number; end: number }; placeholder: string | null }>;
};

export type UserInputImage = {
	type: 'image';
	url: string;
};

export type UserInputLocalImage = {
	type: 'localImage';
	path: string;
};

export type UserInputMention = {
	type: 'mention';
	name: string;
	path: string;
};

export type UserInput =
	| UserInputText
	| UserInputImage
	| UserInputLocalImage
	| UserInputMention
	| { type: string; [key: string]: unknown };

export type CodexThreadItem =
	| { type: 'userMessage'; id: string; content: UserInput[] }
	| { type: 'agentMessage'; id: string; text: string; phase: string | null }
	| { type: 'reasoning'; id: string; summary: string[]; content: string[] }
	| { type: 'plan'; id: string; text: string }
	| {
			type: 'commandExecution';
			id: string;
			command: string;
			cwd: string;
			status: string;
			aggregatedOutput: string | null;
			exitCode: number | null;
			durationMs: number | null;
	  }
	| {
			type: 'fileChange';
			id: string;
			status: string;
			changes: Array<{
				path: string;
				kind: { type: 'add' | 'delete' | 'update'; move_path?: string | null };
				diff: string;
			}>;
	  }
	| { type: string; id: string; [key: string]: unknown };

export interface CodexTurn {
	id: string;
	status: string;
	error: { message?: string } | null;
	items: CodexThreadItem[];
}

export type CodexThreadStatus =
	| string
	| { type: 'notLoaded' }
	| { type: 'idle' }
	| { type: 'systemError' }
	| { type: 'active'; activeFlags: string[] };

export interface CodexThread {
	id: string;
	preview: string;
	ephemeral: boolean;
	modelProvider: string;
	createdAt: number;
	updatedAt: number;
	status: CodexThreadStatus;
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
	truncatedTurnCount: number;
}

export interface ThreadNameGenerateResponse {
	threadId: string;
	name: string;
	generated: boolean;
}

export interface ThreadStartResponse {
	thread: CodexThread;
}

export interface ThreadListResponse {
	data: CodexThread[];
	nextCursor: string | null;
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

export interface GitDiffResponse {
	data: {
		patch: string;
	};
}

export interface ModelReasoningEffortOption {
	reasoningEffort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
	description: string;
}

export interface ModelSummary {
	id: string;
	model: string;
	displayName: string;
	description: string;
	hidden: boolean;
	isDefault: boolean;
	defaultReasoningEffort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
	supportedReasoningEfforts: ModelReasoningEffortOption[];
}

export interface ModelListResponse {
	data: ModelSummary[];
	nextCursor: string | null;
}

export interface CommandExecutionRequestApprovalParams {
	threadId: string;
	turnId: string;
	itemId: string;
	approvalId?: string | null;
	reason?: string | null;
	command?: string | null;
	cwd?: string | null;
	availableDecisions?: Array<
		| 'accept'
		| 'acceptForSession'
		| 'decline'
		| 'cancel'
		| { acceptWithExecpolicyAmendment: { execpolicy_amendment: unknown } }
		| { applyNetworkPolicyAmendment: { network_policy_amendment: unknown } }
	> | null;
}

export interface FileChangeRequestApprovalParams {
	threadId: string;
	turnId: string;
	itemId: string;
	reason?: string | null;
	grantRoot?: string | null;
}

export interface RequestPermissionProfile {
	fileSystem?: {
		read?: string[] | null;
		write?: string[] | null;
	} | null;
	network?: {
		enabled?: boolean | null;
	} | null;
}

export interface PermissionsRequestApprovalParams {
	threadId: string;
	turnId: string;
	itemId: string;
	reason: string | null;
	permissions: RequestPermissionProfile;
}

export interface ToolRequestUserInputOption {
	label: string;
	description: string;
}

export interface ToolRequestUserInputQuestion {
	header: string;
	id: string;
	question: string;
	isOther?: boolean;
	isSecret?: boolean;
	options?: ToolRequestUserInputOption[] | null;
}

export interface ToolRequestUserInputParams {
	threadId: string;
	turnId: string;
	itemId: string;
	questions: ToolRequestUserInputQuestion[];
}

export type PendingServerRequest =
	| {
			requestId: number;
			method: 'item/commandExecution/requestApproval';
			threadId: string;
			createdAt: number;
			params: CommandExecutionRequestApprovalParams;
	  }
	| {
			requestId: number;
			method: 'item/fileChange/requestApproval';
			threadId: string;
			createdAt: number;
			params: FileChangeRequestApprovalParams;
	  }
	| {
			requestId: number;
			method: 'item/permissions/requestApproval';
			threadId: string;
			createdAt: number;
			params: PermissionsRequestApprovalParams;
	  }
	| {
			requestId: number;
			method: 'item/tool/requestUserInput';
			threadId: string;
			createdAt: number;
			params: ToolRequestUserInputParams;
	  }
	| {
			requestId: number;
			method: string;
			threadId: string;
			createdAt: number;
			params: Record<string, unknown>;
	  };

export interface PendingServerRequestListResponse {
	data: PendingServerRequest[];
}

export interface DirectoryEntry {
	fileName: string;
	isDirectory: boolean;
	isFile: boolean;
	path: string;
	isIgnored?: boolean;
}

export interface DirectoryNode {
	kind: 'directory';
	path: string;
	entries: DirectoryEntry[];
}

export interface FileNode {
	kind: 'file';
	path: string;
	text: string | null;
	isBinary: boolean;
	byteLength: number;
	modifiedAtMs: number;
}

export type FsNode = DirectoryNode | FileNode;

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

export interface RpcNotification {
	method: string;
	params?: Record<string, unknown>;
}
