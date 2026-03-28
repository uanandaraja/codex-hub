import { gatewayJson } from '$lib/server/gateway';
import type {
	CodexThread,
	GatewayStatus,
	ProjectListResponse,
	ThreadListResponse,
	ThreadReadResponse
} from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const [statusResult, projectsResult] = await Promise.allSettled([
		gatewayJson<GatewayStatus>('/v1/status'),
		gatewayJson<ProjectListResponse>('/v1/projects')
	]);

	const requestedProjectPath = url.searchParams.get('project');
	const requestedThreadId = url.searchParams.get('thread');
	const availableProjects = projectsResult.status === 'fulfilled' ? projectsResult.value.data : [];
	const initialProjectPath =
		requestedProjectPath && availableProjects.some((project) => project.path === requestedProjectPath)
			? requestedProjectPath
			: availableProjects[0]?.path ?? null;

	let threads: ThreadListResponse['data'] = [];
	let threadsError: string | null = null;
	let initialThreadId: string | null = null;
	let initialThread: CodexThread | null = null;

	if (initialProjectPath) {
		try {
			threads = (
				await gatewayJson<ThreadListResponse>(
					`/v1/threads?projectPath=${encodeURIComponent(initialProjectPath)}`
				)
			).data;
		} catch {
			threadsError = 'Thread list could not be loaded. The server may not be ready yet.';
		}
	}

	if (requestedThreadId && threads.some((thread) => thread.id === requestedThreadId)) {
		initialThreadId = requestedThreadId;
	} else {
		initialThreadId = threads[0]?.id ?? null;
	}

	if (initialThreadId) {
		try {
			initialThread = (
				await gatewayJson<ThreadReadResponse>(
					`/v1/threads/${encodeURIComponent(initialThreadId)}?includeTurns=true`
				)
			).thread;
		} catch {
			// Keep the page usable even if the thread read fails.
		}
	}

	return {
		status: statusResult.status === 'fulfilled' ? statusResult.value : null,
		projects: projectsResult.status === 'fulfilled' ? projectsResult.value.data : [],
		threads,
		initialThread,
		initialProjectPath,
		initialThreadId,
		errors: {
			status:
				statusResult.status === 'rejected'
					? 'Gateway status could not be loaded. Check the local gateway process.'
					: null,
			projects:
				projectsResult.status === 'rejected'
					? 'Project list could not be loaded. The server may not be ready yet.'
					: null,
			threads:
				threadsError
		}
	};
};
