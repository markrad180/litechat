import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Conversation, ConversationMeta, ReasoningLevel } from '$lib/types';

// Run from the project root: `npm run dev` or `node build`.
// LITECHAT_DATA_DIR (e2e only): a separate store so the suite never shares the user's chats.
const DATA_DIR = process.env.LITECHAT_DATA_DIR ?? path.join(process.cwd(), 'data', 'conversations');

function fileFor(id: string): string {
	if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) throw new Error(`Invalid conversation id: ${id}`);
	return path.join(DATA_DIR, `${id}.json`);
}

async function write(conv: Conversation): Promise<void> {
	await fs.mkdir(DATA_DIR, { recursive: true });
	await fs.writeFile(fileFor(conv.id), JSON.stringify(conv, null, '\t'));
}

export async function listConversations(): Promise<ConversationMeta[]> {
	await fs.mkdir(DATA_DIR, { recursive: true });
	const files = (await fs.readdir(DATA_DIR)).filter((f) => f.endsWith('.json'));
	const convs = (
		await Promise.all(
			files.map(async (f) => {
				try {
					return JSON.parse(await fs.readFile(path.join(DATA_DIR, f), 'utf8')) as Conversation;
				} catch {
					return null; // unreadable/corrupt file — skip, don't crash the list
				}
			})
		)
	).filter((c): c is Conversation => c !== null);
	return convs
		.filter((c) => (c.messages?.length ?? 0) > 0) // empty chats (no messages) aren't listed
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.map(({ id, title, updatedAt, model }) => ({ id, title, updatedAt, model }));
}

// ponytail: backfill v3 fields on old files at the single read path; delete once no pre-v3 files exist
function withDefaults(c: Conversation): Conversation {
	c.webTools ??= true;
	c.reasoning ??= 'medium';
	c.attachments ??= [];
	return c;
}

export async function getConversation(id: string): Promise<Conversation> {
	try {
		return withDefaults(JSON.parse(await fs.readFile(fileFor(id), 'utf8')) as Conversation);
	} catch {
		throw new Error(`Conversation ${id} not found`);
	}
}

export async function createConversation(p: {
	title?: string;
	model?: string;
	endpointId?: string;
	webTools?: boolean;
	reasoning?: ReasoningLevel;
}): Promise<Conversation> {
	const now = Date.now();
	const conv: Conversation = {
		id: randomUUID(),
		title: p.title?.trim() || 'New chat',
		createdAt: now,
		updatedAt: now,
		endpointId: p.endpointId,
		model: p.model,
		messages: [],
		webTools: p.webTools ?? true,
		reasoning: p.reasoning ?? 'medium'
	};
	await write(conv);
	return conv;
}

export async function updateConversation(
	id: string,
	patch: Partial<
		Pick<Conversation, 'title' | 'model' | 'endpointId' | 'messages' | 'attachments' | 'webTools' | 'reasoning'>
	>
): Promise<Conversation> {
	const conv = await getConversation(id);
	const updated: Conversation = { ...conv, ...patch, id, updatedAt: Date.now() };
	await write(updated);
	return updated;
}

export async function deleteConversation(id: string): Promise<void> {
	await fs.unlink(fileFor(id)).catch(() => {});
	// attachments live in a per-conversation dir; the JSON filter above ignores it
	await fs.rm(path.join(DATA_DIR, id), { recursive: true, force: true }).catch(() => {});
}
