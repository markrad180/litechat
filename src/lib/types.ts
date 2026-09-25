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

export interface Message {
	role: Role;
	content: string;
	name?: string; // tool name, when role === 'tool'
	tool_call_id?: string; // links a tool result to its assistant tool_call
	tool_calls?: ToolCall[];
	reasoning?: string; // display-only thinking; never sent upstream (toWire strips it)
	reasoningLevel?: ReasoningLevel; // display-only: which level produced the thinking
	stats?: TurnStats; // display-only per-turn performance
}

export interface Conversation {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	endpointId?: string;
	model?: string;
	messages: Message[];
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
}
