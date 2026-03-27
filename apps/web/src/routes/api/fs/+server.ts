import { gatewayFetch } from '$lib/server/gateway';
import { json } from '@sveltejs/kit';

export async function GET({ url }) {
	const path = url.searchParams.get('path');
	const response = await gatewayFetch(`/v1/fs?path=${encodeURIComponent(path ?? '')}`);
	return json(await response.json(), { status: response.status });
}

export async function PUT({ request }) {
	const body = await request.json();
	const response = await gatewayFetch('/v1/fs', {
		method: 'PUT',
		headers: {
			'content-type': 'application/json'
		},
		body: JSON.stringify(body)
	});
	return json(await response.json(), { status: response.status });
}
