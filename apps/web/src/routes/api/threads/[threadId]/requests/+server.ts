import { gatewayJson } from '$lib/server/gateway';
import type { PendingServerRequestListResponse } from '$lib/types';
import { json } from '@sveltejs/kit';

export async function GET({ params }) {
	return json(
		await gatewayJson<PendingServerRequestListResponse>(
			`/v1/threads/${encodeURIComponent(params.threadId)}/server-requests`
		)
	);
}
