import { gatewayFetch } from '$lib/server/gateway';
import { json } from '@sveltejs/kit';

export async function POST({ params, request }) {
	const body = await request.json().catch(() => ({}));
	const response = await gatewayFetch(`/v1/threads/${encodeURIComponent(params.threadId)}/interrupt`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json'
		},
		body: JSON.stringify(body)
	});
	return json(await response.json(), { status: response.status });
}
