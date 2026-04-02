<script lang="ts">
	import { onMount } from 'svelte';
	import type { FileDiffMetadata, FileDiffOptions } from '@pierre/diffs';

	type DiffsModule = typeof import('@pierre/diffs');
	type FileDiffInstanceLike = {
		cleanUp(): void;
		hydrate(props: { fileDiff: FileDiffMetadata; fileContainer: HTMLElement }): void;
		render(props: { fileDiff: FileDiffMetadata; forceRender?: boolean }): boolean;
		setOptions(options: FileDiffOptions<undefined> | undefined): void;
	};

	let diffsModulePromise: Promise<DiffsModule> | null = null;

	let { fileDiff }: { fileDiff: FileDiffMetadata } = $props();

	let container = $state<HTMLDivElement | null>(null);
	let instance = $state<FileDiffInstanceLike | null>(null);

	const options: FileDiffOptions<undefined> = {
		theme: 'gruvbox-dark-medium',
		themeType: 'dark',
		diffStyle: 'unified',
		diffIndicators: 'none',
		disableFileHeader: true,
		overflow: 'wrap',
		lineDiffType: 'word',
		hunkSeparators: 'simple',
		collapsedContextThreshold: 10,
		expansionLineCount: 12
	};

	onMount(() => {
		let cancelled = false;

		void mountDiff();

		return () => {
			cancelled = true;
			instance?.cleanUp();
			instance = null;
		};

		async function mountDiff(): Promise<void> {
			const module = await loadDiffsModule();
			if (cancelled || !container) {
				return;
			}

			const nextInstance = new module.FileDiff(options, undefined, true);
			nextInstance.hydrate({
				fileDiff,
				fileContainer: container
			});
			ensureCoreDiffStyles(container.shadowRoot, module);
			instance = nextInstance as FileDiffInstanceLike;
		}
	});

	$effect(() => {
		const currentFileDiff = fileDiff;
		if (!instance) {
			return;
		}

		instance.render({
			fileDiff: currentFileDiff
		});
	});

	function loadDiffsModule(): Promise<DiffsModule> {
		diffsModulePromise ??= import('@pierre/diffs');
		return diffsModulePromise;
	}

	function ensureCoreDiffStyles(
		shadowRoot: ShadowRoot | null,
		module: Pick<DiffsModule, 'CORE_CSS_ATTRIBUTE' | 'wrapCoreCSS'>
	): void {
		if (!shadowRoot || shadowRoot.querySelector(`style[${module.CORE_CSS_ATTRIBUTE}]`)) {
			return;
		}

		const style = document.createElement('style');
		style.setAttribute(module.CORE_CSS_ATTRIBUTE, '');
		style.textContent = module.wrapCoreCSS('');
		shadowRoot.prepend(style);
	}
</script>

<div bind:this={container} class="thread-diff-file"></div>

<style>
	.thread-diff-file {
		display: block;
		min-width: 0;
		max-width: 100%;
		overflow: hidden;
		width: 100%;
	}
</style>
