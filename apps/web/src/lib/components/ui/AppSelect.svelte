<script lang="ts">
	import { CheckIcon, CaretDownIcon, CaretUpIcon, CaretUpDownIcon } from 'phosphor-svelte';
	import { Select } from 'bits-ui';

	export type AppSelectOption = {
		value: string;
		label: string;
		disabled?: boolean;
	};

	let {
		value = $bindable<string | null>(null),
		items,
		placeholder = '',
		disabled = false,
		triggerClass = '',
		contentClass = '',
		viewportClass = '',
		ariaLabel
	}: {
		value?: string | null;
		items: AppSelectOption[];
		placeholder?: string;
		disabled?: boolean;
		triggerClass?: string;
		contentClass?: string;
		viewportClass?: string;
		ariaLabel?: string;
	} = $props();

	const selectedLabel = $derived(items.find((item) => item.value === value)?.label ?? '');

	function getValue(): string {
		return value ?? '';
	}

	function setValue(nextValue: string): void {
		value = nextValue || null;
	}
</script>

<Select.Root type="single" {disabled} bind:value={getValue, setValue}>
	<Select.Trigger
		aria-label={ariaLabel}
		class={`group inline-flex h-9 min-w-0 items-center gap-2 border border-line bg-surface-0 pl-2.5 pr-2 text-[12px] text-muted outline-none transition-[border-color,color,background-color] duration-150 hover:border-accent hover:text-accent focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-40 ${triggerClass}`}
	>
		<span class="min-w-0 flex-1 truncate text-left text-fg/92">
			{selectedLabel || placeholder}
		</span>
		<span class="flex h-6 w-6 shrink-0 items-center justify-center text-muted transition-colors duration-150 group-hover:text-accent">
			<CaretUpDownIcon size={13} />
		</span>
	</Select.Trigger>

	<Select.Portal>
		<Select.Content
			sideOffset={8}
			class={`z-50 min-w-[var(--bits-select-anchor-width)] border border-line bg-surface-1 p-1 shadow-[0_18px_48px_rgba(0,0,0,0.42)] outline-none data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1 ${contentClass}`}
		>
			<Select.ScrollUpButton class="flex h-6 items-center justify-center text-muted">
				<CaretUpIcon size={12} />
			</Select.ScrollUpButton>

			<Select.Viewport class={`max-h-72 min-w-[var(--bits-select-anchor-width)] ${viewportClass}`}>
				{#each items as item (item.value)}
					<Select.Item
						value={item.value}
						label={item.label}
						disabled={item.disabled}
						class="flex min-h-9 w-full select-none items-center gap-2 px-2 py-2 text-[12px] text-fg outline-none transition-colors duration-150 data-[disabled]:pointer-events-none data-[disabled]:opacity-35 data-[highlighted]:bg-surface-0 data-[highlighted]:text-accent"
					>
						{#snippet children({ selected })}
							<span class="min-w-0 flex-1 truncate">{item.label}</span>
							<span class="flex h-4 w-4 shrink-0 items-center justify-center text-accent">
								{#if selected}
									<CheckIcon size={12} weight="bold" />
								{/if}
							</span>
						{/snippet}
					</Select.Item>
				{/each}
			</Select.Viewport>

			<Select.ScrollDownButton class="flex h-6 items-center justify-center text-muted">
				<CaretDownIcon size={12} />
			</Select.ScrollDownButton>
		</Select.Content>
	</Select.Portal>
</Select.Root>
