<script lang="ts">
	import { CaretDownIcon, CaretRightIcon, GitDiffIcon, XIcon } from 'phosphor-svelte';
	import { parsePatchFiles } from '@pierre/diffs';
	import type { FileDiffMetadata } from '@pierre/diffs';
	import vscodeLogo from '$lib/assets/vscode.svg';
	import ThreadDiffFile from '$lib/components/ThreadDiffFile.svelte';

	type DiffPatch = {
		id: string;
		patch: string;
	};

	type DiffSectionInput = {
		id: string;
		title: string | null;
		patches: DiffPatch[];
	};

	type ParsedDiffFile = {
		id: string;
		fileDiff: FileDiffMetadata;
		label: string;
		additions: number;
		deletions: number;
	};

	type ParsedDiffSection = {
		id: string;
		title: string | null;
		files: ParsedDiffFile[];
	};

	let {
		sections = [],
		editorHref = null,
		onclose
	}: {
		sections?: DiffSectionInput[];
		editorHref?: string | null;
		onclose?: () => void;
	} = $props();

	let defaultFilesCollapsed = $state(true);
	let fileCollapseOverrides = $state<Record<string, boolean>>({});

	const parsedPatchCache = new Map<
		string,
		{
			source: string;
			files: ParsedDiffFile[];
		}
	>();

	const totalPatchCount = $derived.by(() =>
		sections.reduce((count, section) => count + section.patches.length, 0)
	);
	const parsedSections = $derived.by<ParsedDiffSection[]>(() =>
		sections
			.map((section) => ({
				id: section.id,
				title: section.title,
				files: parseDiffFiles(section.patches)
			}))
			.filter((section) => section.files.length > 0)
	);
	const totalFileCount = $derived.by(() =>
		parsedSections.reduce((count, section) => count + section.files.length, 0)
	);
	const allFileIds = $derived.by(() =>
		parsedSections.flatMap((section) => section.files.map((file) => file.id))
	);
	const allFilesCollapsed = $derived.by(
		() => allFileIds.length > 0 && allFileIds.every((id) => fileIsCollapsed(id))
	);

	$effect(() => {
		if (allFileIds.length === 0) {
			return;
		}

		const allowedIds = new Set(allFileIds);
		const nextOverrides: Record<string, boolean> = {};
		let changed = false;

		for (const [fileId, collapsed] of Object.entries(fileCollapseOverrides)) {
			if (!allowedIds.has(fileId)) {
				changed = true;
				continue;
			}

			nextOverrides[fileId] = collapsed;
		}

		if (changed) {
			fileCollapseOverrides = nextOverrides;
		}
	});

	function parseDiffFiles(patches: DiffPatch[]): ParsedDiffFile[] {
		const files: ParsedDiffFile[] = [];

		for (const patch of patches) {
			const cached = parsedPatchCache.get(patch.id);
			if (cached && cached.source === patch.patch) {
				files.push(...cached.files);
				continue;
			}

			const parsedFiles: ParsedDiffFile[] = [];

			try {
				const parsed = parsePatchFiles(patch.patch, patch.id);
				for (const patchGroup of parsed) {
					for (const [index, fileDiff] of patchGroup.files.entries()) {
						parsedFiles.push({
							id: buildFileId(patch.id, index, fileDiff),
							fileDiff,
							label: formatFileLabel(fileDiff),
							additions: countAddedLines(fileDiff),
							deletions: countDeletedLines(fileDiff)
						});
					}
				}
			} catch {
				// Keep the drawer usable even if one patch is malformed.
			}

			parsedPatchCache.set(patch.id, {
				source: patch.patch,
				files: parsedFiles
			});
			files.push(...parsedFiles);
		}

		return files;
	}

	function formatFileLabel(fileDiff: FileDiffMetadata): string {
		return fileDiff.prevName ? `${fileDiff.prevName} -> ${fileDiff.name}` : fileDiff.name;
	}

	function buildFileId(patchId: string, index: number, fileDiff: FileDiffMetadata): string {
		return [patchId, index, fileDiff.prevName ?? '', fileDiff.name, fileDiff.type].join(':');
	}

	function countAddedLines(fileDiff: FileDiffMetadata): number {
		return fileDiff.hunks.reduce((count, hunk) => count + hunk.additionLines, 0);
	}

	function countDeletedLines(fileDiff: FileDiffMetadata): number {
		return fileDiff.hunks.reduce((count, hunk) => count + hunk.deletionLines, 0);
	}

	function fileIsCollapsed(fileId: string): boolean {
		return fileCollapseOverrides[fileId] ?? defaultFilesCollapsed;
	}

	function toggleFile(fileId: string): void {
		const nextCollapsed = !fileIsCollapsed(fileId);
		if (nextCollapsed === defaultFilesCollapsed) {
			const nextOverrides = { ...fileCollapseOverrides };
			delete nextOverrides[fileId];
			fileCollapseOverrides = nextOverrides;
			return;
		}

		fileCollapseOverrides = {
			...fileCollapseOverrides,
			[fileId]: nextCollapsed
		};
	}

	function toggleAllFiles(): void {
		defaultFilesCollapsed = !allFilesCollapsed;
		fileCollapseOverrides = {};
	}
</script>

<aside
	class="absolute inset-y-0 right-0 z-[3] hidden w-[min(42vw,44rem)] rounded-none flex-col border-l border-line bg-surface-1 min-[821px]:flex"
	aria-label="Thread diff"
>
	<div class="flex min-h-[3.6rem] items-center justify-between gap-2 rounded-none border-b border-line px-3">
		<div class="flex min-w-0 items-center gap-1.5">
			<GitDiffIcon size={16} class="text-muted" />
			<h2 class="truncate text-[0.82rem] font-medium uppercase tracking-[0.12em] text-fg">Diff</h2>
		</div>

		<div class="flex items-center gap-1">
			{#if totalFileCount > 0}
				<button
					type="button"
					class="inline-flex h-8 items-center justify-center gap-1.5 rounded-none border-0 bg-transparent px-1.5 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-muted transition-colors duration-150 hover:text-fg"
					onclick={toggleAllFiles}
				>
					{#if allFilesCollapsed}
						<CaretDownIcon size={14} />
					{:else}
						<CaretRightIcon size={14} />
					{/if}
					{allFilesCollapsed ? 'Expand all' : 'Collapse all'}
				</button>
			{/if}

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
				aria-label="Close diff"
			>
				<XIcon size={18} />
			</button>
		</div>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto px-[1.1rem] py-[1.1rem]">
		{#if totalFileCount > 0}
			<div class="grid gap-6 pb-8">
				{#each parsedSections as section (section.id)}
					<section class="grid gap-3">
						{#if section.title}
							<p class="text-[0.68rem] font-medium uppercase tracking-[0.12em] text-muted">
								{section.title}
							</p>
						{/if}

						<div class="grid gap-4">
							{#each section.files as file (file.id)}
								<div class="border border-line">
									<button
										type="button"
										class="flex w-full items-center gap-3 border-0 bg-transparent px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-0/55"
										onclick={() => toggleFile(file.id)}
										aria-expanded={!fileIsCollapsed(file.id)}
									>
										<span class="shrink-0 text-muted">
											{#if fileIsCollapsed(file.id)}
												<CaretRightIcon size={14} />
											{:else}
												<CaretDownIcon size={14} />
											{/if}
										</span>

										<span class="min-w-0 flex-1 truncate font-mono text-[0.76rem] text-fg">
											{file.label}
										</span>

										<span class="flex shrink-0 items-center gap-2 font-mono text-[0.72rem]">
											<span class="text-success">+{file.additions}</span>
											<span class="text-notice">-{file.deletions}</span>
										</span>
									</button>

									{#if !fileIsCollapsed(file.id)}
										<div class="border-t border-line">
											<ThreadDiffFile fileDiff={file.fileDiff} />
										</div>
									{/if}
								</div>
							{/each}
						</div>
					</section>
				{/each}
			</div>
		{:else}
			<div class="flex min-h-full items-center justify-center py-10">
				<p class="text-center font-mono text-[0.76rem] text-muted">
					{totalPatchCount > 0 ? 'Could not render this diff yet.' : 'No file changes yet.'}
				</p>
			</div>
		{/if}
	</div>
</aside>
