import { json } from '@sveltejs/kit';

// Stop the local app server (not the LLM endpoint — that's a separate process).
// The delay lets the response flush; start.sh's `wait` then returns and its
// trap removes server.pid, and the app-bundle launch closes the Terminal tab.
export function POST() {
	setTimeout(() => process.exit(0), 50);
	return json({ ok: true });
}
