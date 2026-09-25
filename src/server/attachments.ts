import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AttachmentMeta } from '$lib/types';
import { extract } from './extract.js';

const DATA_DIR = process.env.LITECHAT_DATA_DIR ?? path.join(process.cwd(), 'data', 'conversations');

// Upload limits — one place, echoed verbatim into the 400 messages the UI shows.
export const LIMITS = {
	maxFile: 20 * 1024 * 1024, // 20 MB
	maxImage: 8 * 1024 * 1024, // 8 MB — images ship base64'd upstream, ~33% inflation
	maxFiles: 20, // per conversation
	maxTotal: 200 * 1024 * 1024 // 200 MB per conversation
} as const;

// ponytail: 150k-char per-file text cap, a per-file cap that scales if bigger docs matter
const TEXT_CAP = 150_000;

function dirFor(convId: string): string {
	if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(convId)) throw new Error(`Invalid conversation id: ${convId}`);
	return path.join(DATA_DIR, convId, 'attachments');
}

function extOf(meta: AttachmentMeta): string {
	const ext = (meta.name.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
	return ext || 'bin';
}

function fileFor(convId: string, meta: AttachmentMeta): string {
	return path.join(dirFor(convId), `${meta.id}.${extOf(meta)}`);
}

function capText(text: string): string {
	return text.length > TEXT_CAP ? `${text.slice(0, TEXT_CAP)}\n[truncated]` : text;
}

export async function saveAttachment(convId: string, meta: AttachmentMeta, bytes: Uint8Array, text?: string): Promise<void> {
	const f = fileFor(convId, meta);
	await fs.mkdir(path.dirname(f), { recursive: true });
	await fs.writeFile(f, bytes);
	if (text != null) await fs.writeFile(`${f}.txt`, capText(text), 'utf8');
}

// Cached extracted text; self-heals by re-extracting if the cache was deleted by hand.
export async function readAttachmentText(convId: string, meta: AttachmentMeta): Promise<string | null> {
	const f = fileFor(convId, meta);
	try {
		return await fs.readFile(`${f}.txt`, 'utf8');
	} catch {
		try {
			const bytes = new Uint8Array(await fs.readFile(f));
			const { text } = await extract(meta.name, bytes);
			if (!text) return null;
			await fs.writeFile(`${f}.txt`, capText(text), 'utf8');
			return capText(text);
		} catch {
			return null; // bytes gone too — the caller warns and skips
		}
	}
}

export async function readAttachmentBytes(convId: string, meta: AttachmentMeta): Promise<Uint8Array | null> {
	try {
		return new Uint8Array(await fs.readFile(fileFor(convId, meta)));
	} catch {
		return null;
	}
}

export async function deleteAttachment(convId: string, meta: AttachmentMeta): Promise<void> {
	const f = fileFor(convId, meta);
	await fs.rm(f, { force: true }).catch(() => {});
	await fs.rm(`${f}.txt`, { force: true }).catch(() => {});
}
