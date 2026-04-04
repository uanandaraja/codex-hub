<script lang="ts">
	import {
		ArchiveIcon,
		CaretDownIcon,
		CaretRightIcon,
		PlusIcon,
		PushPinIcon,
		SpinnerGapIcon,
		XIcon
	} from 'phosphor-svelte';
	import type { GatewayStatus } from '$lib/types';
	import SidebarAccountStatus from '$lib/components/SidebarAccountStatus.svelte';

	type SidebarThreadItem = {
		id: string;
		label: string;
		isSelected: boolean;
		isRunning: boolean;
		isArchiving: boolean;
	};

	type SidebarProjectItem = {
		path: string;
		name: string;
		isSelected: boolean;
		isExpanded: boolean;
		isPinned: boolean;
		isCreatingThread: boolean;
		isLoading: boolean;
		threads: SidebarThreadItem[];
	};

	let {
		open,
		banner,
		status,
		creatingThread = false,
		projects,
		onclose,
		onhome,
		onprojecttoggleexpand,
		onprojecttogglepin,
		onthreadcreate,
		onthreadselect,
		onthreadarchive
	}: {
		open: boolean;
		banner: string | null;
		status: GatewayStatus | null;
		creatingThread?: boolean;
		projects: SidebarProjectItem[];
		onclose?: () => void;
		onhome?: () => void;
		onprojecttoggleexpand?: (projectPath: string) => void | Promise<void>;
		onprojecttogglepin?: (projectPath: string) => void | Promise<void>;
		onthreadcreate?: (projectPath: string) => void | Promise<void>;
		onthreadselect?: (projectPath: string, threadId: string) => void | Promise<void>;
		onthreadarchive?: (projectPath: string, threadId: string) => void | Promise<void>;
	} = $props();

	const closeButtonClass =
		'inline-flex h-11 w-11 items-center justify-center border-0 bg-transparent text-fg transition-[background,border-color,color] duration-150 hover:text-accent disabled:cursor-default disabled:opacity-[0.45]';
	const projectRowClass =
		'group flex w-full min-w-0 items-center gap-1 border-0 border-l-2 border-l-transparent bg-transparent pl-[0.45rem] text-fg transition-[background-color,border-color] duration-150';
	const projectExpandButtonClass =
		'inline-flex h-9 w-9 shrink-0 items-center justify-center border-0 bg-transparent text-muted transition-colors duration-150 hover:text-fg';
	const projectSelectButtonClass =
		'flex min-w-0 flex-1 items-center border-0 bg-transparent py-[0.95rem] pr-2 text-left text-fg';
	const projectCreateButtonClass =
		'mr-[0.55rem] inline-flex h-8 w-8 shrink-0 items-center justify-center border-0 bg-surface-1 text-fg transition-[opacity,color,border-color,background-color] duration-150 min-[821px]:pointer-events-none min-[821px]:border-transparent min-[821px]:bg-transparent min-[821px]:text-muted min-[821px]:opacity-0 min-[821px]:group-hover:pointer-events-auto min-[821px]:group-hover:opacity-100 min-[821px]:group-focus-within:pointer-events-auto min-[821px]:group-focus-within:opacity-100 min-[821px]:hover:border-line min-[821px]:hover:text-fg min-[821px]:focus-visible:border-line min-[821px]:focus-visible:text-fg disabled:cursor-default disabled:opacity-40';
	const projectPinButtonClass =
		'pointer-events-none inline-flex h-8 w-8 shrink-0 items-center justify-center border border-transparent bg-transparent text-muted opacity-0 transition-[opacity,color,border-color,background-color] duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 hover:border-line hover:text-fg focus-visible:border-line focus-visible:text-fg';
	const chatRowClass =
		'thread-row group relative grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-stretch border-0 border-l-[3px] border-l-transparent bg-transparent text-left text-fg transition-[background-color,border-color,color] duration-150 hover:bg-surface-2';
	const chatSelectButtonClass =
		'flex h-full min-w-0 items-center gap-3 border-0 bg-transparent px-[1.1rem] py-[0.82rem] pl-[1.85rem] pr-1 text-left text-fg';
	const threadArchiveButtonClass =
		'thread-archive-button pointer-events-none mr-[0.55rem] inline-flex h-8 w-8 shrink-0 self-center items-center justify-center border border-transparent bg-transparent text-muted opacity-0 transition-[opacity,color,border-color] duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 hover:border-line hover:text-fg focus-visible:border-line focus-visible:text-fg disabled:cursor-default disabled:opacity-40';
</script>

<style>
	.thread-row--selected {
		background: var(--color-surface-2);
	}
</style>

{#if open}
	<button
		type="button"
		class="fixed inset-0 z-30 bg-black/60 min-[821px]:hidden"
		onclick={onclose}
		aria-label="Close sidebar"
	></button>
{/if}

<aside
	class={`fixed inset-y-0 left-0 z-40 flex w-[16.75rem] max-w-[calc(100vw-2.5rem)] min-w-0 flex-col overflow-hidden rounded-none border-r border-line bg-surface-1 transition-transform duration-200 ease-out ${open ? 'translate-x-0' : '-translate-x-full'}`}
>
	<div
		class="flex min-h-[4.9rem] min-w-0 items-center justify-between gap-3 rounded-none border-b border-line px-[1.1rem] py-[1.05rem]"
	>
		<button
			type="button"
			class="flex min-w-0 flex-1 items-center border-0 bg-transparent p-0 text-left"
			onclick={onhome}
			aria-label="Go to home"
		>
			<h1 class="truncate text-[0.95rem] font-medium uppercase tracking-[0.12em] text-muted">
				Codex Hub
			</h1>
		</button>

		<div class="flex shrink-0 items-center gap-2">
			<button class={closeButtonClass} type="button" onclick={onclose} aria-label="Hide sidebar">
				<XIcon size={18} />
			</button>
		</div>
	</div>

	<div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-[1.1rem]">
		{#if banner}
			<div
				class="mx-[1.1rem] mt-4 border border-notice-soft-line bg-notice-soft-fill p-[0.85rem] text-[0.82rem] text-notice"
			>
				{banner}
			</div>
		{/if}

		<div class="mt-4">
			{#each projects as project, index (project.path)}
				<section class:border-t={index > 0} class:border-line={index > 0}>
					<div
						class={projectRowClass}
						class:border-l-accent={project.isSelected}
						class:bg-surface-2={project.isSelected}
					>
						<button
							type="button"
							class={projectExpandButtonClass}
							onclick={() => void onprojecttoggleexpand?.(project.path)}
							aria-label={project.isExpanded ? 'Collapse project' : 'Expand project'}
							aria-expanded={project.isExpanded}
						>
							{#if project.isExpanded}
								<CaretDownIcon size={15} />
							{:else}
								<CaretRightIcon size={15} />
							{/if}
						</button>
						<button
							type="button"
							class={projectSelectButtonClass}
							onclick={() => void onprojecttoggleexpand?.(project.path)}
							aria-expanded={project.isExpanded}
						>
							<span class="min-w-0 flex-1 truncate font-sans text-[0.85rem]">{project.name}</span>
						</button>
						<button
							type="button"
							class={projectPinButtonClass}
							class:pointer-events-auto={project.isPinned}
							class:opacity-100={project.isPinned}
							class:border-line={project.isPinned}
							class:bg-surface-1={project.isPinned}
							class:text-accent={project.isPinned}
							onclick={() => void onprojecttogglepin?.(project.path)}
							aria-label={project.isPinned ? 'Unpin project' : 'Pin project'}
							title={project.isPinned ? 'Unpin project' : 'Pin project'}
						>
							<PushPinIcon size={14} weight={project.isPinned ? 'fill' : 'regular'} />
						</button>
						<button
							type="button"
							class={`${projectCreateButtonClass} ${
								project.isSelected || project.isCreatingThread
									? 'pointer-events-auto opacity-100 border-line bg-surface-1'
									: ''
							} ${project.isCreatingThread ? 'text-accent' : project.isSelected ? 'text-fg' : ''}`}
							onclick={() => void onthreadcreate?.(project.path)}
							disabled={creatingThread}
							aria-label={project.isCreatingThread
								? `Creating chat in ${project.name}`
								: `New chat in ${project.name}`}
							aria-busy={project.isCreatingThread}
							title={project.isCreatingThread
								? `Creating chat in ${project.name}`
								: `New chat in ${project.name}`}
						>
							{#if project.isCreatingThread}
								<SpinnerGapIcon size={14} class="animate-spin" />
							{:else}
								<PlusIcon size={14} />
							{/if}
						</button>
					</div>

					{#if project.isExpanded}
						<div class="pb-2">
							{#if project.isLoading}
								<div class="px-[1.1rem] py-3 pl-[1.85rem] font-mono text-[0.78rem] text-muted">
									loading chats...
								</div>
							{:else if project.threads.length === 0}
								<div class="px-[1.1rem] py-3 pl-[1.85rem] font-mono text-[0.78rem] text-muted">
									no chats yet
								</div>
							{:else}
								{#each project.threads as thread (thread.id)}
									<div
										class={chatRowClass}
										class:thread-row--selected={thread.isSelected}
									>
										<button
											type="button"
											class={chatSelectButtonClass}
											onclick={() => void onthreadselect?.(project.path, thread.id)}
											aria-current={thread.isSelected ? 'page' : undefined}
										>
											<span class="flex min-w-0 flex-1 items-center gap-2 text-[0.79rem]">
												<span class="min-w-0 flex-1 truncate">{thread.label}</span>
												{#if thread.isRunning}
													<SpinnerGapIcon size={13} class="shrink-0 animate-spin text-accent" />
												{/if}
											</span>
										</button>
										<button
											type="button"
											class={threadArchiveButtonClass}
											disabled={thread.isArchiving || thread.isRunning}
											onclick={() => void onthreadarchive?.(project.path, thread.id)}
											aria-label={`Archive ${thread.label}`}
											title={thread.isRunning ? 'Active chats cannot be archived' : 'Archive chat'}
										>
											<ArchiveIcon size={14} />
										</button>
									</div>
								{/each}
							{/if}
						</div>
					{/if}
				</section>
			{:else}
				<div
					class="grid gap-[0.35rem] border-t border-line px-[1.1rem] py-4 font-mono text-[0.78rem] text-muted"
				>
					<span class="font-semibold text-fg">no projects yet</span>
					<span>projects appear once they have codex chats</span>
				</div>
			{/each}
		</div>
	</div>

	<SidebarAccountStatus {status} />
</aside>
