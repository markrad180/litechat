import { json } from '@sveltejs/kit';
import { deleteConversation, getConversation, updateConversation } from '../../../../server/conversations.js';


function notFound() {
	return json({ error: 'Not found' }, { status: 404 });
}

export async function GET({ params }: { params: { id: string } }) {
	try {
		return json(await getConversation(params.id));
	} catch {
		return notFound();
	}
}

export async function PUT({ request, params }: { request: Request; params: { id: string } }) {
	try {
		return json(await updateConversation(params.id, await request.json()));
	} catch (e) {
		return e instanceof Error && e.message.includes('not found') ? notFound() : json({ error: 'Bad request' }, { status: 400 });
	}
}

export async function DELETE({ params }: { params: { id: string } }) {
	await deleteConversation(params.id);
	return json({ ok: true });
}
