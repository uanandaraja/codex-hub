import { gatewayJson } from '$lib/server/gateway';
import type { GatewayStatus } from '$lib/types';
import { json } from '@sveltejs/kit';

export async function GET() {
	return json(await gatewayJson<GatewayStatus>('/v1/status'));
}
