import { calculator } from './calculator.js';
import { webFetch } from './web-fetch.js';
import { webSearch } from './web-search.js';

export const toolSchemas = [
	{
		type: 'function',
		function: {
			name: 'web_search',
			description: 'Search the web. Returns the top results with titles, URLs, and snippets.',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'The search query.' }
				},
				required: ['query']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'web_fetch',
			description: 'Fetch a URL and return its readable text content (use to read a page found via web_search).',
			parameters: {
				type: 'object',
				properties: {
					url: { type: 'string', description: 'The URL to fetch.' }
				},
				required: ['url']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'calculator',
			description: 'Evaluate an arithmetic expression (digits and + - * / ( ) . % only).',
			parameters: {
				type: 'object',
				properties: {
					expression: { type: 'string', description: 'Arithmetic expression, e.g. "(2+3)*4".' }
				},
				required: ['expression']
			}
		}
	}
] as const;

type ToolArgs = Record<string, unknown>;

export async function executeTool(name: string, args: ToolArgs): Promise<{ summary: string; content: string }> {
	try {
		switch (name) {
			case 'web_search': {
				const query = String(args.query ?? '');
				if (!query) throw new Error('web_search requires a "query" argument');
				return await webSearch(query);
			}
			case 'web_fetch': {
				const url = String(args.url ?? '');
				if (!url) throw new Error('web_fetch requires a "url" argument');
				return await webFetch(url);
			}
			case 'calculator': {
				const expression = String(args.expression ?? '');
				if (!expression) throw new Error('calculator requires an "expression" argument');
				return calculator(expression);
			}
			default:
				throw new Error(`unknown tool "${name}"`);
		}
	} catch (e) {
		// Tool failures are reported to the model, not thrown — the loop keeps going.
		return { summary: `${name} failed`, content: `Error: ${e instanceof Error ? e.message : String(e)}` };
	}
}
