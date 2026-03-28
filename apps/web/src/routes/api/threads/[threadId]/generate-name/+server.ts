import { gatewayFetch } from '$lib/server/gateway';
import { json } from '@sveltejs/kit';

export async function POST({ params }) {
	const response = await gatewayFetch(
		`/v1/threads/${encodeURIComponent(params.threadId)}/generate-name`,
		{
			method: 'POST'
		}
	);

	return json(await response.json(), { status: response.status });
}
