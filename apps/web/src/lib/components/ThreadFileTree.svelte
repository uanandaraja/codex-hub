<script lang="ts">
	import { CaretDownIcon, CaretRightIcon } from 'phosphor-svelte';
	import OpencodeFileIcon from '$lib/components/OpencodeFileIcon.svelte';
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

	function isDotEntry(fileName: string): boolean {
		return fileName.startsWith('.');
	}

	async function handleDirectoryClick(path: string): Promise<void> {
		if (!isExpanded(path) && childEntries(path).length === 0) {
			await onloaddirectory?.(path);
		}

		ontoggledirectory?.(path);
	}
</script>

<div class="min-w-0 grid gap-1">
	{#each entries as entry (entry.path)}
		{@const isDimmed = Boolean(entry.isIgnored) || isDotEntry(entry.fileName)}
		<div class="min-w-0 grid gap-1">
			<button
				type="button"
				class={`flex min-w-0 w-full items-center gap-2 overflow-hidden rounded-none border-0 px-1.5 py-[0.3rem] text-left transition-[background,color,opacity] duration-150 ${
					entry.path === selectedFilePath
						? isDimmed
							? 'bg-surface-0 text-muted opacity-70'
							: 'bg-surface-0 text-fg'
						: isDimmed
							? 'bg-transparent text-muted opacity-55 hover:bg-surface-0/55 hover:text-fg hover:opacity-80'
							: 'bg-transparent text-muted hover:bg-surface-0/55 hover:text-fg'
				}`}
				style={`padding-left: calc(0.4rem + ${depth} * 0.72rem);`}
				onclick={() =>
					entry.isDirectory ? void handleDirectoryClick(entry.path) : onselectfile?.(entry.path)}
				aria-expanded={entry.isDirectory ? isExpanded(entry.path) : undefined}
				aria-current={!entry.isDirectory && entry.path === selectedFilePath ? 'true' : undefined}
			>
				<span class={`inline-flex h-4 w-4 shrink-0 items-center justify-center ${isDimmed ? 'text-muted/70' : 'text-muted'}`}>
					{#if entry.isDirectory}
						{#if isExpanded(entry.path)}
							<CaretDownIcon size={12} />
						{:else}
							<CaretRightIcon size={12} />
						{/if}
					{/if}
				</span>

				<OpencodeFileIcon
					path={entry.path}
					type={entry.isDirectory ? 'directory' : 'file'}
					expanded={entry.isDirectory ? isExpanded(entry.path) : false}
					size={16}
					iconClass={isDimmed ? 'opacity-60' : ''}
				/>

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
