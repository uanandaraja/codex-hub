import { gatewayJson } from '$lib/server/gateway';
import type { GatewayStatus, ProjectListResponse, ThreadListResponse } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [statusResult, projectsResult] = await Promise.allSettled([
		gatewayJson<GatewayStatus>('/v1/status'),
		gatewayJson<ProjectListResponse>('/v1/projects')
	]);

	const initialProjectPath =
		projectsResult.status === 'fulfilled' ? projectsResult.value.data[0]?.path ?? null : null;

	let threads: ThreadListResponse['data'] = [];
	let threadsError: string | null = null;

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

	return {
		status: statusResult.status === 'fulfilled' ? statusResult.value : null,
		projects: projectsResult.status === 'fulfilled' ? projectsResult.value.data : [],
		threads,
		initialProjectPath,
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
