import { json } from '@sveltejs/kit';
import { createConversation, listConversations } from '../../../server/conversations.js';


export async function GET() {
	return json(await listConversations());
}

export async function POST({ request }: { request: Request }) {
	return json(await createConversation(await request.json()), { status: 201 });
}
