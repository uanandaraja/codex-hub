export const streamdownTheme = {
	paragraph: {
		base: 'mb-4 text-[14px] leading-[1.7] text-fg [&:last-child]:mb-0'
	},
	h1: {
		base: 'mb-3 mt-6 text-[14px] font-semibold tracking-[-0.03em] text-fg'
	},
	h2: {
		base: 'mb-3 mt-5 text-[14px] font-semibold tracking-[-0.03em] text-fg'
	},
	h3: {
		base: 'mb-2 mt-4 text-[14px] font-semibold tracking-[-0.02em] text-fg'
	},
	h4: {
		base: 'mb-2 mt-4 text-[14px] font-semibold uppercase tracking-[0.08em] text-muted'
	},
	ul: {
		base: 'my-4 list-disc space-y-2 pl-3 text-[14px] leading-[1.7] text-fg'
	},
	ol: {
		base: 'my-4 list-decimal space-y-2 pl-3 text-[14px] leading-[1.7] text-fg'
	},
	li: {
		base: 'leading-[1.7] marker:text-muted'
	},
	blockquote: {
		base: 'my-4 border-l-2 border-line pl-4 text-[14px] leading-[1.7] text-muted'
	},
	link: {
		base: 'font-semibold text-accent underline underline-offset-2 transition-colors duration-150 hover:text-fg',
		blocked: 'text-muted no-underline'
	},
	codespan: {
		base: 'border border-line bg-surface-code px-[0.35rem] py-[0.15rem] font-mono text-[14px] text-fg'
	},
	code: {
		base: 'my-4 w-full overflow-hidden border border-line bg-surface-code',
		container: 'relative overflow-hidden bg-surface-code font-mono text-[14px] text-fg',
		header: 'hidden',
		buttons: 'hidden',
		language: 'hidden',
		skeleton: 'block whitespace-pre bg-surface-code-muted text-transparent animate-pulse',
		pre: 'm-0 max-w-full overflow-x-auto bg-surface-code px-[1rem] py-[1rem]',
		line: 'block min-w-full'
	},
	table: {
		base: 'my-4 max-w-full overflow-x-auto border border-line'
	},
	thead: {
		base: 'bg-surface-code-muted'
	},
	tbody: {
		base: 'bg-surface-1'
	},
	tfoot: {
		base: 'bg-surface-code-muted'
	},
	tr: {
		base: 'border-b border-line last:border-b-0'
	},
	th: {
		base: 'px-4 py-3 text-left font-mono text-[14px] uppercase tracking-[0.08em] text-muted'
	},
	td: {
		base: 'px-4 py-3 text-[14px] leading-[1.6] text-fg'
	},
	hr: {
		base: 'my-6 border-line'
	},
	strong: {
		base: 'font-semibold text-fg'
	},
	em: {
		base: 'italic text-fg'
	},
	del: {
		base: 'text-muted'
	},
	image: {
		base: 'my-4',
		image: 'max-w-full border border-line'
	},
	mermaid: {
		base: 'my-4 border border-line bg-surface-code p-4',
		buttons: 'hidden',
		icon: 'text-muted'
	},
	math: {
		block: 'my-4 overflow-x-auto border border-line bg-surface-code px-[0.9rem] py-[0.9rem]',
		inline: 'px-[0.2rem] text-fg'
	}
} as const;
