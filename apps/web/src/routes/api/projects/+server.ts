import { gatewayJson } from '$lib/server/gateway';
import type { ProjectListResponse } from '$lib/types';
import { json } from '@sveltejs/kit';

export async function GET({ url }) {
	const searchParams = new URLSearchParams(url.searchParams);
	if (!searchParams.has('archived')) {
		searchParams.set('archived', 'false');
	}

	return json(await gatewayJson<ProjectListResponse>(`/v1/projects?${searchParams.toString()}`));
}
