import { describe, expect, it } from 'vitest';
import { fullDate, timeAgo } from './time.js';

describe('timeAgo', () => {
	it('uses relative buckets for recent timestamps', () => {
		expect(timeAgo(Date.now() - 30_000)).toBe('now');
		expect(timeAgo(Date.now() - 5 * 60_000)).toBe('5m');
		expect(timeAgo(Date.now() - 3 * 3600_000)).toBe('3h');
	});

	// ponytail: pinned to 2026 — update the year when the test starts failing in a new year
	it('uses month + day for this year, mm/dd/yy for other years', () => {
		expect(timeAgo(new Date(2026, 0, 15).getTime())).toBe('Jan 15');
		expect(timeAgo(new Date(2024, 4, 15).getTime())).toBe('05/15/24');
	});
});

describe('fullDate', () => {
	it('renders the full date and time', () => {
		expect(fullDate(new Date(2026, 8, 29, 15, 42).getTime())).toBe('Sep 29, 2026, 3:42 PM');
	});
});
