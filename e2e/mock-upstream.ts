import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

// A tiny mock model server for E2E. Exposes:
//  - GET  /v1/models           → one model id
//  - POST /v1/chat/completions → streaming (SSE) or a single title completion
// The dev server points at it via a scratch config (LITECHAT_CONFIG) so the
// suite never touches the user's real data/config.json or model server.

const PORT = 9977;
const HOST = '127.0.0.1';
const CONFIG_PATH = path.join(process.cwd(), 'data', 'e2e-config.json');
// The suite's own conversation store (LITECHAT_DATA_DIR, set in playwright.config) —
// separate from the user's chats, and wiped per run so stale entries can never
// leak into the sidebar and skew the tests' title assertions.
const CONV_DIR = path.join(process.cwd(), 'data', 'e2e-conversations');

// Streaming /v1/chat/completions request bodies, in order — assertions on what
// the wire actually carried (e.g. which image rides which turn). The mock runs
// in the globalSetup process, so tests read it back over /v1/captured.
const capturedBodies: { messages?: unknown[] }[] = [];

export async function startMock(): Promise<void> {
	rmSync(CONV_DIR, { recursive: true, force: true });
	mkdirSync(CONV_DIR, { recursive: true });
	writeFileSync(
		CONFIG_PATH,
		JSON.stringify(
			{
				name: 'e2e',
				baseUrl: `http://${HOST}:${PORT}/v1`,
				apiKey: 'test',
				models: ['mock-1'],
				defaultModel: 'mock-1',
				vision: { 'mock-1': true },
				contextReserve: 0.11,
				theme: 'light'
			},
			null,
			'\t'
		)
	);

	const server = http.createServer((req, res) => {
		const url = req.url ?? '';

		if (req.method === 'GET' && url.startsWith('/v1/captured')) {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify(capturedBodies));
			return;
		}

		if (req.method === 'GET' && url.startsWith('/v1/models')) {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ data: [{ id: 'mock-1' }] }));
			return;
		}

		if (req.method === 'POST' && url.startsWith('/v1/chat/completions')) {
			let body = '';
			req.on('data', (c) => (body += c));
			req.on('end', () => {
				let parsed: { stream?: boolean; messages?: unknown[] } = {};
				try {
					parsed = JSON.parse(body);
				} catch {
					/* body may be empty */
				}
				if (parsed.stream === true) capturedBodies.push(parsed);

				if (!parsed.stream) {
					// Title endpoint: non-streaming single completion. Derive the
					// title from the first user message so the suite's
					// conversations stay distinguishable in the sidebar.
					let title = 'E2E chat';
					try {
						// the title request wraps the first exchange as "User: …\n\nAssistant: …"
						const firstUser = (JSON.parse(body) as { messages?: { role: string; content: string }[] }).messages
							?.find((m) => m.role === 'user')?.content?.replace(/^User: /, '');
						if (firstUser) title = `E2E: ${firstUser.slice(0, 24)}`;
					} catch {
						/* keep default */
					}
					res.writeHead(200, { 'content-type': 'application/json' });
					res.end(
						JSON.stringify({
							choices: [{ message: { content: title } }],
							usage: { prompt_tokens: 10, completion_tokens: 4 }
						})
					);
					return;
				}

				res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
				// ~30 token frames at 50ms spacing so a stop mid-stream is reliable.
				let i = 0;
				const total = 30;
				const timer = setInterval(() => {
					res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `tok${i} ` } }] })}\n\n`);
					if (++i >= total) {
						clearInterval(timer);
						res.write('data: [DONE]\n\n');
						res.end();
					}
				}, 50);
			});
			return;
		}

		res.writeHead(404, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ error: 'not found' }));
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(PORT, HOST, () => resolve());
	});
	// Expose so teardown can close it.
	(process as unknown as { __mock?: http.Server }).__mock = server;
}

export async function stopMock(): Promise<void> {
	const server = (process as unknown as { __mock?: http.Server }).__mock;
	if (server) {
		server.closeAllConnections(); // keep-alive pins server.close() otherwise
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
	rmSync(CONV_DIR, { recursive: true, force: true });
	rmSync(CONFIG_PATH, { force: true });
}

// Playwright globalSetup contract: the default export is the setup; returning a
// function makes it the global teardown (this @playwright/test version has no
// named `teardown`-export support).
export default async function setup(): Promise<() => Promise<void>> {
	await startMock();
	return stopMock;
}
