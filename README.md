# Litechat

A locally hosted, GPT-like web chat for local LLM inference servers
([llama.cpp](https://github.com/ggml-org/llama.cpp), [Ninfer](https://github.com/0xNIN/ninfer), or
any OpenAI-compatible endpoint). Everything runs on your own machine — nothing is
uploaded anywhere. The server streams responses to the browser and runs a small agent
loop with three built-in tools: `web_search`, `web_fetch`, `calculator`.

## Get started (3 steps)

**1. Prerequisites** (one-time):

- **Node.js 20.19 or newer (22 LTS recommended)**
  - macOS: install [Homebrew](https://brew.sh) if you don't have it, then run `brew install node`
  - Linux: your distro's Node.js 22 package, or [nvm](https://github.com/nvm-sh/nvm)
- **A local LLM server that is running** and exposes
  `POST /v1/chat/completions` (with streaming and function calling) and `GET /v1/models`.

**2. Get the code:**

```sh
git clone <repo-url>
cd litechat
```

**3. Launch:**

- **macOS:** double-click the fox icon **`Litechat.app`** in the folder.
- **Linux:** run `./start.sh` in a terminal.

That's it. The script installs dependencies, starts the app, and opens
[http://localhost:5173](http://localhost:5173) in your browser automatically.
A terminal window stays open showing the server — that's normal; close it to stop the app.

### First launch

The app onboards you: enter your LLM server's base URL
(e.g. `http://localhost:8080/v1`), optionally an API key, then pick one of the
models it fetches from the server (or type a name if the server has no `/models` endpoint).

## Updating

When a new version is pushed to the repo:

- **macOS:** double-click **`Update Litechat.app`**
- **Linux:** `./update.sh`

The script stops the running app, pulls the latest code, reinstalls
dependencies, and restarts. Your conversations and settings are **never touched**
(see below).

## Your data

Everything lives in `data/` next to the code, and is ignored by git — so
updating (or re-cloning) never touches your chats:

- `data/config.json` — server URL, API key, model list
- `data/conversations/` — one JSON file per conversation

Delete the `data/` folder to start fresh.

## Technical / manual setup

If you'd rather do it by hand:

```sh
npm install
npm run dev        # http://localhost:5173
```

Production build (binds localhost explicitly — the default `node build`
listens on all network interfaces, which you don't want for this app):

```sh
npm run build
HOST=127.0.0.1 node build   # http://localhost:3000
```

Windows: use Git Bash and the manual steps above.

## Security notes

- Single-user app — there is no login. It relies on the dev server binding to
  **localhost only**, so other devices on your network can't reach it.
- Your API key is sent only to your own LLM server and is never shown in the browser.
- The `web_fetch` tool blocks localhost/private-IP URLs so fetched web content
  can't be used to probe your local network.
- Keep the repo's `data/` folder private if you care about your chat history.

## Usage

- Pick a model with the chip above the composer (cached list + free text).
  Each conversation remembers its own model.
- The **Web** chip (accent-colored when on) and the **Reasoning** select
  (next to the model picker) toggle `web_search`/`web_fetch` and send
  `reasoning_effort` per conversation; calculator is always on. The top level
  shows as **Ultra** in the UI; the wire value is `xhigh`.
- Chat. Tokens stream in live; background thinking streams into a collapsible
  *Thinking · \<level\>* block above the reply (when the model emits reasoning
  and a level above Off is selected — Off shows no thinking block, even if the
  server thinks).
- Ask for arithmetic ("what's 6*7?") to see the calculator tool; ask it to
  search the web to see `web_search` / `web_fetch` activity rows.
- When the server reports token usage, a stealth stats row appears under the
  reply: prefill speed, decode speed (t/s, K-scaled past 1000), and wall time
  (m/s). Servers that ignore `stream_options` simply don't show it.
- The moon/sun icon (sidebar bottom) toggles the light/dark theme.
- Conversations persist to `data/conversations/<id>.json`; the sidebar lists,
  creates, and deletes them.

### Configuration

- Edit settings in **Settings** (gear icon, bottom of the sidebar): a centered
  modal with **Server** and **Visual** tabs. The Server tab edits name, base
  URL, API key, "Fetch models", and the default model.
  `PUT /api/config` merges partial updates; the API key is only sent to the
  model server and is never exposed to the browser.
- The **Visual** tab picks the app's accent color from a 15-color palette.
  It's stored per browser (localStorage, like the theme) and applied
  pre-hydration, so it persists across reloads with no flash.

## Tests

```sh
npm test          # unit tests: config/migration, models parsing, tools, stream accumulation (no LLM required)
npm run check     # svelte-check
```
