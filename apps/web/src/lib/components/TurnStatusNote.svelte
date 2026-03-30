<script lang="ts">
	import { SpinnerGapIcon, StopIcon } from 'phosphor-svelte';

	let {
		streaming = false,
		interrupted = false,
		elapsedSeconds = null,
		contextLeftPercent = null
	}: {
		streaming?: boolean;
		interrupted?: boolean;
		elapsedSeconds?: number | null;
		contextLeftPercent?: number | null;
	} = $props();

	const statusText = $derived.by(() => {
		if (streaming) {
			return `Working... (${formatElapsed(elapsedSeconds)})`;
		}

		if (interrupted) {
			return elapsedSeconds === null
				? 'Interrupted'
				: `Interrupted after ${formatElapsed(elapsedSeconds)}`;
		}

		return null;
	});
	const contextText = $derived.by(() =>
		contextLeftPercent === null ? null : `ctx ${contextLeftPercent}% left`
	);
	const metaText = $derived.by(() => {
		const parts: string[] = [];
		if (statusText) {
			parts.push(statusText);
		}
		if (contextText) {
			parts.push(contextText);
		}
		return parts.length > 0 ? parts.join(' | ') : null;
	});

	function formatElapsed(value: number | null): string {
		const totalSeconds = Math.max(0, value ?? 0);
		const hours = Math.floor(totalSeconds / 3_600);
		const minutes = Math.floor((totalSeconds % 3_600) / 60);
		const seconds = totalSeconds % 60;

		if (hours > 0) {
			return minutes > 0
				? `${hours} hr${hours === 1 ? '' : 's'} ${minutes} min`
				: `${hours} hr${hours === 1 ? '' : 's'}`;
		}

		if (minutes > 0) {
			return `${minutes} min ${seconds} sec${seconds === 1 ? '' : 's'}`;
		}

		return `${seconds} sec${seconds === 1 ? '' : 's'}`;
	}
</script>

{#if metaText}
	<div class="mt-3 flex items-center gap-2 font-mono text-[12px] leading-[1.55] text-muted">
		{#if streaming}
			<SpinnerGapIcon size={14} class="animate-spin text-accent" />
		{:else if interrupted}
			<StopIcon size={14} class="text-notice" />
		{/if}
		<span>{metaText}</span>
	</div>
{/if}
