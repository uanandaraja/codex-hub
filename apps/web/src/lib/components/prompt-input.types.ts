export type PromptAttachmentDraft = {
	id: string;
	file: File;
	previewUrl: string;
};

export type PromptFileMentionDraft = {
	id: string;
	name: string;
	root: string;
	path: string;
	absolutePath: string;
	token: string;
};

export type PromptSubmitPayload = {
	message: string;
	attachments: PromptAttachmentDraft[];
	mentions: PromptFileMentionDraft[];
};
