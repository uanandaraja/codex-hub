import { gatewayJson } from '$lib/server/gateway';
import type { ThreadReadResponse } from '$lib/types';
import { json } from '@sveltejs/kit';

export async function GET({ params, url }) {
	const includeTurns = url.searchParams.get('includeTurns') ?? 'true';
	return json(
		await gatewayJson<ThreadReadResponse>(
			`/v1/threads/${encodeURIComponent(params.threadId)}?includeTurns=${includeTurns}`
		)
	);
}
