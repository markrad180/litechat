import vm from 'node:vm';

// ponytail: vm sandbox + regex allowlist is fine for a local single-user harness, not for hostile input
const ARITHMETIC_ONLY = /^[0-9+\-*/().%\s]+$/;

export function calculator(expression: string): { summary: string; content: string } {
	const expr = expression.trim();
	if (!ARITHMETIC_ONLY.test(expr)) {
		throw new Error(`only arithmetic is allowed (digits, + - * / ( ) . %): "${expression}"`);
	}
	const value = vm.runInNewContext(expr, {}, { timeout: 1000 }) as number;
	if (!Number.isFinite(value)) throw new Error(`no numeric result for "${expr}"`);
	const content = String(value);
	return { summary: `${expr} = ${content}`, content };
}
