# Changelog

All notable changes to LiteChat are documented here.

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
