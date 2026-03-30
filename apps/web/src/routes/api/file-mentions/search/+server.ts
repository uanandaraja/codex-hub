import { gatewayFetch } from '$lib/server/gateway';
import { json } from '@sveltejs/kit';

export async function GET({ url }) {
	const query = url.searchParams.get('query') ?? '';
	const projectPath = url.searchParams.get('projectPath') ?? '';
	const response = await gatewayFetch(
		`/v1/fuzzy-file-search?query=${encodeURIComponent(query)}&root=${encodeURIComponent(projectPath)}`
	);
	return json(await response.json(), { status: response.status });
}
