import { gatewayJson } from '$lib/server/gateway';
import { isEditorConfigured } from '$lib/server/editor';
import type {
	CodexThread,
	GatewayStatus,
	ModelListResponse,
	PendingServerRequestListResponse,
	ProjectListResponse,
	ThreadListResponse,
	ThreadReadResponse
} from '$lib/types';
import type { PageServerLoad } from './$types';

const INITIAL_THREAD_TAIL_TURNS = 24;

export const load: PageServerLoad = async ({ url }) => {
	const [statusResult, projectsResult, modelsResult] = await Promise.allSettled([
		gatewayJson<GatewayStatus>('/v1/status'),
		gatewayJson<ProjectListResponse>('/v1/projects'),
		gatewayJson<ModelListResponse>('/v1/models')
	]);

	const requestedProjectPath = url.searchParams.get('project');
	const requestedThreadId = url.searchParams.get('thread');
	const availableProjects = projectsResult.status === 'fulfilled' ? projectsResult.value.data : [];
	const initialProjectPath =
		requestedProjectPath &&
		availableProjects.some((project) => project.path === requestedProjectPath)
			? requestedProjectPath
			: (availableProjects[0]?.path ?? null);

	let threads: ThreadListResponse['data'] = [];
	let threadsError: string | null = null;
	let initialThreadId: string | null = null;
	let initialThread: CodexThread | null = null;
	let initialThreadUsage: ThreadReadResponse['usage']['turns'] = {};
	let initialThreadTruncatedTurnCount = 0;
	let pendingRequests: PendingServerRequestListResponse['data'] = [];

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
		const [threadResult, pendingRequestsResult] = await Promise.allSettled([
			gatewayJson<ThreadReadResponse>(
				`/v1/threads/${encodeURIComponent(initialThreadId)}?includeTurns=true&includeUsage=false&tailTurns=${INITIAL_THREAD_TAIL_TURNS}`
			),
			gatewayJson<PendingServerRequestListResponse>(
				`/v1/threads/${encodeURIComponent(initialThreadId)}/server-requests`
			)
		]);

		if (threadResult.status === 'fulfilled') {
			initialThread = threadResult.value.thread;
			initialThreadUsage = threadResult.value.usage.turns;
			initialThreadTruncatedTurnCount = threadResult.value.truncatedTurnCount;
		}

		if (pendingRequestsResult.status === 'fulfilled') {
			pendingRequests = pendingRequestsResult.value.data;
		}
	}

	return {
		status: statusResult.status === 'fulfilled' ? statusResult.value : null,
		editorEnabled: isEditorConfigured(),
		projects: projectsResult.status === 'fulfilled' ? projectsResult.value.data : [],
		models: modelsResult.status === 'fulfilled' ? modelsResult.value.data : [],
		threads,
		initialThread,
		initialThreadUsage,
		initialThreadTruncatedTurnCount,
		initialPendingRequests: pendingRequests,
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
			models:
				modelsResult.status === 'rejected'
					? 'Model list could not be loaded. Using fallback prompt settings.'
					: null,
			threads: threadsError
		}
	};
};
