import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { json } from '@sveltejs/kit';

const execFileAsync = promisify(execFile);

export async function GET({ url }) {
	const projectPath = url.searchParams.get('projectPath');
	if (!projectPath) {
		return json({ error: { message: 'projectPath is required.' } }, { status: 400 });
	}

	try {
		await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
			cwd: projectPath
		});
	} catch {
		return json({ data: { patch: '' } });
	}

	try {
		const { stdout } = await execFileAsync(
			'git',
			['diff', '--no-ext-diff', '--submodule=diff', '--binary', '--', '.'],
			{
				cwd: projectPath,
				maxBuffer: 16 * 1024 * 1024
			}
		);

		return json({ data: { patch: stdout } });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to read git diff.';
		return json({ error: { message } }, { status: 500 });
	}
}
