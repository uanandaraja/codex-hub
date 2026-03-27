import { env } from '$env/dynamic/private';

const baseUrl = env.GATEWAY_BASE_URL ?? 'http://127.0.0.1:8787';

export class GatewayResponseError extends Error {
	status: number;
	body: unknown;

	constructor(status: number, body: unknown) {
		super(`Gateway request failed with status ${status}`);
		this.name = 'GatewayResponseError';
		this.status = status;
		this.body = body;
	}
}

export async function gatewayFetch(path: string, init?: RequestInit): Promise<Response> {
	return fetch(`${baseUrl}${path}`, init);
}

export async function gatewayJson<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await gatewayFetch(path, init);
	let body: unknown = null;

	try {
		body = await response.json();
	} catch {
		body = null;
	}

	if (!response.ok) {
		throw new GatewayResponseError(response.status, body);
	}

	return body as T;
}
