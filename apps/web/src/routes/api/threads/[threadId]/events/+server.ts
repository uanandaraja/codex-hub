import { gatewayFetch } from '$lib/server/gateway';

export async function GET({ params }) {
	const upstream = await gatewayFetch(`/v1/threads/${encodeURIComponent(params.threadId)}/events`);

	return new Response(upstream.body, {
		status: upstream.status,
		headers: {
			'content-type': upstream.headers.get('content-type') ?? 'text/event-stream',
			'cache-control': upstream.headers.get('cache-control') ?? 'no-cache, no-transform',
			connection: upstream.headers.get('connection') ?? 'keep-alive',
			'x-accel-buffering': upstream.headers.get('x-accel-buffering') ?? 'no'
		}
	});
}
