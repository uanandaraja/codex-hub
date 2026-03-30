import { gatewayFetch } from '$lib/server/gateway';

export async function GET({ url }) {
	const search = url.searchParams.toString();
	const suffix = search ? `?${search}` : '';
	const upstream = await gatewayFetch(`/v1/input-images${suffix}`);
	const headers = new Headers();
	const contentType = upstream.headers.get('content-type');
	const cacheControl = upstream.headers.get('cache-control');
	const contentLength = upstream.headers.get('content-length');
	if (contentType) {
		headers.set('content-type', contentType);
	}
	if (cacheControl) {
		headers.set('cache-control', cacheControl);
	}
	if (contentLength) {
		headers.set('content-length', contentLength);
	}

	return new Response(upstream.body, {
		status: upstream.status,
		headers
	});
}
