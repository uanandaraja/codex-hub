<script lang="ts">
	import { onMount } from 'svelte';
	import { EyeIcon, EyeSlashIcon } from 'phosphor-svelte';
	import type { GatewayAccountRateLimitWindow, GatewayStatus } from '$lib/types';

	let { status }: { status: GatewayStatus | null } = $props();

	let expanded = $state(false);
	let hasMounted = false;
	let nowMs = $state(0);

	const account = $derived.by(() => status?.account ?? null);
	const summaryTitle = $derived.by(() => {
		if (!account) {
			return 'Account unavailable';
		}

		return account.name ?? account.email ?? account.providerLabel;
	});
	const summarySubtitle = $derived.by(() => {
		if (!account) {
			return 'No Codex login metadata found on this machine yet.';
		}

		return account.email ?? `via ${account.providerLabel}`;
	});
	const limitCards = $derived.by(() => [
		{
			label: '5h limit',
			window: account?.fiveHourLimit ?? null
		},
		{
			label: 'Weekly limit',
			window: account?.weeklyLimit ?? null
		}
	]);

	onMount(() => {
		hasMounted = true;
		nowMs = Date.now();

		const interval = window.setInterval(() => {
			nowMs = Date.now();
		}, 60_000);

		return () => {
			window.clearInterval(interval);
		};
	});

	function formatPlanLabel(value: string): string {
		switch (value.toLowerCase()) {
			case 'plus':
				return 'ChatGPT Plus';
			case 'pro':
				return 'ChatGPT Pro';
			case 'team':
				return 'ChatGPT Team';
			default:
				return value.replace(/[_-]+/g, ' ');
		}
	}

	function clampPercent(value: number | null): number {
		if (value === null || !Number.isFinite(value)) {
			return 0;
		}

		return Math.max(0, Math.min(100, Math.round(value)));
	}

	function formatUsedPercent(value: number | null): string {
		if (value === null || !Number.isFinite(value)) {
			return 'n/a';
		}

		return `${clampPercent(value)}%`;
	}

	function progressStyle(value: number | null): string {
		return `width: ${clampPercent(value)}%`;
	}

	function formatResetLabel(value: string | null): string {
		if (!value) {
			return 'Reset unavailable';
		}

		const date = new Date(value);
		if (Number.isNaN(date.getTime())) {
			return 'Reset unavailable';
		}

		if (!hasMounted) {
			return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
		}

		return new Intl.DateTimeFormat(undefined, {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(date);
	}

	function formatRelativeReset(value: string | null): string | null {
		if (!hasMounted || !value) {
			return null;
		}

		const resetMs = new Date(value).getTime();
		if (!Number.isFinite(resetMs)) {
			return null;
		}

		const diffMinutes = Math.ceil((resetMs - nowMs) / 60_000);
		if (diffMinutes <= 0) {
			return 'reset pending';
		}

		if (diffMinutes < 60) {
			return `resets in ${diffMinutes}m`;
		}

		if (diffMinutes < 2_880) {
			const hours = Math.floor(diffMinutes / 60);
			const minutes = diffMinutes % 60;
			return `resets in ${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`;
		}

		const days = Math.floor(diffMinutes / 1_440);
		const hours = Math.floor((diffMinutes % 1_440) / 60);
		return `resets in ${days}d${hours > 0 ? ` ${hours}h` : ''}`;
	}
</script>

<section class="rounded-none border-t border-line px-[1.1rem] py-[1.05rem]">
	<div class="overflow-hidden rounded-[0.9rem] border border-line bg-surface-0">
		<button
			type="button"
			class="w-full text-left transition-[border-color,background-color] duration-150 hover:bg-accent-soft-hover"
			aria-expanded={expanded}
			aria-controls="sidebar-account-limits"
			onclick={() => {
				expanded = !expanded;
			}}
		>
			<div class="p-[0.95rem]">
				<div class="flex items-center gap-3">
					<div class="min-w-0 flex-1">
						<p class="truncate text-[0.92rem] font-semibold tracking-[-0.02em] text-fg">
							{summaryTitle}
						</p>
						<p class="mt-[0.28rem] truncate font-mono text-[0.72rem] text-muted">
							{summarySubtitle}
						</p>
					</div>

					<span class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.75rem] border border-line text-muted">
						{#if expanded}
							<EyeSlashIcon size={16} />
						{:else}
							<EyeIcon size={16} />
						{/if}
					</span>
				</div>
			</div>
		</button>

		{#if expanded}
			<div id="sidebar-account-limits" class="px-[0.95rem] pb-[0.95rem] pt-3">
				{#if account}
					<div class="mb-3 grid gap-[0.35rem] rounded-none border-0 text-[0.76rem] text-muted">
						<p>{account.providerLabel}{account.planType ? ` • ${formatPlanLabel(account.planType)}` : ''}</p>
						{#if account.email}
							<p class="rounded-none border-0 font-mono text-[0.72rem] text-fg">{account.email}</p>
						{/if}
						{#if account.rateLimitsUpdatedAt}
							<p>last synced {formatResetLabel(account.rateLimitsUpdatedAt)}</p>
						{/if}
					</div>

					<div class="grid gap-2">
						{#each limitCards as card}
							<div class="border border-line bg-surface-0 p-[0.8rem]">
								<div class="mb-2 flex items-center justify-between gap-3">
									<p class="text-[0.68rem] uppercase tracking-[0.16em] text-muted">{card.label}</p>
									<p class="font-mono text-[0.72rem] text-fg">
										{formatUsedPercent(card.window?.usedPercent ?? null)} used
									</p>
								</div>

								<div class="h-[6px] bg-surface-2">
									<div class="h-full bg-accent" style={progressStyle(card.window?.usedPercent ?? null)}></div>
								</div>

								<div class="mt-2 grid gap-[0.28rem] text-[0.72rem] text-muted">
									<p>{formatRelativeReset(card.window?.resetsAt ?? null) ?? 'reset schedule unavailable'}</p>
									<p class="font-mono text-[0.68rem]">
										{formatResetLabel(card.window?.resetsAt ?? null)}
									</p>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-[0.76rem] leading-[1.55] text-muted">
						Codex login metadata is not available yet, so the server account and rate limits
						could not be resolved.
					</p>
				{/if}
			</div>
		{/if}
	</div>
</section>
