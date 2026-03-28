import type { LanguageInfo } from 'svelte-streamdown';
import everforestDark from '@shikijs/themes/everforest-dark';

export const shikiTheme = 'everforest-dark';

export const shikiThemes = {
	[shikiTheme]: everforestDark
} as const;

export const shikiLanguages: LanguageInfo[] = [
	{
		id: 'javascript',
		aliases: ['js'],
		import: () => import('@shikijs/langs/javascript')
	},
	{
		id: 'typescript',
		aliases: ['ts'],
		import: () => import('@shikijs/langs/typescript')
	},
	{
		id: 'jsx',
		import: () => import('@shikijs/langs/jsx')
	},
	{
		id: 'tsx',
		import: () => import('@shikijs/langs/tsx')
	},
	{
		id: 'html',
		import: () => import('@shikijs/langs/html')
	},
	{
		id: 'css',
		import: () => import('@shikijs/langs/css')
	},
	{
		id: 'json',
		import: () => import('@shikijs/langs/json')
	},
	{
		id: 'markdown',
		aliases: ['md'],
		import: () => import('@shikijs/langs/markdown')
	},
	{
		id: 'yaml',
		aliases: ['yml'],
		import: () => import('@shikijs/langs/yaml')
	},
	{
		id: 'python',
		aliases: ['py'],
		import: () => import('@shikijs/langs/python')
	},
	{
		id: 'go',
		import: () => import('@shikijs/langs/go')
	},
	{
		id: 'rust',
		aliases: ['rs'],
		import: () => import('@shikijs/langs/rust')
	},
	{
		id: 'sql',
		import: () => import('@shikijs/langs/sql')
	},
	{
		id: 'shellscript',
		aliases: ['bash', 'sh', 'shell', 'zsh'],
		import: () => import('@shikijs/langs/shellscript')
	},
	{
		id: 'docker',
		aliases: ['dockerfile'],
		import: () => import('@shikijs/langs/docker')
	},
	{
		id: 'toml',
		import: () => import('@shikijs/langs/toml')
	},
	{
		id: 'graphql',
		aliases: ['gql'],
		import: () => import('@shikijs/langs/graphql')
	},
	{
		id: 'svelte',
		import: () => import('@shikijs/langs/svelte')
	}
];

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
		base: 'text-accent underline underline-offset-2',
		blocked: 'text-muted no-underline'
	},
	codespan: {
		base: 'border border-line bg-[#0b0d11] px-[0.35rem] py-[0.15rem] font-mono text-[14px] text-fg'
	},
	code: {
		base: 'my-4 w-full overflow-hidden border border-line bg-[#0b0d11]',
		container: 'relative overflow-hidden bg-[#0b0d11] font-mono text-[14px] text-fg',
		header: 'hidden',
		buttons: 'hidden',
		language: 'hidden',
		skeleton: 'block whitespace-pre bg-[#151922] text-transparent animate-pulse',
		pre: 'm-0 max-w-full overflow-x-auto bg-[#0b0d11] px-[1rem] py-[1rem]',
		line: 'block min-w-full'
	},
	table: {
		base: 'my-4 max-w-full overflow-x-auto border border-line'
	},
	thead: {
		base: 'bg-[#10131a]'
	},
	tbody: {
		base: 'bg-surface-1'
	},
	tfoot: {
		base: 'bg-[#10131a]'
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
		base: 'my-4 border border-line bg-[#0b0d11] p-4',
		buttons: 'hidden',
		icon: 'text-muted'
	},
	math: {
		block: 'my-4 overflow-x-auto border border-line bg-[#0b0d11] px-[0.9rem] py-[0.9rem]',
		inline: 'px-[0.2rem] text-fg'
	}
} as const;
