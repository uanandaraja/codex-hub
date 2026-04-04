<script lang="ts">
	import { CaretDownIcon, CaretRightIcon, FileCodeIcon, FolderIcon } from 'phosphor-svelte';
	import ThreadFileTree from '$lib/components/ThreadFileTree.svelte';
	import type { DirectoryEntry } from '$lib/types';

	type ToggleDirectoryHandler = (path: string) => void;
	type SelectFileHandler = (path: string) => void;
	type LoadDirectoryHandler = (path: string) => Promise<void> | void;

	let {
		entries,
		expandedPaths,
		loadingPaths,
		selectedFilePath = null,
		directoryEntriesByPath,
		depth = 0,
		ontoggledirectory,
		onselectfile,
		onloaddirectory
	}: {
		entries: DirectoryEntry[];
		expandedPaths: Record<string, boolean>;
		loadingPaths: Record<string, boolean>;
		selectedFilePath?: string | null;
		directoryEntriesByPath: Record<string, DirectoryEntry[]>;
		depth?: number;
		ontoggledirectory?: ToggleDirectoryHandler;
		onselectfile?: SelectFileHandler;
		onloaddirectory?: LoadDirectoryHandler;
	} = $props();

	function isExpanded(path: string): boolean {
		return Boolean(expandedPaths[path]);
	}

	function isLoading(path: string): boolean {
		return Boolean(loadingPaths[path]);
	}

	function childEntries(path: string): DirectoryEntry[] {
		return directoryEntriesByPath[path] ?? [];
	}

	async function handleDirectoryClick(path: string): Promise<void> {
		if (!isExpanded(path) && childEntries(path).length === 0) {
			await onloaddirectory?.(path);
		}

		ontoggledirectory?.(path);
	}
</script>

<div class="grid gap-1">
	{#each entries as entry (entry.path)}
		<div class="grid gap-1">
			<button
				type="button"
				class={`flex w-full items-center gap-2 border-0 px-2 py-[0.42rem] text-left transition-colors duration-150 ${
					entry.path === selectedFilePath
						? 'bg-surface-0 text-fg'
						: 'bg-transparent text-muted hover:bg-surface-0/55 hover:text-fg'
				}`}
				style={`padding-left: calc(0.55rem + ${depth} * 0.8rem);`}
				onclick={() =>
					entry.isDirectory ? void handleDirectoryClick(entry.path) : onselectfile?.(entry.path)}
				aria-expanded={entry.isDirectory ? isExpanded(entry.path) : undefined}
				aria-current={!entry.isDirectory && entry.path === selectedFilePath ? 'true' : undefined}
			>
				<span class="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted">
					{#if entry.isDirectory}
						{#if isExpanded(entry.path)}
							<CaretDownIcon size={12} />
						{:else}
							<CaretRightIcon size={12} />
						{/if}
					{:else}
						<FileCodeIcon size={12} />
					{/if}
				</span>

				{#if entry.isDirectory}
					<FolderIcon size={12} class="shrink-0 text-muted" />
				{/if}

				<span class="min-w-0 flex-1 truncate font-mono text-[0.72rem]">{entry.fileName}</span>

				{#if entry.isDirectory && isLoading(entry.path)}
					<span class="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-muted">loading</span>
				{/if}
			</button>

			{#if entry.isDirectory && isExpanded(entry.path)}
				<ThreadFileTree
					entries={childEntries(entry.path)}
					{expandedPaths}
					{loadingPaths}
					{selectedFilePath}
					{directoryEntriesByPath}
					depth={depth + 1}
					{ontoggledirectory}
					{onselectfile}
					{onloaddirectory}
				/>
			{/if}
		</div>
	{/each}
</div>
