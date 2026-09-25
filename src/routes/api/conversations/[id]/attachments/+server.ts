import { json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { getConversation, updateConversation } from '../../../../../server/conversations.js';
import { extract } from '../../../../../server/extract.js';
import { saveAttachment, LIMITS } from '../../../../../server/attachments.js';
import type { AttachmentMeta } from '$lib/types';

const MB = 1024 * 1024;
const mb = (n: number) => `${Math.round(n / MB)} MB`;

export async function POST({ request, params }: { request: Request; params: { id: string } }) {
	let conv;
	try {
		conv = await getConversation(params.id);
	} catch {
		return json({ error: 'Conversation not found' }, { status: 404 });
	}

	let form: FormData;
	try {
		form = await request.formData(); // web standard — no multipart dep
	} catch {
		return json({ error: 'Expected a multipart form with a "file" field' }, { status: 400 });
	}
	const file = form.get('file');
	if (!(file instanceof File)) return json({ error: 'No file provided (field "file")' }, { status: 400 });

	// Limits are checked on File.size before any bytes are read; the strings below are
	// the exact chip/banner messages the UI renders verbatim.
	const isImage = /\.(png|jpe?g|webp)$/i.test(file.name);
	const max = isImage ? LIMITS.maxImage : LIMITS.maxFile;
	if (file.size > max)
		return json({ error: `"${file.name}" is ${mb(file.size)} — the limit is ${mb(max)}${isImage ? ' for images' : ''}` }, { status: 400 });
	if ((conv.attachments ?? []).length >= LIMITS.maxFiles)
		return json({ error: `Too many attachments — the limit is ${LIMITS.maxFiles} per conversation` }, { status: 400 });
	const total = (conv.attachments ?? []).reduce((s, a) => s + a.size, 0) + file.size;
	if (total > LIMITS.maxTotal)
		return json({ error: `Conversation attachments would exceed the ${mb(LIMITS.maxTotal)} total limit` }, { status: 400 });

	const meta: AttachmentMeta = {
		id: randomUUID(),
		name: file.name,
		size: file.size,
		mime: file.type || 'application/octet-stream',
		isImage: false,
		state: 'ready',
		createdAt: Date.now()
	};
	const bytes = new Uint8Array(await file.arrayBuffer());
	const extracted = await extract(file.name, bytes);
	meta.isImage = extracted.isImage;
	if (!extracted.isImage && !extracted.text) {
		meta.state = 'error';
		meta.error = extracted.error; // per-file failure — saved anyway so the chip can show why
	}
	await saveAttachment(params.id, meta, bytes, extracted.text);
	await updateConversation(params.id, { attachments: [...(conv.attachments ?? []), meta] });
	return json({ attachment: meta }, { status: 201 });
}
