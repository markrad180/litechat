// Pure per-turn stat formatters. Stealth row under each response.

// 1234 → "1.2K"; 999 → "999"
export function fmtCount(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`;
}

// 2700 → "2.7K t/s"; 42 → "42 t/s". Zero/NaN wall time guards against 1/0.
export function fmtRate(tokens: number, secs: number): string {
	const rate = secs > 0 ? Math.round(tokens / secs) : 0;
	return `${fmtCount(rate)} t/s`;
}

// 83000 → "1m23s"; 42000 → "42s"; 400 → "0.4s"
export function fmtWall(ms: number): string {
	if (ms >= 60_000) {
		const m = Math.floor(ms / 60_000);
		const s = Math.round((ms % 60_000) / 1000);
		return `${m}m${s}s`;
	}
	if (ms >= 1000) return `${Math.round(ms / 1000)}s`;
	return `${(ms / 1000).toFixed(1)}s`;
}
