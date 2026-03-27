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
}

export interface UserInputText {
	type: 'text';
	text: string;
	text_elements: Array<{ byteRange: { start: number; end: number }; placeholder: string | null }>;
}

export type UserInput = UserInputText | { type: string; [key: string]: unknown };

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

export interface ThreadReadResponse {
	thread: CodexThread;
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

export interface DirectoryEntry {
	fileName: string;
	isDirectory: boolean;
	isFile: boolean;
	path: string;
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

export interface RpcNotification {
	method: string;
	params?: Record<string, unknown>;
}
