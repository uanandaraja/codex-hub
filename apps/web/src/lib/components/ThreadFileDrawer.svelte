<script lang="ts">
	import type { FileContents } from '@pierre/diffs';
	import { FileCodeIcon, SpinnerGapIcon, XIcon } from 'phosphor-svelte';
	import vscodeLogo from '$lib/assets/vscode.svg';
	import OpencodeFileIcon from '$lib/components/OpencodeFileIcon.svelte';
	import ThreadFileContents from '$lib/components/ThreadFileContents.svelte';
	import ThreadFileTree from '$lib/components/ThreadFileTree.svelte';
	import type { DirectoryEntry, FileNode, FsNode } from '$lib/types';

	let {
		projectPath = null,
		editorHref = null,
		onclose
	}: {
		projectPath?: string | null;
		editorHref?: string | null;
		onclose?: () => void;
	} = $props();

	let directoryEntriesByPath = $state<Record<string, DirectoryEntry[]>>({});
	let expandedPaths = $state<Record<string, boolean>>({});
	let loadingPaths = $state<Record<string, true>>({});
	let fileContentsByPath = $state<Record<string, FileNode>>({});
	let selectedFilePath = $state<string | null>(null);
	let selectedFileLoading = $state(false);
	let fileBrowserError = $state<string | null>(null);

	const rootEntries = $derived.by(() => (projectPath ? (directoryEntriesByPath[projectPath] ?? []) : []));
	const selectedFileNode = $derived.by(() =>
		selectedFilePath ? (fileContentsByPath[selectedFilePath] ?? null) : null
	);
	const selectedPierreFile = $derived.by<FileContents | null>(() =>
		selectedFileNode && !selectedFileNode.isBinary && selectedFileNode.text !== null
			? {
					name: fileNameFromPath(selectedFileNode.path),
					contents: selectedFileNode.text,
					cacheKey: `${selectedFileNode.path}:${selectedFileNode.modifiedAtMs}:${selectedFileNode.byteLength}`
				}
			: null
	);
	const filePreviewOpen = $derived.by(() => Boolean(selectedFilePath));

	$effect(() => {
		projectPath;
		directoryEntriesByPath = {};
		expandedPaths = {};
		loadingPaths = {};
		fileContentsByPath = {};
		selectedFilePath = null;
		selectedFileLoading = false;
		fileBrowserError = null;
	});

	$effect(() => {
		if (!projectPath || rootEntries.length > 0 || loadingPaths[projectPath]) {
			return;
		}

		void loadDirectory(projectPath);
	});

	function toggleDirectory(path: string): void {
		expandedPaths = {
			...expandedPaths,
			[path]: !expandedPaths[path]
		};
	}

	async function loadDirectory(path: string): Promise<void> {
		if (loadingPaths[path]) {
			return;
		}

		loadingPaths = {
			...loadingPaths,
			[path]: true
		};
		fileBrowserError = null;

		try {
			const response = await fetch(`/api/fs?path=${encodeURIComponent(path)}`);
			const payload = (await response.json()) as FsNode & {
				error?: {
					message?: string;
				};
			};

			if (!response.ok || payload.kind !== 'directory') {
				throw new Error(payload.error?.message ?? 'Failed to read directory.');
			}

			directoryEntriesByPath = {
				...directoryEntriesByPath,
				[path]: payload.entries
			};
		} catch (error) {
			fileBrowserError = error instanceof Error ? error.message : 'Failed to read directory.';
		} finally {
			const nextLoadingPaths = { ...loadingPaths };
			delete nextLoadingPaths[path];
			loadingPaths = nextLoadingPaths;
		}
	}

	async function selectFile(path: string): Promise<void> {
		selectedFilePath = path;
		fileBrowserError = null;

		if (fileContentsByPath[path]) {
			return;
		}

		selectedFileLoading = true;

		try {
			const response = await fetch(`/api/fs?path=${encodeURIComponent(path)}`);
			const payload = (await response.json()) as FsNode & {
				error?: {
					message?: string;
				};
			};

			if (!response.ok || payload.kind !== 'file') {
				throw new Error(payload.error?.message ?? 'Failed to read file.');
			}

			fileContentsByPath = {
				...fileContentsByPath,
				[path]: payload
			};
		} catch (error) {
			fileBrowserError = error instanceof Error ? error.message : 'Failed to read file.';
		} finally {
			selectedFileLoading = false;
		}
	}

	function fileNameFromPath(path: string): string {
		const segments = path.split('/').filter(Boolean);
		return segments.at(-1) ?? path;
	}

</script>

<aside
	class="absolute inset-y-0 right-0 z-[3] hidden w-[min(56vw,64rem)] rounded-none flex-col border-l border-line bg-surface-1 min-[821px]:flex"
	aria-label="Thread files"
>
	<div class="flex min-h-[3.6rem] items-center justify-between gap-2 rounded-none border-b border-line px-3">
		<div class="flex min-w-0 items-center gap-1.5">
			<FileCodeIcon size={16} class="text-muted" />
			<h2 class="truncate text-[0.82rem] font-medium uppercase tracking-[0.12em] text-fg">Files</h2>
		</div>

		<div class="flex items-center gap-1">
			{#if editorHref}
				<a
					class="inline-flex h-8 items-center justify-center gap-1.5 rounded-none border-0 bg-transparent px-1.5 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-muted transition-colors duration-150 hover:text-fg"
					href={editorHref}
					target="_blank"
					rel="noreferrer"
					aria-label="Open current thread project in editor"
				>
					<img class="h-4 w-4 shrink-0" src={vscodeLogo} alt="" />
					<span>Open in Editor</span>
				</a>
			{/if}

			<button
				type="button"
				class="inline-flex h-8 w-8 items-center justify-center rounded-none border-0 bg-transparent text-muted transition-colors duration-150 hover:text-fg"
				onclick={onclose}
				aria-label="Close files"
			>
				<XIcon size={18} />
			</button>
		</div>
	</div>

	<div class="min-h-0 flex-1 overflow-hidden">
		{#if projectPath}
			<div
				class={`grid h-full min-h-0 overflow-hidden rounded-none border border-line bg-surface-0 ${
					filePreviewOpen
						? 'grid-cols-[minmax(11rem,14rem)_minmax(0,1fr)]'
						: 'grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]'
				}`}
			>
				<div class="min-h-0 overflow-y-auto border-r border-line py-2">
					{#if rootEntries.length > 0}
						<div class="px-1 pb-2">
							<ThreadFileTree
								entries={rootEntries}
								{expandedPaths}
								{loadingPaths}
								{selectedFilePath}
								{directoryEntriesByPath}
								ontoggledirectory={toggleDirectory}
								onselectfile={selectFile}
								onloaddirectory={loadDirectory}
							/>
						</div>
					{:else if loadingPaths[projectPath]}
						<div class="flex items-center gap-2 px-3 py-3 font-mono text-[0.72rem] text-muted">
							<SpinnerGapIcon size={13} class="animate-spin" />
							<span>Loading files...</span>
						</div>
					{:else}
						<div class="px-3 py-3 font-mono text-[0.72rem] text-muted">No files found.</div>
					{/if}
				</div>

				<div class="min-h-0 overflow-y-auto overflow-x-hidden bg-surface-1">
					{#if selectedFileLoading}
						<div class="flex h-full items-center justify-center gap-2 px-6 py-8 font-mono text-[0.76rem] text-muted">
							<SpinnerGapIcon size={14} class="animate-spin" />
							<span>Loading file...</span>
						</div>
					{:else if fileBrowserError}
						<div class="px-6 py-8">
							<p class="font-mono text-[0.76rem] text-notice">{fileBrowserError}</p>
						</div>
					{:else if selectedFileNode}
						<div class="min-h-full">
							<div class="border-b border-line bg-surface-0">
								<div
									class="inline-flex max-w-full items-center gap-2 border border-line bg-surface-1 pl-3 pr-2 text-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
								>
									<OpencodeFileIcon path={selectedFileNode.path} type="file" size={16} />
									<div class="min-w-0 py-2">
										<p class="truncate text-[0.86rem] font-medium tracking-[0.01em] text-fg">
											{fileNameFromPath(selectedFileNode.path)}
										</p>
									</div>
									<button
										type="button"
										class="ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center border-0 bg-transparent text-muted transition-colors duration-150 hover:text-fg"
										onclick={() => {
											selectedFilePath = null;
											fileBrowserError = null;
										}}
										aria-label="Close file preview"
									>
										<XIcon size={12} />
									</button>
								</div>
							</div>

							{#if selectedFileNode.isBinary}
								<div class="px-6 py-8">
									<p class="font-mono text-[0.76rem] text-muted">
										Binary file, {selectedFileNode.byteLength} bytes.
									</p>
								</div>
							{:else if selectedPierreFile}
								<ThreadFileContents file={selectedPierreFile} />
							{:else}
								<div class="px-6 py-8">
									<p class="font-mono text-[0.76rem] text-muted">Could not render this file.</p>
								</div>
							{/if}
						</div>
					{:else}
						<div class="flex h-full items-center justify-center rounded-none px-6 py-8">
							<p class="text-center font-mono text-[0.76rem] text-muted">
								Select a file from the tree to view its full contents.
							</p>
						</div>
					{/if}
				</div>
			</div>
		{:else}
			<div class="flex min-h-full items-center justify-center py-10">
				<p class="text-center font-mono text-[0.76rem] text-muted">
					File browser unavailable for this thread.
				</p>
			</div>
		{/if}
	</div>
</aside>
