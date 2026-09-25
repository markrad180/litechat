import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listConversations } from './conversations.js';

// Fixtures live in the real data/conversations dir (like the title test) under
// unique ids, cleaned up in afterAll. The dir may be gone if a sibling suite's
// teardown ran first — recreate it (recursive = no-op when present).
const convDir = path.join(process.cwd(), 'data', 'conversations');
const emptyPath = path.join(convDir, 'list-test-empty.json');
const fullPath = path.join(convDir, 'list-test-full.json');

function fixture(id: string, messages: unknown[]) {
	mkdirSync(convDir, { recursive: true });
	writeFileSync(
		path.join(convDir, `${id}.json`),
		JSON.stringify({ id, title: 'New chat', createdAt: 1, updatedAt: 1, messages })
	);
}

beforeAll(() => {
	fixture('list-test-empty', []);
	fixture('list-test-full', [{ role: 'user', content: 'hi' }]);
});
afterAll(() => {
	rmSync(emptyPath, { force: true });
	rmSync(fullPath, { force: true });
});

describe('listConversations', () => {
	it('omits conversations with no messages', async () => {
		const ids = (await listConversations()).map((c) => c.id);
		expect(ids).toContain('list-test-full');
		expect(ids).not.toContain('list-test-empty');
	});
});
