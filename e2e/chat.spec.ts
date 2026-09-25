import { expect, test, type Page } from '@playwright/test';

// One sequential flow, one page: the chat lifecycle is stateful, so a single
// test keeps the steps ordered and every assertion unambiguous. Fails at the
// first broken step — that's the ship gate.

// Line count of a user bubble: content height minus the 10px top/bottom padding,
// over line-height. Guards the 85%-of-self max-width bug that split "hi" into
// "h" / "i" — short bubbles must stay single-line.
async function userBubbleLines(page: Page, text: string): Promise<number> {
	return page.evaluate((t) => {
		const el = [...document.querySelectorAll('.msg.user .content')].find((b) => b.textContent.trim() === t)!;
		return Math.round((el.getBoundingClientRect().height - 20) / parseFloat(getComputedStyle(el).lineHeight));
	}, text);
}
test('chat lifecycle: stream, title, stop, persist, attachments, layout', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

	await page.goto('/');

	// models path: the picker shows the mock model from the scratch config
	await expect(page.getByText('mock-1', { exact: true })).toBeVisible();

	// composer geometry: the textarea spans the full card width (no diagonal
	// clip at the attach icon) and the icon row sits below it
	const card = (await page.locator('.composer-card').boundingBox())!;
	const ta = page.locator('.composer-card textarea');
	const taBox = (await ta.boundingBox())!;
	expect(taBox.x - card.x).toBeLessThanOrEqual(14); // starts at the left padding edge
	expect(card.x + card.width - (taBox.x + taBox.width)).toBeLessThanOrEqual(14); // ends at the right padding edge
	const line = (await page.locator('.composer-line').boundingBox())!;
	expect(line.y).toBeGreaterThanOrEqual(taBox.y + taBox.height - 1); // icons on the next line

	// send: dots appear, the reply streams in, and the dots clear — no refresh needed
	await ta.fill('What is the capital of France?');
	await ta.press('Enter');
	const dots = page.locator('[aria-label="Assistant is working"]');
	await expect(dots).toBeVisible();
	await expect(dots).toBeHidden({ timeout: 20_000 });
	await expect(page.getByText('tok0')).toBeVisible();
	await expect(page.locator('.error-banner')).toHaveCount(0);
	expect(await userBubbleLines(page, 'What is the capital of France?')).toBe(1); // not wrapped by its own max-width

	// the chat gets named in the sidebar
	await expect(page.locator('.conv-list').getByText('E2E: What is the capital of F')).toBeVisible({ timeout: 15_000 });

	// stop: the send button becomes a stop button and aborts mid-stream
	await page.locator('.new-btn').click(); // "New chat" text is ambiguous with sidebar entries
	await ta.fill('Tell me a long story');
	await ta.press('Enter');
	const stop = page.getByRole('button', { name: 'Stop generating' });
	await expect(stop).toBeVisible();
	await expect(page.getByText('tok3')).toBeVisible({ timeout: 20_000 }); // a few tokens in
	await stop.click();
	await expect(ta).toBeEnabled(); // input unlocks
	await expect(page.locator('.error-banner')).toHaveCount(0); // no bogus error
	await expect(page.getByText(/tok\d/).first()).toBeVisible({ timeout: 20_000 }); // the partial reply stays
	expect(await userBubbleLines(page, 'Tell me a long story')).toBe(1);
	// the stopped chat gets named too — the user message is persisted up front
	await expect(page.locator('.conv-list').getByText('E2E: Tell me a long story')).toBeVisible({ timeout: 15_000 });

	// reload: history and titles persist
	await page.reload();
	await page.locator('.conv-list').getByText('E2E: What is the capital of F').click();
	await expect(page.getByText('tok0')).toBeVisible();
	await page.locator('.conv-list').getByText('E2E: Tell me a long story').click();
	await expect(page.getByText(/tok\d/).first()).toBeVisible();

	// attachments: the chip reaches ready and is consumed by the next send
	await page
		.locator('.file-input')
		// 32+ non-whitespace chars — extract() rejects shorter files as "no extractable text"
		.setInputFiles({
			name: 'notes.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from('hello attachment — enough characters to clear the extraction minimum')
		});
	await expect(page.locator('.att-chip.ready')).toBeVisible({ timeout: 10_000 });
	// non-image attachment keeps the paperclip icon and leaves the Vision pill neutral
	expect(await page.locator('.att-chip.ready svg rect').count()).toBe(0);
	await expect(page.locator('.vision-chip')).toHaveClass('vision-chip');
	await ta.fill('Read my notes');
	await ta.press('Enter');
	// the doc shows in the sent bubble immediately — no wait for finalize
	await expect(page.locator('.msg.user .att-chip')).toBeVisible();
	await expect(dots).toBeHidden({ timeout: 20_000 });
	// the composer chip is consumed (the bubble chip is the persisted attachment — scoped, not global)
	await expect(page.locator('.composer-card .att-chip')).toHaveCount(0);

	// no uncaught JS errors or console errors across the whole flow
	expect(errors).toEqual([]);
});

// 1×1 PNGs, valid so the browser renders the thumb (alt asserts the mapping)
const RED_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const BLUE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC';
const dataUri = (b64: string) => `data:image/png;base64,${b64}`;

type WireMsg = { role: string; content: string | { type: string; text?: string; image_url?: { url: string } }[] };
function imageUrls(m: WireMsg): string[] {
	return typeof m.content === 'string' ? [] : m.content.filter((b) => b.type === 'image_url').map((b) => b.image_url!.url);
}
function userMsgs(body: { messages?: unknown[] }): WireMsg[] {
	return (body.messages as WireMsg[]).filter((m) => m.role === 'user');
}

// The mock lives in the globalSetup process — read its captured bodies back over HTTP.
const MOCK = 'http://127.0.0.1:9977';
async function completionsSince(before: number): Promise<{ messages?: unknown[] }[]> {
	const res = await fetch(`${MOCK}/v1/captured`);
	return ((await res.json()) as { messages?: unknown[] }[]).slice(before);
}

test('two images: each bubble shows only its own; each image ships on its own turn', async ({ page }) => {
	const before = (await (await fetch(`${MOCK}/v1/captured`)).json() as unknown[]).length;
	await page.goto('/');
	await expect(page.getByText('mock-1', { exact: true })).toBeVisible();
	const ta = page.locator('.composer-card textarea');

	// the mock model is vision-capable: the pill renders, neutral until an image is attached
	await expect(page.locator('.vision-chip')).toHaveClass('vision-chip');

	// The working dots vanish on the FIRST token, so they are no "stream done" gate —
	// wait for the final frame instead, plus finalize (chips cleared = the turn is
	// persisted and streaming is off, safe to start the next one).
	const turnSettled = () =>
		Promise.all([
			expect(page.getByText('tok29')).toBeVisible({ timeout: 20_000 }),
			expect(page.locator('.att-chip')).toHaveCount(0, { timeout: 20_000 })
		]);

	await page
		.locator('.file-input')
		.setInputFiles({ name: 'A.png', mimeType: 'image/png', buffer: Buffer.from(RED_PNG, 'base64') });
	await expect(page.locator('.att-chip.ready')).toBeVisible({ timeout: 10_000 });
	// image chip wears the Vision pill's image icon, and the pill lights up with the shimmer
	expect(await page.locator('.att-chip.ready svg rect').count()).toBe(1);
	expect(await page.locator('.att-chip.ready svg circle').count()).toBe(1);
	await expect(page.locator('.vision-chip')).toHaveClass('vision-chip on');
	await expect(page.locator('.vision-chip')).toHaveAttribute('title', 'Image attached — included with your next message');
	await expect(page.locator('.vision-chip .spark')).toHaveCount(3);
	expect(await page.locator('.vision-chip .spark').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('vision-sparkle');
	await ta.fill('What is A');
	await ta.press('Enter');
	// the image shows in the sent bubble immediately — no wait for finalize
	await expect(page.locator('.msg.user .att-thumb')).toBeVisible();
	await turnSettled();

	await page
		.locator('.file-input')
		.setInputFiles({ name: 'B.png', mimeType: 'image/png', buffer: Buffer.from(BLUE_PNG, 'base64') });
	await expect(page.locator('.att-chip.ready')).toBeVisible({ timeout: 10_000 });
	await ta.fill('What is B');
	await ta.press('Enter');
	await turnSettled();

	// display: bubble 1 shows only A, bubble 2 shows only B
	const bubbles = page.locator('.msg.user');
	expect(await bubbles.count()).toBe(2);
	expect(await bubbles.nth(0).locator('.att-thumb').count()).toBe(1);
	expect(await bubbles.nth(1).locator('.att-thumb').count()).toBe(1);
	expect(await bubbles.nth(0).locator('.att-thumb').getAttribute('alt')).toBe('A.png');
	expect(await bubbles.nth(1).locator('.att-thumb').getAttribute('alt')).toBe('B.png');

	// lightbox: clicking a bubble image opens the large view, Escape closes it
	await bubbles.nth(0).locator('.att-thumb').click();
	const lightboxImg = page.locator('.lightbox-img');
	await expect(lightboxImg).toBeVisible();
	await expect(lightboxImg).toHaveAttribute('alt', 'A.png');
	await page.keyboard.press('Escape');
	await expect(lightboxImg).toHaveCount(0);

	// wire: turn 1 carried A; turn 2 carries B on the newest message and A on its own turn
	const [t1, t2] = await completionsSince(before);
	expect(userMsgs(t1)).toHaveLength(1);
	expect(imageUrls(userMsgs(t1)[0])).toEqual([dataUri(RED_PNG)]);
	expect(userMsgs(t2)).toHaveLength(2);
	expect(imageUrls(userMsgs(t2)[0])).toEqual([dataUri(RED_PNG)]); // A stays on turn 1
	expect(imageUrls(userMsgs(t2).at(-1)!)).toEqual([dataUri(BLUE_PNG)]); // B on its own message
	// the newest image's turn carries its label so a bare "the picture" resolves to it
	expect(
		(userMsgs(t2).at(-1)!.content as { text?: string }[]).find((b) => b.type === 'text')?.text
	).toBe('What is B\n\n[Picture 2: B.png]');
	// and with 2+ pictures shipping, the disambiguation note rides the wire as a system msg
	const sys = (t2.messages as WireMsg[]).find((m) => m.role === 'system');
	expect(typeof sys?.content === 'string' ? sys.content : '').toMatch(/most recently attached/i);
});
