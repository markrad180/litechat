import { json } from '@sveltejs/kit';
import { getConversation, updateConversation } from '../../../../../../server/conversations.js';
import { deleteAttachment, readAttachmentBytes } from '../../../../../../server/attachments.js';

async function find(params: { id: string; fileId: string }) {
	try {
		const conv = await getConversation(params.id);
		const meta = (conv.attachments ?? []).find((a) => a.id === params.fileId);
		return meta ? { conv, meta } : null;
	} catch {
		return null;
	}
}

export async function GET({ params }: { params: { id: string; fileId: string } }) {
	const hit = await find(params);
	if (!hit) return json({ error: 'Attachment not found' }, { status: 404 });
	const bytes = await readAttachmentBytes(params.id, hit.meta);
	if (!bytes) return json({ error: 'Attachment file is missing on disk' }, { status: 404 });
	return new Response(Buffer.from(bytes), {
		headers: {
			'content-type': hit.meta.mime,
			'content-disposition': `inline; filename="${hit.meta.name.replace(/"/g, '')}"`,
			'cache-control': 'no-cache'
		}
	});
}

export async function DELETE({ params }: { params: { id: string; fileId: string } }) {
	const hit = await find(params);
	if (!hit) return json({ error: 'Attachment not found' }, { status: 404 });
	await deleteAttachment(params.id, hit.meta);
	await updateConversation(params.id, {
		attachments: (hit.conv.attachments ?? []).filter((a) => a.id !== params.fileId)
	});
	return json({ ok: true });
}
