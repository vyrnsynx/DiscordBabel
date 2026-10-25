# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.2] - 2026-10-25

### Added

- Optional translation for the server channel list (categories and channel names)
- Announcement and forum coverage: post cards, thread titles, forum tags, channel topics, embed titles/descriptions, and Components V2 text displays
- Server event names (live sidebar card and event details)
- Popup toggles for channel list, announcements/forums, and server events
- In-place replacement for compact labels (hover to show the original)

### Fixed

- Forum/announcement posts that do not use `message-content` nodes now translate
- Channel topics that are `role="button"` are no longer skipped
- Duplicate forum tags (list vs. open thread) share one translation
- Thread preview cards no longer smash custom emoji into `:shortcode:` text

## [0.0.1] - 2026-10-25

### Added

- Manifest V3 Chrome / Edge extension for real-time Discord translation
- Inbound auto-translation for messages in view, with manual translate and original toggle
- Outbound translation preview (send translation / keep original), theme-aware UI
- Understood-language whitelist so selected languages stay untranslated
- Free engines: Google + MyMemory, Edge + Volcengine
- DeepL support with user-supplied API keys
- OpenAI-compatible AI providers:
  - TokenDance (PKCE OAuth-style API key grant, live model refresh, `X-App-URL` attribution)
  - Kimi / Kimi International
  - Zhipu GLM / Zhipu GLM International
  - MiniMax / MiniMax International
  - StepFun, DeepSeek, Qwen / Qwen International
  - OpenAI, Anthropic, Gemini, OpenRouter, Ollama
- Custom OpenAI-compatible base URL and model ID
- 45+ UI locales with searchable language and interface-language pickers
- Translation styles, text colors, and sans/serif fonts
- Hotkeys: `Alt+T` (toggle), `Alt+O` (outbound); `⌃⌥` on macOS
- Privacy model: keys in `chrome.storage.local`, no first-party telemetry backend
- Project documentation: README, MIT LICENSE, DISCLAIMER (unofficial / trademark notice)

### Security

- Optional host permissions requested per provider origin
- TokenDance recovery actions surfaced for balance / reauth / quota errors

[0.0.2]: https://github.com/vyrnsynx/DiscordBabel/releases/tag/v0.0.2
[0.0.1]: https://github.com/vyrnsynx/DiscordBabel/releases/tag/v0.0.1
