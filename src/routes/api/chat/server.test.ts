import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { POST } from './+server.js';

// Per-suite scratch config, set before this file's $lib/config import: sibling
// suites sharing one file would delete each other's config mid-test.
vi.hoisted(() => {
	process.env.LITECHAT_CONFIG = `${process.cwd()}/data/test-config-chat.json`;
});
const configPath = process.env.LITECHAT_CONFIG!;
const convPath = path.join(process.cwd(), 'data', 'conversations', 'chat-test.json');

function fixtureConversation() {
	mkdirSync(path.dirname(convPath), { recursive: true }); // sibling suites may have deleted the dir
	writeFileSync(
		convPath,
		JSON.stringify({
			id: 'chat-test',
			title: 'New chat',
			createdAt: 1,
			updatedAt: 1,
			model: 'm1',
			messages: []
		})
	);
}

const ANSWER_SSE = 'data: {"choices":[{"delta":{"content":"Hello there"}}]}\n\ndata: [DONE]\n\n';

function sseResponse(sse: string) {
	return new Response(
		new ReadableStream({
			start(c) {
				c.enqueue(new TextEncoder().encode(sse));
				c.close();
			}
		})
	);
}

function chatRequest() {
	return new Request('http://localhost/api/chat', {
		method: 'POST',
		body: JSON.stringify({ conversationId: 'chat-test', model: 'm1', messages: [], newUser: 'hi' })
	});
}

async function readAll(res: Response): Promise<string> {
	const reader = res.body!.getReader();
	const decoder = new TextDecoder();
	let out = '';
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		out += decoder.decode(value, { stream: true });
	}
	return out;
}

beforeAll(() => {
	writeFileSync(
		configPath,
		JSON.stringify({ name: '', baseUrl: 'http://test/v1', apiKey: '', models: [], defaultModel: 'm1' })
	);
	fixtureConversation();
});
afterAll(() => {
	rmSync(configPath, { force: true });
	// Only this suite's fixtures — the dir is shared with the user's real chats.
	rmSync(convPath, { force: true });
	rmSync(path.join(process.cwd(), 'data', 'conversations', 'chat-test'), { recursive: true, force: true }); // attachment bytes
});

describe('POST /api/chat (SSE)', () => {
	// Regression: a broken controller guard dropped every frame and never closed
	// the body — the client's read loop hung forever (stuck typing dots, dead title).
	it('streams token + done frames, terminates, and persists the turn', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(ANSWER_SSE)));
		const res = await POST({ request: chatRequest() });
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/event-stream');
		const body = await readAll(res); // hangs (→ timeout) if the stream never closes
		expect(body).toContain('event: token');
		expect(body).toContain('"content":"Hello there"');
		expect(body).toContain('event: done');
		const conv = JSON.parse(readFileSync(convPath, 'utf8')) as { messages: { role: string; content: string }[] };
		expect(conv.messages).toHaveLength(2);
		expect(conv.messages[0]).toMatchObject({ role: 'user', content: 'hi' });
		expect(conv.messages[1]).toMatchObject({ role: 'assistant', content: 'Hello there' });
	});

	it('emits an error event and still terminates when upstream fails', async () => {
		fixtureConversation();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
		const res = await POST({ request: chatRequest() });
		const body = await readAll(res);
		expect(body).toContain('event: error');
		expect(body).toContain('HTTP 500');
	});

	it('stamps the new user message with only the attachments new since the last send', async () => {
		// A was already stamped on the prior turn; B is new this send.
		writeFileSync(
			convPath,
			JSON.stringify({
				id: 'chat-test',
				title: 'New chat',
				createdAt: 1,
				updatedAt: 1,
				model: 'm1',
				messages: [
					{ role: 'user', content: 'first', attachmentIds: ['A'] },
					{ role: 'assistant', content: 'hi' }
				],
				attachments: [
					{ id: 'A', name: 'a.png', size: 4, mime: 'image/png', isImage: true, state: 'ready', createdAt: 1 },
					{ id: 'B', name: 'b.png', size: 4, mime: 'image/png', isImage: true, state: 'ready', createdAt: 2 }
				]
			})
		);
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(ANSWER_SSE)));
		await readAll(await POST({ request: chatRequest() }));
		const conv = JSON.parse(readFileSync(convPath, 'utf8')) as {
			messages: { role: string; content: string; attachmentIds?: string[] }[];
		};
		const userMsgs = conv.messages.filter((m) => m.role === 'user');
		expect(userMsgs.at(-1)?.attachmentIds).toEqual(['B']); // only the new one
	});

	it('invalidates the cached vision result when an image turn 4xxs upstream', async () => {
		fixtureConversation();
		// a real attachment file so the turn actually carries an image upstream
		const imgPath = path.join(process.cwd(), 'data', 'conversations', 'chat-test', 'attachments', 'img1.png');
		mkdirSync(path.dirname(imgPath), { recursive: true });
		writeFileSync(imgPath, Buffer.from('png'));
		const conv = JSON.parse(readFileSync(convPath, 'utf8')) as { attachments?: unknown[] };
		conv.attachments = [{ id: 'img1', name: 'img1.png', size: 3, mime: 'image/png', isImage: true, state: 'ready', createdAt: 1 }];
		writeFileSync(convPath, JSON.stringify(conv));
		writeFileSync(
			configPath,
			JSON.stringify({ name: '', baseUrl: 'http://test/v1', apiKey: '', models: [], defaultModel: 'm1', vision: { m1: true } })
		);
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no images here', { status: 400 })));
		const res = await POST({ request: chatRequest() });
		const body = await readAll(res);
		expect(body).toContain('may not support images');
		const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as { vision?: Record<string, boolean> };
		expect(cfg.vision?.m1).toBeUndefined(); // deleted, so the next selection re-probes
	});
});
