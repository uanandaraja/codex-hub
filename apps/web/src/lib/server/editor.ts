import { env } from '$env/dynamic/private';
import type { CodexThread } from '$lib/types';

const threadGitPathKeys = ['root', 'repoRoot', 'worktreeRoot', 'worktree_root', 'rootPath', 'path'];

type ThreadPathSource = Pick<CodexThread, 'cwd' | 'gitInfo'>;

export function isEditorConfigured(): boolean {
	return Boolean((env.EDITOR_BASE_URL ?? '').trim());
}

export function resolveThreadProjectPath(thread: ThreadPathSource): string {
	const gitInfo = thread.gitInfo;
	if (gitInfo && typeof gitInfo === 'object') {
		for (const key of threadGitPathKeys) {
			const value = gitInfo[key];
			if (typeof value === 'string' && value.startsWith('/')) {
				return value;
			}
		}
	}

	return thread.cwd;
}

export function buildEditorUrl(path: string): string {
	const baseUrl = (env.EDITOR_BASE_URL ?? '').trim();
	if (!baseUrl) {
		throw new Error('EDITOR_BASE_URL is not configured.');
	}

	if (!path.startsWith('/')) {
		throw new Error(`Editor path must be absolute. Received: ${path}`);
	}

	const url = new URL(baseUrl);
	url.searchParams.set('folder', path);
	return url.toString();
}
