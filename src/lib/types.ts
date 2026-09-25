export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
	id: string;
	name: string;
	arguments: string; // raw JSON string, as streamed by the model
}

export type ReasoningLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh';

export interface TurnStats {
	prompt: number; // prefill tokens (summed across tool rounds)
	completion: number; // decode tokens
	wallMs: number; // user hit send → turn complete
}

// OpenAI wire shape, verbatim — image content rides the model's vision support.
export type ContentBlock =
	| { type: 'text'; text: string }
	| { type: 'image_url'; image_url: { url: string } }; // data: URI

export interface AttachmentMeta {
	id: string; // uuid; also the disk filename stem
	name: string; // original filename
	size: number; // bytes on disk
	mime: string; // browser-provided; informational
	isImage: boolean;
	state: 'ready' | 'error';
	error?: string; // user-facing reason, shown verbatim in the chip
	createdAt: number;
}

export interface Message {
	role: Role;
	// string everywhere persisted; ContentBlock[] is wire-only (images on the sending turn).
	content: string | ContentBlock[];
	name?: string; // tool name, when role === 'tool'
	tool_call_id?: string; // links a tool result to its assistant tool_call
	tool_calls?: ToolCall[];
	attachmentIds?: string[]; // attachments the model saw when this user message was sent
	reasoning?: string; // display-only thinking; never sent upstream (toWire strips it)
	reasoningLevel?: ReasoningLevel; // display-only: which level produced the thinking
	stats?: TurnStats; // display-only per-turn performance
}

// Client-side composer chip state: a file from picker/drag before (or during) the
// upload round-trip. key is a client uuid; meta appears once the server accepts it.
export interface PendingAttachment {
	key: string;
	name: string;
	size: number;
	status: 'uploading' | 'ready' | 'error';
	error?: string;
	isImage: boolean;
	meta?: AttachmentMeta;
}

export interface Conversation {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	endpointId?: string;
	model?: string;
	messages: Message[];
	attachments?: AttachmentMeta[]; // per-conversation; stuffed into context every turn
	webTools?: boolean; // web_search + web_fetch on/off; calculator is always available
	reasoning?: ReasoningLevel;
}

export interface ConversationMeta {
	id: string;
	title: string;
	updatedAt: number;
	model?: string;
}

export interface EndpointConfig {
	name?: string;
	baseUrl: string; // '' = unconfigured (drives onboarding)
	apiKey: string;
	models: string[]; // last successful /models fetch; offline picker cache
	defaultModel?: string;
	accent?: string; // '' = unset (fall back to the CSS default)
	contextWindow?: number; // whole-model ceiling (e.g. max_model_len); used when modelContext lacks the active model
	contextReserve?: number; // fraction reserved for output, 0..1 (default 0.11)
	modelContext?: Record<string, number>; // per-model ceilings detected from /models
	theme?: 'light' | 'dark'; // missing = light
	sidebarWidth?: number; // px, 180..480; missing = default 260
	composerHeight?: number; // px; 0/missing = auto-grow
}
