export type PromptAttachmentDraft = {
	id: string;
	file: File;
	previewUrl: string;
};

export type PromptSubmitPayload = {
	message: string;
	attachments: PromptAttachmentDraft[];
};
