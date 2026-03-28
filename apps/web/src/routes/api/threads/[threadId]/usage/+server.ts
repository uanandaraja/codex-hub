import { gatewayJson } from '$lib/server/gateway';
import type { ThreadUsageResponse } from '$lib/types';
import { json } from '@sveltejs/kit';

export async function GET({ params }) {
	return json(
		await gatewayJson<ThreadUsageResponse>(
			`/v1/threads/${encodeURIComponent(params.threadId)}/usage`
		)
	);
}
