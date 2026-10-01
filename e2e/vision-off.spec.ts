import { expect, test } from '@playwright/test';
import { rmSync, writeFileSync } from 'node:fs';
import { VISION_OFF_FLAG } from './mock-upstream.js';

// The reported bug, end to end: the upstream server flips vision off; the app
// picks it up via a tile Refresh (forced re-probe) with NO browser reload — the
// chip disappears, image attaches are rejected outright (nothing staged), and
// deleting the active server lands in the re-add flow.

const RED_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const png = () => ({ name: 'A.png', mimeType: 'image/png', buffer: Buffer.from(RED_PNG, 'base64') });
// 32+ non-whitespace chars — extract() rejects shorter files as "no extractable text"
const notes = {
	name: 'notes.txt',
	mimeType: 'text/plain',
	buffer: Buffer.from('hello attachment — enough characters to clear the extraction minimum')
};

test('vision flip: tile refresh re-probes, chip gone, attach rejected, delete + re-add', async ({ page }) => {
	await page.goto('/');
	// baseline: the mock model is vision-capable — the pill renders and images stage
	await expect(page.getByText('mock-1', { exact: true })).toBeVisible();
	await expect(page.locator('.vision-chip')).toHaveClass('vision-chip');
	await page.locator('.file-input').setInputFiles(png());
	await expect(page.locator('.att-chip.ready')).toBeVisible({ timeout: 10_000 });
	await page.locator('.new-btn').click(); // clear the staged chip

	// the upstream flips vision off
	writeFileSync(VISION_OFF_FLAG, '');

	// Servers panel (via Settings) → Refresh the tile: a forced re-probe overwrites the record
	await page.getByRole('button', { name: 'Settings' }).click();
	await page.getByRole('button', { name: 'Manage servers' }).click();
	await expect(page.getByText('Add a server')).toBeVisible(); // the “+” tile — the form is behind it
	await page.getByRole('button', { name: 'Refresh' }).click();
	await expect(page.getByText('1 model', { exact: true })).toBeVisible(); // no "· 1 with images"
	await page.keyboard.press('Escape');
	// the chip is gone — and there is no "Vision off" chip either
	await expect(page.locator('.vision-chip')).toHaveCount(0);

	// image attach is rejected outright: banner, nothing staged; a doc in the same batch still stages
	await page.locator('.file-input').setInputFiles([png(), notes]);
	await expect(page.getByText('Model “mock-1” doesn’t support images — images can’t be attached')).toBeVisible();
	await expect(page.locator('.att-chip.ready')).toBeVisible(); // the notes file
	expect(await page.locator('.att-chip').count()).toBe(1);
	await page.locator('.new-btn').click();

	// delete the active server → confirm → the required re-add flow → back in the shell
	await page.getByRole('button', { name: 'Settings' }).click();
	await page.getByRole('button', { name: 'Manage servers' }).click();
	await page.getByRole('button', { name: 'Delete', exact: true }).click(); // tile button (sidebar del buttons are "Delete …")
	await page.locator('.confirm-modal .btn-danger').click();
	await expect(page.getByText('Connect a model server')).toBeVisible();
	await page.locator('.server-flow input[placeholder="http://localhost:8080/v1"]').fill('http://127.0.0.1:9977/v1');
	await page.getByRole('button', { name: 'Add' }).click();
	// the new server auto-activated (nothing was active) and seeds the model picker
	await expect(page.locator('.server-flow')).toHaveCount(0);
	await expect(page.getByText('mock-1', { exact: true })).toBeVisible();
	rmSync(VISION_OFF_FLAG, { force: true });
});
