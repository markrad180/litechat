import { describe, expect, it } from 'vitest';
import { fmtCount, fmtRate, fmtWall } from './stats.js';

describe('fmtCount', () => {
	it('scales to K above 1000', () => {
		expect(fmtCount(1234)).toBe('1.2K');
	});

	it('shows plain values below 1000', () => {
		expect(fmtCount(999)).toBe('999');
	});
});

describe('fmtRate', () => {
	it('scales to K above 1000 t/s', () => {
		expect(fmtRate(2700, 1)).toBe('2.7K t/s');
	});

	it('rounds plain values', () => {
		expect(fmtRate(999, 1)).toBe('999 t/s');
		expect(fmtRate(42, 1)).toBe('42 t/s');
	});

	it('guards zero wall time', () => {
		expect(fmtRate(100, 0)).toBe('0 t/s');
	});
});

describe('fmtWall', () => {
	it('scales to minutes/seconds at 60s', () => {
		expect(fmtWall(83_000)).toBe('1m23s');
	});

	it('shows whole seconds below a minute', () => {
		expect(fmtWall(42_000)).toBe('42s');
	});

	it('shows one decimal under a second', () => {
		expect(fmtWall(400)).toBe('0.4s');
	});
});
