<script lang="ts">
	import spriteHref from '$lib/assets/opencode-file-icons-sprite.svg';
	import { chooseOpencodeIconName } from '$lib/components/opencode-file-icons';

	let {
		path,
		type,
		expanded = false,
		size = 16,
		iconClass = ''
	}: {
		path: string;
		type: 'file' | 'directory';
		expanded?: boolean;
		size?: number;
		iconClass?: string;
	} = $props();

	const iconName = $derived(chooseOpencodeIconName(path, type, expanded));
	const iconHref = $derived(`${spriteHref}#${iconName}`);
</script>

<svg
	viewBox="0 0 16 16"
	width={size}
	height={size}
	class={`opencode-file-icon ${iconClass}`}
	aria-hidden="true"
	focusable="false"
>
	<use href={iconHref}></use>
</svg>

<style>
	.opencode-file-icon {
		display: block;
		flex-shrink: 0;
		overflow: visible;
	}
</style>
