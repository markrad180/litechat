# Changelog

All notable changes to LiteChat are documented here.

## [0.3.0] - 2026-09-25

### Added

- Stop generating: while a reply is streaming, the send button becomes a stop button — abort it and the partial reply stays and is saved.
- Per-model capability probe: selecting a model checks the server for vision support and accepted reasoning efforts (a tiny test image + one-token completion probes, cached per endpoint).
- Vision chip in the composer dock for models that accept images; it lights up when an image is attached and will ride along with the next message.
- Image lightbox: click a thumbnail in any message for a full-size view.
- Image thumbnails on your message appear immediately while the reply streams.

### Changed

- Images attach to the message that added them: each image is sent once, and old turns with images can now be auto-trimmed.
- Reasoning levels the selected model doesn't accept are dimmed in the picker, and the request is clamped to its accepted set — no more mid-turn 400s from unsupported efforts.
- Composer: the text box now spans the full width with the attach and send/stop buttons on the row below.

### Fixed

- WebP images are converted to PNG before upload so servers that can't decode WebP don't reject the whole message.
- Short user messages no longer wrap to two lines.
- Web search/fetch tools can no longer hang forever (30-second cap) and respond to stop.
- Confirmed non-vision models reject image attachments with a clear chip instead of a server error.

## [0.2.1] - 2026-09-25

### Fixed

- "Update LiteChat.app" no longer starts the server. It now only stops a running server, pulls the latest code, and updates dependencies — launch LiteChat.app separately to start the app.
- The `/favicon.ico` 404 in the browser console: the app now serves a favicon.
- All npm audit vulnerabilities are resolved: `xlsx` (SheetJS) moved to the patched 0.20.3 release from SheetJS's official CDN (npm's copy was stuck at vulnerable 0.18.5), and the `cookie` dependency via `@sveltejs/kit` is pinned to the patched 0.7.x line.
- Dependency installation no longer prints audit/funding reports to the terminal.

## [0.2.0] - 2026-09-25

### Added

- File attachments: pick files with the attach button or drag them anywhere in the app (full-window drop zone). Stored per conversation under `data/conversations/<id>/attachments/`.
- Text extraction from PDF, DOCX, XLSX, PPTX, EPUB, ZIP, code, and plain-text files; extracted text is stuffed into the model's context each turn.
- Images (PNG/JPG/WEBP) are sent to vision models and shown as thumbnails in messages.
- Per-conversation limits (20 MB per file, 8 MB per image, 20 files, 200 MB total) with per-file error chips.
- About dialog: long-press the "LiteChat" logo for the version and links to the GitHub repo, README, changelog, and license.
- Model picker: search filter, a Retry button when the server is unreachable, and online providers/routers (OpenRouter, LiteLLM) — not just local servers.
- Preferences (theme, accent, sidebar width, composer height) are stored with your data folder instead of the browser, with a one-time migration from browser storage — they now survive browser changes and reinstalls.
- MIT license.

### Changed

- Composer: the attach button moved to the left of the message box.
- The message box is resizable: a grip appears when text clips — drag it up to expand; the height is remembered across reloads.
- The sidebar width is remembered across reloads.
- The sidebar only shows chats that have messages: starting a new chat no longer adds a "New chat" row until the first message is sent.
- The version moved out of the Settings menu into the About dialog.
- "Stop server" became "Stop app" and now closes the tab itself.
- The context indicator and auto-trim switch off when the server reports no context size.
- Copy buttons are now icons.

## [0.1.0] - 2026-09-24

### Added

- Initial release: local GPT-like web chat for local LLM servers (llama.cpp, Ninfer, or any OpenAI-compatible endpoint).
- Onboarding flow, model picker, web tools toggle, reasoning levels.
- Light/dark themes with selectable accent colors.
- Conversation sidebar with auto-titled chats and delete.
- Markdown and syntax-highlighted code rendering.
