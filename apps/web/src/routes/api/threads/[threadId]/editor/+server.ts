import { buildEditorUrl, isEditorConfigured, resolveThreadProjectPath } from '$lib/server/editor';
import { GatewayResponseError, gatewayJson } from '$lib/server/gateway';
import type { ThreadReadResponse } from '$lib/types';
import { json, redirect } from '@sveltejs/kit';

export async function GET({ params }) {
	if (!isEditorConfigured()) {
		return json(
			{
				error: {
					message: 'Editor integration is not configured. Set EDITOR_BASE_URL in apps/web/.env.'
				}
			},
			{ status: 503 }
		);
	}

	let editorUrl = '';

	try {
		const threadResult = await gatewayJson<ThreadReadResponse>(
			`/v1/threads/${encodeURIComponent(params.threadId)}?includeTurns=false`
		);
		const projectPath = resolveThreadProjectPath(threadResult.thread);
		editorUrl = buildEditorUrl(projectPath);
	} catch (error) {
		if (error instanceof GatewayResponseError) {
			return json(error.body ?? { error: { message: error.message } }, { status: error.status });
		}

		return json(
			{
				error: {
					message: error instanceof Error ? error.message : 'Failed to open editor.'
				}
			},
			{ status: 500 }
		);
	}

	throw redirect(302, editorUrl);
}
