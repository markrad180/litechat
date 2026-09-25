import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { POST } from './+server.js';

// vitest.setup.ts points LITECHAT_CONFIG at a scratch config file, so the
// fixture never touches the user's real data/config.json.
const configPath = path.join(process.cwd(), 'data', 'test-config.json');
const convPath = path.join(process.cwd(), 'data', 'conversations', 'title-test.json');

function fixtureConversation(messages: unknown[]) {
	writeFileSync(
		convPath,
		JSON.stringify({
			id: 'title-test',
			title: 'New chat',
			createdAt: 1,
			updatedAt: 1,
			model: 'm1',
			messages
		})
	);
}

beforeAll(() => {
	writeFileSync(
		configPath,
		JSON.stringify({ name: '', baseUrl: 'http://test/v1', apiKey: '', models: [], defaultModel: 'm1' })
	);
	fixtureConversation([
		{ role: 'user', content: 'How do I bake sourdough?' },
		{ role: 'assistant', content: 'Start with an active starter…' }
	]);
});
afterAll(() => {
	rmSync(configPath, { force: true });
	rmSync(convPath, { force: true });
});

function mockCompletion(content: string) {
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
		)
	);
}

describe('POST /api/conversations/:id/title', () => {
	it('names the chat from the model reply and persists it', async () => {
		mockCompletion('Sourdough baking basics');
		const res = await POST({ params: { id: 'title-test' } });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ title: 'Sourdough baking basics' });
		expect((JSON.parse(readFileSync(convPath, 'utf8')) as { title: string }).title).toBe(
			'Sourdough baking basics'
		);
	});

	it('strips wrapping quotes and collapses whitespace', async () => {
		mockCompletion('"Baking\nchat"\n');
		const res = await POST({ params: { id: 'title-test' } });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ title: 'Baking chat' });
	});

	it('400s when there is no user message to title', async () => {
		fixtureConversation([]);
		const res = await POST({ params: { id: 'title-test' } });
		expect(res.status).toBe(400);
	});
});
