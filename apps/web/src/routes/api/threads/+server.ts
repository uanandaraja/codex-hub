import { gatewayFetch, gatewayJson } from '$lib/server/gateway';
import type { ThreadListResponse, ThreadStartResponse } from '$lib/types';
import { json } from '@sveltejs/kit';

export async function GET({ url }) {
	const searchParams = new URLSearchParams(url.searchParams);
	if (!searchParams.has('archived')) {
		searchParams.set('archived', 'false');
	}

	const search = searchParams.toString();
	const suffix = search ? `?${search}` : '';
	return json(await gatewayJson<ThreadListResponse>(`/v1/threads${suffix}`));
}

export async function POST({ request }) {
	const body = await request.json();
	const response = await gatewayFetch('/v1/threads', {
		method: 'POST',
		headers: {
			'content-type': 'application/json'
		},
		body: JSON.stringify(body)
	});
	return json((await response.json()) as ThreadStartResponse, { status: response.status });
}
