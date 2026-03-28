<script lang="ts">
	import {
		ChatCircleDotsIcon,
		ChecksIcon,
		ShieldCheckIcon,
		TerminalWindowIcon,
		SpinnerGapIcon,
		XIcon
	} from 'phosphor-svelte';
	import type {
		CommandExecutionRequestApprovalParams,
		FileChangeRequestApprovalParams,
		PendingServerRequest,
		PermissionsRequestApprovalParams,
		ToolRequestUserInputParams
	} from '$lib/types';

	let {
		request,
		resolving = false,
		inline = false,
		onresolve
	}: {
		request: PendingServerRequest;
		resolving?: boolean;
		inline?: boolean;
		onresolve?: (payload: unknown) => void | Promise<void>;
	} = $props();

	let draftAnswers = $state<Record<string, string>>({});

	const panelClass = $derived.by(() =>
		inline
			? 'border border-line bg-[rgba(15,17,21,0.8)] p-[0.95rem] text-[13px] text-fg'
			: 'border border-line bg-surface-1 p-[0.95rem] text-[13px] text-fg'
	);
	const actionButtonClass =
		'inline-flex h-9 items-center justify-center border border-line px-3 text-[12px] font-medium text-fg transition-[border-color,color,background-color] duration-150 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-45';

	const commandParams = $derived.by<CommandExecutionRequestApprovalParams | null>(() =>
		request.method === 'item/commandExecution/requestApproval'
			? (request.params as CommandExecutionRequestApprovalParams)
			: null
	);
	const fileChangeParams = $derived.by<FileChangeRequestApprovalParams | null>(() =>
		request.method === 'item/fileChange/requestApproval'
			? (request.params as FileChangeRequestApprovalParams)
			: null
	);
	const permissionsParams = $derived.by<PermissionsRequestApprovalParams | null>(() =>
		request.method === 'item/permissions/requestApproval'
			? (request.params as PermissionsRequestApprovalParams)
			: null
	);
	const questionParams = $derived.by<ToolRequestUserInputParams | null>(() =>
		request.method === 'item/tool/requestUserInput'
			? (request.params as ToolRequestUserInputParams)
			: null
	);
	const canSubmitAnswers = $derived.by(() => {
		if (!questionParams) {
			return false;
		}

		return questionParams.questions.every((question) => (draftAnswers[question.id] ?? '').trim().length > 0);
	});

	function permissionSummary(params: PermissionsRequestApprovalParams): string[] {
		const lines: string[] = [];
		const fileSystem = params.permissions.fileSystem;
		if (fileSystem?.read?.length) {
			lines.push(`read ${fileSystem.read.join(', ')}`);
		}

		if (fileSystem?.write?.length) {
			lines.push(`write ${fileSystem.write.join(', ')}`);
		}

		if (params.permissions.network?.enabled) {
			lines.push('network access');
		}

		return lines;
	}

	function supportsCommandSessionDecision(params: CommandExecutionRequestApprovalParams): boolean {
		if (!params.availableDecisions?.length) {
			return true;
		}

		return params.availableDecisions.some((decision) => decision === 'acceptForSession');
	}

	async function resolveRequest(payload: unknown): Promise<void> {
		await onresolve?.(payload);
	}

	async function submitQuestionAnswers(): Promise<void> {
		if (!questionParams || !canSubmitAnswers) {
			return;
		}

		const answers = Object.fromEntries(
			questionParams.questions.map((question) => [
				question.id,
				{
					answers: [(draftAnswers[question.id] ?? '').trim()]
				}
			])
		);

		await resolveRequest({ answers });
	}
</script>

<section class={panelClass}>
	{#if commandParams}
		<div class="mb-3 flex items-start gap-3">
			<TerminalWindowIcon size={16} class="mt-[2px] shrink-0 text-accent" />
			<div class="min-w-0">
				<p class="mb-1 text-[12px] uppercase tracking-[0.14em] text-muted">Approval</p>
				<p class="mb-2 text-[13px] leading-[1.55] text-fg">{commandParams.reason ?? 'Command needs approval.'}</p>
				{#if commandParams.command}
					<pre class="overflow-x-auto border border-line bg-surface-0 px-3 py-2 font-mono text-[12px] leading-[1.55] text-fg">{commandParams.command}</pre>
				{/if}
			</div>
		</div>

		<div class="flex flex-wrap gap-2">
			<button
				type="button"
				class={actionButtonClass}
				disabled={resolving}
				onclick={() => void resolveRequest({ decision: 'accept' })}
			>
				<ChecksIcon size={14} />
				<span class="ml-2">Allow once</span>
			</button>
			{#if supportsCommandSessionDecision(commandParams)}
				<button
					type="button"
					class={actionButtonClass}
					disabled={resolving}
					onclick={() => void resolveRequest({ decision: 'acceptForSession' })}
				>
					<ShieldCheckIcon size={14} />
					<span class="ml-2">Allow session</span>
				</button>
			{/if}
			<button
				type="button"
				class={actionButtonClass}
				disabled={resolving}
				onclick={() => void resolveRequest({ decision: 'decline' })}
			>
				<XIcon size={14} />
				<span class="ml-2">Decline</span>
			</button>
		</div>
	{:else if fileChangeParams}
		<div class="mb-3 flex items-start gap-3">
			<ShieldCheckIcon size={16} class="mt-[2px] shrink-0 text-accent" />
			<div class="min-w-0">
				<p class="mb-1 text-[12px] uppercase tracking-[0.14em] text-muted">File Change</p>
				<p class="text-[13px] leading-[1.55] text-fg">{fileChangeParams.reason ?? 'File changes need approval.'}</p>
				{#if fileChangeParams.grantRoot}
					<p class="mt-2 font-mono text-[12px] text-muted">{fileChangeParams.grantRoot}</p>
				{/if}
			</div>
		</div>

		<div class="flex flex-wrap gap-2">
			<button
				type="button"
				class={actionButtonClass}
				disabled={resolving}
				onclick={() => void resolveRequest({ decision: 'accept' })}
			>
				Allow once
			</button>
			<button
				type="button"
				class={actionButtonClass}
				disabled={resolving}
				onclick={() => void resolveRequest({ decision: 'acceptForSession' })}
			>
				Allow session
			</button>
			<button
				type="button"
				class={actionButtonClass}
				disabled={resolving}
				onclick={() => void resolveRequest({ decision: 'decline' })}
			>
				Decline
			</button>
		</div>
	{:else if permissionsParams}
		<div class="mb-3 flex items-start gap-3">
			<ShieldCheckIcon size={16} class="mt-[2px] shrink-0 text-accent" />
			<div class="min-w-0">
				<p class="mb-1 text-[12px] uppercase tracking-[0.14em] text-muted">Permissions</p>
				<p class="mb-2 text-[13px] leading-[1.55] text-fg">{permissionsParams.reason ?? 'Additional access requested.'}</p>
				<div class="grid gap-1 font-mono text-[12px] text-muted">
					{#each permissionSummary(permissionsParams) as line}
						<span>{line}</span>
					{/each}
				</div>
			</div>
		</div>

		<div class="flex flex-wrap gap-2">
			<button
				type="button"
				class={actionButtonClass}
				disabled={resolving}
				onclick={() => void resolveRequest({ permissions: permissionsParams.permissions, scope: 'turn' })}
			>
				Allow once
			</button>
			<button
				type="button"
				class={actionButtonClass}
				disabled={resolving}
				onclick={() =>
					void resolveRequest({ permissions: permissionsParams.permissions, scope: 'session' })}
			>
				Allow session
			</button>
			<button
				type="button"
				class={actionButtonClass}
				disabled={resolving}
				onclick={() => void resolveRequest({ permissions: {}, scope: 'turn' })}
			>
				Deny
			</button>
		</div>
	{:else if questionParams}
		<div class="mb-3 flex items-start gap-3">
			<ChatCircleDotsIcon size={16} class="mt-[2px] shrink-0 text-accent" />
			<div class="min-w-0">
				<p class="mb-1 text-[12px] uppercase tracking-[0.14em] text-muted">Follow-up</p>
				<p class="text-[13px] leading-[1.55] text-fg">Answer to continue.</p>
			</div>
		</div>

		<div class="grid gap-4">
			{#each questionParams.questions as question (question.id)}
				<div class="grid gap-2">
					<div>
						<p class="mb-1 text-[12px] uppercase tracking-[0.14em] text-muted">{question.header}</p>
						<p class="text-[13px] leading-[1.55] text-fg">{question.question}</p>
					</div>

					{#if question.options?.length}
						<div class="grid gap-2">
							{#each question.options as option (option.label)}
								<label class="flex cursor-pointer gap-3 border border-line px-3 py-2 text-[13px] text-fg">
									<input
										type="radio"
										name={question.id}
										value={option.label}
										checked={draftAnswers[question.id] === option.label}
										onchange={() => {
											draftAnswers = {
												...draftAnswers,
												[question.id]: option.label
											};
										}}
										class="mt-1 h-3.5 w-3.5 accent-[var(--color-accent)]"
									/>
									<span class="min-w-0">
										<strong class="block font-medium">{option.label}</strong>
										<span class="block text-[12px] text-muted">{option.description}</span>
									</span>
								</label>
							{/each}
						</div>
					{:else}
						<input
							type={question.isSecret ? 'password' : 'text'}
							value={draftAnswers[question.id] ?? ''}
							oninput={(event) => {
								const nextValue = (event.currentTarget as HTMLInputElement).value;
								draftAnswers = {
									...draftAnswers,
									[question.id]: nextValue
								};
							}}
							class="h-10 border border-line bg-surface-0 px-3 text-[14px] text-fg outline-none placeholder:text-muted"
						/>
					{/if}
				</div>
			{/each}
		</div>

		<div class="mt-4 flex flex-wrap gap-2">
			<button
				type="button"
				class={actionButtonClass}
				disabled={resolving || !canSubmitAnswers}
				onclick={() => void submitQuestionAnswers()}
			>
				{#if resolving}
					<SpinnerGapIcon size={14} class="animate-spin" />
					<span class="ml-2">Sending</span>
				{:else}
					Submit
				{/if}
			</button>
		</div>

		{#if resolving}
			<p class="mt-3 font-mono text-[12px] text-muted">waiting for assistant to continue...</p>
		{/if}
	{/if}
</section>
