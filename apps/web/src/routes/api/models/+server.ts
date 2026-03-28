import { gatewayJson } from '$lib/server/gateway';
import type { ModelListResponse } from '$lib/types';
import { json } from '@sveltejs/kit';

export async function GET() {
	return json(await gatewayJson<ModelListResponse>('/v1/models'));
}
