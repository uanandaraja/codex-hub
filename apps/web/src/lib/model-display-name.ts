const MODEL_TOKEN_LABELS: Record<string, string> = {
	gpt: 'GPT'
};

export function formatModelDisplayName(modelId: string): string {
	return modelId
		.split('-')
		.map((segment) => {
			if (segment.length === 0) {
				return segment;
			}

			const normalizedSegment = segment.toLowerCase();
			if (normalizedSegment in MODEL_TOKEN_LABELS) {
				return MODEL_TOKEN_LABELS[normalizedSegment];
			}

			if (/^\d+(\.\d+)*$/.test(segment) || /[0-9]/.test(segment)) {
				return segment;
			}

			return `${segment[0]?.toUpperCase() ?? ''}${segment.slice(1).toLowerCase()}`;
		})
		.join('-');
}
