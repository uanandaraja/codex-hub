<script lang="ts">
	import { onMount } from 'svelte';
	import type { FileContents, FileOptions } from '@pierre/diffs';

	type DiffsModule = typeof import('@pierre/diffs');
	type FileInstanceLike = {
		cleanUp(): void;
		hydrate(props: { file: FileContents; fileContainer: HTMLElement }): void;
		render(props: { file: FileContents; forceRender?: boolean }): boolean;
		setOptions(options: FileOptions<undefined> | undefined): void;
	};

	let diffsModulePromise: Promise<DiffsModule> | null = null;

	let { file }: { file: FileContents } = $props();

	let container = $state<HTMLDivElement | null>(null);
	let instance = $state<FileInstanceLike | null>(null);

	const options: FileOptions<undefined> = {
		theme: 'gruvbox-dark-medium',
		themeType: 'dark',
		disableFileHeader: true,
		overflow: 'scroll',
		disableLineNumbers: false
	};

	onMount(() => {
		let cancelled = false;

		void mountFile();

		return () => {
			cancelled = true;
			instance?.cleanUp();
			instance = null;
		};

		async function mountFile(): Promise<void> {
			const module = await loadDiffsModule();
			if (cancelled || !container) {
				return;
			}

			const nextInstance = new module.File(options, undefined, true);
			nextInstance.hydrate({
				file,
				fileContainer: container
			});
			ensureCoreStyles(container.shadowRoot, module);
			instance = nextInstance as FileInstanceLike;
		}
	});

	$effect(() => {
		const currentFile = file;
		if (!instance) {
			return;
		}

		instance.render({
			file: currentFile
		});
	});

	function loadDiffsModule(): Promise<DiffsModule> {
		diffsModulePromise ??= import('@pierre/diffs');
		return diffsModulePromise;
	}

	function ensureCoreStyles(
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

<div bind:this={container} class="thread-file-contents"></div>

<style>
	.thread-file-contents {
		display: block;
		min-width: 0;
		max-width: 100%;
		overflow: hidden;
		width: 100%;
	}
</style>
