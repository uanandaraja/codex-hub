import { Buffer } from 'node:buffer';
import { gatewayFetch } from '$lib/server/gateway';
import { json } from '@sveltejs/kit';

export async function POST({ params, request }) {
	const body = await readTurnBody(request);
	const response = await gatewayFetch(`/v1/threads/${encodeURIComponent(params.threadId)}/turns`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json'
		},
		body: JSON.stringify(body)
	});
	return json(await response.json(), { status: response.status });
}

async function readTurnBody(request: Request): Promise<Record<string, unknown>> {
	const contentType = request.headers.get('content-type') ?? '';
	if (!contentType.includes('multipart/form-data')) {
		return await request.json();
	}

	const formData = await request.formData();
	const attachments = await Promise.all(
		formData
			.getAll('attachments')
			.filter((entry): entry is File => entry instanceof File && entry.size > 0)
			.map(async (entry) => ({
				name: entry.name,
				type: entry.type,
				dataBase64: Buffer.from(await entry.arrayBuffer()).toString('base64')
			}))
	);

	return {
		message: readOptionalString(formData.get('message')) ?? '',
		model: readOptionalString(formData.get('model')),
		effort: readOptionalString(formData.get('effort')),
		mode: readOptionalString(formData.get('mode')),
		approvalPolicy: readOptionalString(formData.get('approvalPolicy')),
		sandbox: readOptionalString(formData.get('sandbox')),
		attachments
	};
}

function readOptionalString(value: FormDataEntryValue | null): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}
