import { runAgent, type AttachmentInput } from '../../../server/agent.js';
import { getConversation, updateConversation } from '../../../server/conversations.js';
import { readAttachmentBytes, readAttachmentText } from '../../../server/attachments.js';
import type { Message, ReasoningLevel } from '$lib/types';

interface ChatRequest {
	conversationId?: string;
	model: string;
	messages: Message[]; // history up to (not including) the new user message
	newUser: string;
	tools?: string[]; // enabled tool names; undefined = all (page maps the web toggle)
	reasoning?: ReasoningLevel;
}

// Conversation attachments → what runAgent stuffs into the context. Missing files
// warn and skip — a turn degrades, it never fails, over one unreadable attachment.
async function attachmentsFor(conversationId: string): Promise<AttachmentInput[]> {
	const conv = await getConversation(conversationId);
	const out: AttachmentInput[] = [];
	for (const a of conv.attachments ?? []) {
		if (a.state !== 'ready') continue;
		if (a.isImage) {
			const bytes = await readAttachmentBytes(conversationId, a);
			if (!bytes) {
				console.warn(`attachment ${a.id} (${a.name}) missing on disk — skipped`);
				continue;
			}
			out.push({ name: a.name, isImage: true, dataUri: `data:${a.mime};base64,${Buffer.from(bytes).toString('base64')}` });
		} else {
			const text = await readAttachmentText(conversationId, a);
			if (!text) {
				console.warn(`no extractable text for attachment ${a.id} (${a.name}) — skipped`);
				continue;
			}
			out.push({ name: a.name, text, isImage: false });
		}
	}
	return out;
}

export async function POST({ request }: { request: Request }) {
	const body = (await request.json()) as ChatRequest;
	const { conversationId, messages, newUser, ...agentOpts } = body;

	let attachments: AttachmentInput[] = [];
	if (conversationId) {
		try {
			attachments = await attachmentsFor(conversationId);
		} catch {
			return new Response('event: error\ndata: ' + JSON.stringify({ message: 'Conversation not found' }) + '\n\n', {
				headers: { 'content-type': 'text/event-stream' }
			});
		}
	}

	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			// A closed window cancels the stream; enqueue/close on a cancelled
			// controller throws, so guard both. (controller.desired is in the
			// Web Streams spec but not in TS's DOM lib.)
			const desired = () => (controller as unknown as { desired: string }).desired;
			const emit = (event: string, data: unknown) => {
				if (desired() !== 'writable') return;
				controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
			};
			try {
				const appended = await runAgent({
					...agentOpts,
					messages: [...messages, { role: 'user', content: newUser }],
					...(attachments.length ? { attachments } : {}),
					emit
				});
				if (conversationId) {
					const conv = await getConversation(conversationId);
					// persist the user's own message too — runAgent only returns the assistant/tool replies.
					// attachmentIds records what the model saw at send time; content stays a plain string.
					const userMsg: Message = {
						role: 'user',
						content: newUser,
						...(conv.attachments?.length ? { attachmentIds: conv.attachments.map((a) => a.id) } : {})
					};
					await updateConversation(conversationId, { messages: [...conv.messages, userMsg, ...appended] });
				}
				emit('done', {});
			} catch (e) {
				let message = e instanceof Error ? e.message : String(e);
				// A non-vision model rejects image content with a 4xx — name it, don't dump the server's raw error.
				if (attachments.some((a) => a.isImage) && /HTTP 4\d\d/.test(message))
					message = `This model may not support images. Server said: ${message}`;
				emit('error', { message });
			} finally {
				if (desired() === 'writable') controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			'connection': 'keep-alive'
		}
	});
}
