import { json } from '@sveltejs/kit';
import { loadConfig } from '$lib/config.js';
import { getConversation, updateConversation } from '../../../../../server/conversations.js';

// Background chat naming: one quick non-reasoning completion to the same model.
// Non-streaming — a title is a single short string, no point in SSE plumbing.
export async function POST({ params }: { params: { id: string } }) {
	const conv = await getConversation(params.id);
	const cfg = loadConfig();
	const model = conv.model ?? cfg.defaultModel;
	const firstUser = conv.messages.find((m) => m.role === 'user')?.content ?? '';
	if (!model) return json({ error: 'No model configured' }, { status: 400 });
	if (!firstUser) return json({ error: 'Nothing to title yet' }, { status: 400 });

	const firstAssistant = conv.messages.find((m) => m.role === 'assistant' && m.content)?.content ?? '';
	const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {})
		},
		body: JSON.stringify({
			model,
			temperature: 0,
			max_tokens: 40,
			// llama.cpp: a thinking model would burn the whole 40-token budget on
			// reasoning and return an empty title; other servers ignore the field
			chat_template_kwargs: { enable_thinking: false },
			messages: [
				{
					role: 'system',
					content:
						'Name this conversation. Reply with only a concise, accurate title: 3-6 words, plain text, no quotes, no trailing punctuation.'
				},
				{
					role: 'user',
					content: `User: ${firstUser.slice(0, 800)}\n\nAssistant: ${firstAssistant.slice(0, 800)}`
				}
			]
		})
	});
	if (!res.ok) {
		const detail = (await res.text().catch(() => '')).slice(0, 200);
		throw new Error(`Model server returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
	}
	const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
	// ponytail: trim, collapse whitespace, then strip surrounding quotes —
	// models occasionally wrap titles in "" (and trailing newlines would hide a
	// closing quote if the strip ran first)
	const title = (data.choices?.[0]?.message?.content ?? '')
		.trim()
		.replace(/\s+/g, ' ')
		.replace(/^["'“”]+|["'“”]+$/g, '')
		.slice(0, 48);
	if (!title) throw new Error('Model returned an empty title');
	await updateConversation(conv.id, { title });
	return json({ title });
}
