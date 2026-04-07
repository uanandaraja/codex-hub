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

	let {
		fileDiff,
		diffStyle = 'unified'
	}: { fileDiff: FileDiffMetadata; diffStyle?: 'unified' | 'split' } = $props();

	let container = $state<HTMLDivElement | null>(null);
	let instance = $state<FileDiffInstanceLike | null>(null);

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

			const nextInstance = new module.FileDiff(buildOptions(diffStyle), undefined, true);
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

		instance.setOptions(buildOptions(diffStyle));
		instance.render({
			fileDiff: currentFileDiff,
			forceRender: true
		});
	});

	function buildOptions(diffStyle: 'unified' | 'split'): FileDiffOptions<undefined> {
		return {
			theme: 'gruvbox-dark-medium',
			themeType: 'dark',
			diffStyle,
			diffIndicators: 'bars',
			disableFileHeader: true,
			overflow: 'wrap',
			lineDiffType: 'word',
			hunkSeparators: 'simple',
			collapsedContextThreshold: 10,
			expansionLineCount: 12
		};
	}

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
		--diffs-font-family: "Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo,
			monospace;
		--diffs-header-font-family: "Geist Mono Variable", ui-monospace, SFMono-Regular,
			Menlo, monospace;
		display: block;
		min-width: 0;
		max-width: 100%;
		overflow: hidden;
		width: 100%;
	}
</style>
