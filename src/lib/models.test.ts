import { describe, expect, it } from 'vitest';
import { parseModels } from './models.js';

describe('parseModels', () => {
	it('reads ids and the ninfer/vLLM max_model_len ceiling', () => {
		const out = parseModels({
			data: [{ id: 'Qwen3.8-27B-SWIFT', max_model_len: 180224, object: 'model' }]
		});
		expect(out.ids).toEqual(['Qwen3.8-27B-SWIFT']);
		expect(out.context).toEqual({ 'Qwen3.8-27B-SWIFT': 180224 });
	});

	it('falls back through the other context key names', () => {
		const out = parseModels({
			data: [
				{ id: 'a', context_length: 8192 },
				{ id: 'b', max_model_len: 'not-a-number', max_tokens: 4096 }
			]
		});
		expect(out.ids).toEqual(['a', 'b']);
		expect(out.context).toEqual({ a: 8192, b: 4096 });
	});

	it('omits context when no key is present and tolerates garbage', () => {
		expect(parseModels({ data: [{ id: 'x' }, 'junk', null, { id: '' }] }).ids).toEqual(['x']);
		expect(parseModels(null)).toEqual({ ids: [], context: {} });
		expect(parseModels({ data: 'nope' })).toEqual({ ids: [], context: {} });
	});
});
