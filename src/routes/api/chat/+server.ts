import { runAgent } from '../../../server/agent.js';
import { getConversation, updateConversation } from '../../../server/conversations.js';
import type { Message, ReasoningLevel } from '$lib/types';

interface ChatRequest {
	conversationId?: string;
	model: string;
	messages: Message[]; // history up to (not including) the new user message
	newUser: string;
	tools?: string[]; // enabled tool names; undefined = all (page maps the web toggle)
	reasoning?: ReasoningLevel;
}

export async function POST({ request }: { request: Request }) {
	const body = (await request.json()) as ChatRequest;
	const { conversationId, messages, newUser, ...agentOpts } = body;

	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			const emit = (event: string, data: unknown) =>
				controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
			try {
				const appended = await runAgent({ ...agentOpts, messages: [...messages, { role: 'user', content: newUser }], emit });
				if (conversationId) {
					const conv = await getConversation(conversationId);
					// persist the user's own message too — runAgent only returns the assistant/tool replies
					await updateConversation(conversationId, {
						messages: [...conv.messages, { role: 'user', content: newUser }, ...appended]
					});
				}
				emit('done', {});
			} catch (e) {
				emit('error', { message: e instanceof Error ? e.message : String(e) });
			} finally {
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			connection: 'keep-alive'
		}
	});
}
