import { gatewayJson } from '$lib/server/gateway';
import type { ProjectListResponse } from '$lib/types';
import { json } from '@sveltejs/kit';

export async function GET() {
	return json(await gatewayJson<ProjectListResponse>('/v1/projects'));
}
