<script lang="ts">
	import TurnStatusNote from '$lib/components/TurnStatusNote.svelte';
	import type { CodexThreadItem } from '$lib/types';

	type CommandExecutionItem = Extract<CodexThreadItem, { type: 'commandExecution' }>;
	type FileChangeItem = Extract<CodexThreadItem, { type: 'fileChange' }>;
	type ToolItem = CommandExecutionItem | FileChangeItem;
	type ShellTokenTone = 'plain' | 'command' | 'flag' | 'string' | 'path' | 'operator';
	type ChangeLineTone = 'add' | 'delete' | 'update' | 'move';

	let {
		item,
		projectsRoot = '',
		streaming = false,
		interrupted = false,
		elapsedSeconds = null,
		showStatusNote = false,
		contextLeftPercent = null
	}: {
		item: ToolItem;
		projectsRoot?: string;
		streaming?: boolean;
		interrupted?: boolean;
		elapsedSeconds?: number | null;
		showStatusNote?: boolean;
		contextLeftPercent?: number | null;
	} = $props();

	const displayCommand = $derived.by(() =>
		item.type === 'commandExecution' ? extractShellCommand(item.command) : ''
	);
	const shellTokens = $derived.by(() =>
		item.type === 'commandExecution' ? tokenizeShell(displayCommand) : []
	);
	const commandStateClass = $derived.by(() => {
		if (item.type !== 'commandExecution') {
			return 'text-fg';
		}

		if (item.status === 'failed' || (item.exitCode !== null && item.exitCode !== 0)) {
			return 'text-notice';
		}

		if (item.status === 'in_progress' || item.status === 'running' || item.status === 'pending') {
			return 'text-accent';
		}

		return 'text-fg';
	});
	const commandLabel = $derived.by(() =>
		item.type === 'commandExecution' ? getCommandLabel(item) : ''
	);
	const fileChangeLines = $derived.by(() =>
		item.type === 'fileChange' ? buildFileChangeLines(item, projectsRoot) : []
	);
	const toolBlockClass =
		'min-w-0 overflow-x-auto whitespace-pre-wrap break-words border-l border-line pl-3 font-mono text-[12px] leading-[1.55] [overflow-wrap:anywhere]';
	const toolWrapperClass = $derived(showStatusNote ? 'mb-4 w-full min-w-0' : 'mb-3 w-full min-w-0');

	function extractShellCommand(command: string): string {
		const marker = ' -lc ';
		const markerIndex = command.lastIndexOf(marker);
		if (markerIndex < 0) {
			return command;
		}

		const payload = command.slice(markerIndex + marker.length).trim();
		if (payload.length < 2) {
			return command;
		}

		if (
			(payload.startsWith("'") && payload.endsWith("'")) ||
			(payload.startsWith('"') && payload.endsWith('"'))
		) {
			return payload.slice(1, -1);
		}

		return payload;
	}

	function tokenizeShell(command: string): Array<{ value: string; tone: ShellTokenTone }> {
		const parts =
			command.match(
				/(?:\.\.?\/|~\/|\/)[^\s"'`|&;()]+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|--?[A-Za-z0-9][\w.-]*|&&|\|\||[|;()]+|\s+|[^\s"'`|&;()]+/g
			) ?? [command];
		let expectsCommand = true;

		return parts.map((part) => {
			if (/^\s+$/.test(part)) {
				return { value: part, tone: 'plain' };
			}

			if (/^(?:&&|\|\||[|;()])+$/.test(part)) {
				expectsCommand = true;
				return { value: part, tone: 'operator' };
			}

			if (/^['"]/.test(part)) {
				return { value: part, tone: 'string' };
			}

			if (/^--?/.test(part)) {
				expectsCommand = false;
				return { value: part, tone: 'flag' };
			}

			if (/^(?:\.\.?\/|~\/|\/)/.test(part)) {
				expectsCommand = false;
				return { value: part, tone: 'path' };
			}

			if (expectsCommand) {
				expectsCommand = false;
				return { value: part, tone: 'command' };
			}

			return { value: part, tone: 'plain' };
		});
	}

	function getCommandLabel(item: CommandExecutionItem): string {
		if (item.status === 'in_progress' || item.status === 'running' || item.status === 'pending') {
			return 'Running';
		}

		if (item.status === 'failed' || (item.exitCode !== null && item.exitCode !== 0)) {
			return 'Failed';
		}

		return 'Ran';
	}

	function buildFileChangeLines(item: FileChangeItem, root: string): Array<{
		prefix: string;
		text: string;
		tone: ChangeLineTone;
	}> {
		return item.changes.map((change) => {
			if (change.kind.type === 'update' && change.kind.move_path) {
				return {
					prefix: '→',
					text: `${formatPath(change.path, root)} -> ${formatPath(change.kind.move_path, root)}`,
					tone: 'move'
				};
			}

			if (change.kind.type === 'add') {
				return {
					prefix: '+',
					text: formatPath(change.path, root),
					tone: 'add'
				};
			}

			if (change.kind.type === 'delete') {
				return {
					prefix: '-',
					text: formatPath(change.path, root),
					tone: 'delete'
				};
			}

			return {
				prefix: '~',
				text: formatPath(change.path, root),
				tone: 'update'
			};
		});
	}

	function formatPath(value: string, root: string): string {
		if (root && value.startsWith(root)) {
			const relative = value.slice(root.length).replace(/^\/+/, '');
			return relative ? `~/${relative}` : '~';
		}

		return value;
	}

	function shellTokenClass(tone: ShellTokenTone): string {
		switch (tone) {
			case 'command':
				return 'text-accent';
			case 'flag':
				return 'text-muted';
			case 'string':
				return 'text-success';
			case 'path':
				return 'text-notice';
			case 'operator':
				return 'text-muted';
			default:
				return 'text-fg';
		}
	}

	function fileChangeLineClass(tone: ChangeLineTone): string {
		switch (tone) {
			case 'add':
				return 'text-success';
			case 'delete':
				return 'text-notice';
			case 'move':
				return 'text-accent';
			default:
				return 'text-fg';
		}
	}

	function fileChangeLabel(tone: ChangeLineTone): string {
		switch (tone) {
			case 'add':
				return 'Added';
			case 'delete':
				return 'Deleted';
			case 'move':
				return 'Moved';
			default:
				return 'Updated';
		}
	}
</script>

{#if item.type === 'commandExecution'}
	<div class={toolWrapperClass}>
		<div class={`tool-activity-shell ${toolBlockClass} ${commandStateClass}`}>
			<p class="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1 text-[12px] leading-[1.55]">
				<span class="shrink-0 text-muted">{commandLabel}</span>
				<span class="shrink-0 text-muted">$</span>
				<span class="min-w-0 break-words [overflow-wrap:anywhere]">
					{#each shellTokens as token}
						<span class={shellTokenClass(token.tone)}>{token.value}</span>
					{/each}
				</span>
			</p>
		</div>
		{#if showStatusNote}
			<TurnStatusNote {streaming} {interrupted} {elapsedSeconds} {contextLeftPercent} />
		{/if}
	</div>
{:else if fileChangeLines.length > 0}
	<div class={toolWrapperClass}>
		<div class={`tool-activity-shell ${toolBlockClass} grid gap-1`}>
			{#each fileChangeLines as line}
				<p class="flex min-w-0 gap-2 text-[12px] leading-[1.55]">
					<span class="shrink-0 text-muted">{fileChangeLabel(line.tone)}</span>
					<span class={`min-w-0 break-words [overflow-wrap:anywhere] ${fileChangeLineClass(line.tone)}`}>
						{line.text}
					</span>
				</p>
			{/each}
		</div>
		{#if showStatusNote}
			<TurnStatusNote {streaming} {interrupted} {elapsedSeconds} {contextLeftPercent} />
		{/if}
	</div>
{/if}

<style>
	.tool-activity-shell,
	.tool-activity-shell :global(*),
	.tool-activity-shell :global(*::before),
	.tool-activity-shell :global(*::after) {
		border-radius: 0 !important;
	}
</style>
