import { gatewayJson } from '$lib/server/gateway';
import type { ThreadReadResponse } from '$lib/types';
import { json } from '@sveltejs/kit';

export async function GET({ params, url }) {
	const includeTurns = url.searchParams.get('includeTurns') ?? 'true';
	const includeUsage = url.searchParams.get('includeUsage') ?? 'true';
	const tailTurns = url.searchParams.get('tailTurns');
	const searchParams = new URLSearchParams({
		includeTurns,
		includeUsage
	});
	if (tailTurns) {
		searchParams.set('tailTurns', tailTurns);
	}

	return json(
		await gatewayJson<ThreadReadResponse>(
			`/v1/threads/${encodeURIComponent(params.threadId)}?${searchParams.toString()}`
		)
	);
}
