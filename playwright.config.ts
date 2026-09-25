import { defineConfig } from '@playwright/test';

// E2E smoke: the dev server runs with a scratch config (LITECHAT_CONFIG, written
// by e2e/mock-upstream.ts) pointing at a local mock model server, so the suite
// never touches the user's real config or model server.
export default defineConfig({
	testDir: 'e2e',
	timeout: 60_000,
	retries: 0,
	workers: 1,
	globalSetup: './e2e/mock-upstream',
	use: {
		baseURL: 'http://localhost:5199',
		headless: true
	},
	webServer: {
		command:
			'LITECHAT_CONFIG=data/e2e-config.json LITECHAT_DATA_DIR=data/e2e-conversations npx vite dev --port 5199 --strictPort',
		url: 'http://localhost:5199',
		reuseExistingServer: true,
		timeout: 60_000
	}
});
