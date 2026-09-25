import { runAgent, type AttachmentInput } from '../../../server/agent.js';
import { getConversation, updateConversation } from '../../../server/conversations.js';
import { readAttachmentBytes, readAttachmentText } from '../../../server/attachments.js';
import { loadConfig, saveConfig } from '$lib/config.js';
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
			out.push({ id: a.id, name: a.name, isImage: true, dataUri: `data:${a.mime};base64,${Buffer.from(bytes).toString('base64')}` });
		} else {
			const text = await readAttachmentText(conversationId, a);
			if (!text) {
				console.warn(`no extractable text for attachment ${a.id} (${a.name}) — skipped`);
				continue;
			}
			out.push({ id: a.id, name: a.name, text, isImage: false });
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
	// Client stop / closed window cancels the stream — forward that to the agent so
	// the in-flight model call and tools die, and the partial turn is kept.
	const ac = new AbortController();
	const stream = new ReadableStream({
		async start(controller) {
			// desiredSize is null once the stream is closed/cancelled; enqueue/close
			// on a cancelled controller throw, so guard both.
			const emit = (event: string, data: unknown) => {
				if (controller.desiredSize === null) return;
				try {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				} catch {
					// reader went away; the finally below closes out
				}
			};
			try {
				let appended: Message[] = [];
				let newUserMsg: Message = { role: 'user', content: newUser };
				if (conversationId) {
					// Persist the user's own message up front: it's what the model sees
					// (attachmentIds) and what title generation reads, and it's safe to
					// write before the turn — a stopped/errored turn still gets its user msg.
					const conv = await getConversation(conversationId);
					// Stamp only the attachments new since the last send: they're the ones
					// this message was added with (wire pass + bubble render). Earlier
					// messages keep their own stamps; legacy all-ids stamps are harmless —
					// the agent's wire dedup ships each image once.
					const seen = new Set(conv.messages.flatMap((m) => m.attachmentIds ?? []));
					const fresh = (conv.attachments ?? []).filter((a) => !seen.has(a.id)).map((a) => a.id);
					newUserMsg = {
						role: 'user',
						content: newUser,
						...(fresh.length ? { attachmentIds: fresh } : {})
					};
					await updateConversation(conversationId, { messages: [...conv.messages, newUserMsg] });
				}
				appended = await runAgent({
					...agentOpts,
					messages: [...messages, newUserMsg],
					...(attachments.length ? { attachments } : {}),
					signal: ac.signal,
					emit
				});
				if (conversationId && appended.length) {
					const conv = await getConversation(conversationId);
					await updateConversation(conversationId, { messages: [...conv.messages, ...appended] });
				}
				if (!ac.signal.aborted) emit('done', {});
			} catch (e) {
				let message = e instanceof Error ? e.message : String(e);
				// A non-vision model rejects image content with a 4xx — name it, don't dump the server's raw error.
				if (attachments.some((a) => a.isImage) && /HTTP 4\d\d/.test(message)) {
					message = `This model may not support images. Server said: ${message}`;
					// Evidence invalidation: a real image turn just 4xx'd, so the probe's
					// cached claim is suspect. Delete (not write false — the 4xx may be an
					// oversized image) so the next model selection re-probes.
					try {
						const cfg = loadConfig();
						if (cfg.vision && agentOpts.model in cfg.vision) {
							delete cfg.vision[agentOpts.model];
							saveConfig(cfg);
						}
					} catch {
						// config read/write failure doesn't mask the turn error
					}
				}
				// A template that rejects the (clamped) effort 4xxs the turn — same
				// evidence invalidation as images: delete so the next selection re-probes.
				if (agentOpts.reasoning && agentOpts.reasoning !== 'off' && /HTTP 4\d\d/.test(message)) {
					try {
						const cfg = loadConfig();
						if (cfg.reasoning && agentOpts.model in cfg.reasoning) {
							delete cfg.reasoning[agentOpts.model];
							saveConfig(cfg);
						}
					} catch {
						// config read/write failure doesn't mask the turn error
					}
				}
				emit('error', { message });
			} finally {
				try {
					controller.close();
				} catch {
					// already closed (cancel raced us)
				}
			}
		},
		cancel() {
			ac.abort();
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
