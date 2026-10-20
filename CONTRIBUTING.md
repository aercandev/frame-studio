# Contributing to Frame Studio

Keep contributions focused, reproducible, and easy to review. Use English for issues, branch names, commit messages, pull requests, code comments, and documentation. Translation values should use the language of their locale.

## Development setup

Use Node.js 22.13 or later; Node.js 24 is recommended and recorded in `.nvmrc`. Run commands from the repository root.

```sh
npm ci
npm run setup:downloader
npm run dev
```

The frontend runs at `http://127.0.0.1:5173` and the API at `http://127.0.0.1:3001`. The downloader setup is needed for Instagram, YouTube, and X imports; local file and direct video URL imports do not require yt-dlp.

`npm run dev` reloads frontend changes. Restart it after API changes, or run `npm run dev:api` and `npm run dev:web` in separate terminals for API watch mode.

## Repository layout

| Location | Responsibility |
| --- | --- |
| `apps/web/src` | Vite and plain JavaScript UI, preview, timeline, localization, and voice recording |
| `apps/web/test` | Editor DOM and workflow integration tests |
| `apps/api/src` | Express API, media ownership, import validation, and FFmpeg jobs |
| `apps/api/test` | API, process lifecycle, and real media-processing tests |
| `scripts` | Development startup, downloader setup, and manual media verification |
| `docs` | Supporting technical documentation |

The project uses npm workspaces and ES modules. Install dependencies from the root and include `package-lock.json` changes when dependencies change.

## Making changes

1. Describe the problem or intended behavior before implementing a larger change.
2. Use a descriptive branch name. Agent-created branches use `codex/<short-description>`, for example `codex/improve-export-errors`.
3. Reuse the existing editor models, API error codes, and media lifecycle helpers. Keep unrelated cleanup separate.
4. Add a regression test for a fixed bug or a meaningful behavior test for a new feature.
5. Update the README or relevant documentation when setup, configuration, or user-visible behavior changes.

Prefer readable JavaScript and small functions with clear ownership. Avoid dependencies when existing modules can handle the task. Keep user-entered captions and filenames separate from translated interface text.

## Editor and media guidelines

- Preserve the loaded media, edits, undo history, and user text when changing interface settings such as language.
- Keep preview and export behavior aligned for crop, clip order, timing, speed, reverse playback, freezes, gaps, and audio.
- Test failed and cancelled imports as well as successful imports. Replacing a video must preserve the current project until the replacement is ready.
- Ensure cancellation terminates owned processing work and releases temporary resources. Do not delete media while an active reader or export still owns it.
- Keep public URL validation and redirect checks at the import boundary. Do not expose raw subprocess output in user-facing errors.
- Give icon buttons accessible names, preserve keyboard interactions, and check both desktop and narrow layouts after UI changes.
- Request microphone access only after the user chooses to record. Stop microphone tracks when recording is cancelled or disposed.

## Localization

English is the default language; Turkish is included. Supported languages and the default are configured in `apps/web/src/locales/config.json`.

Each language directory contains these JSON namespaces:

- `ui.json`: static interface text, accessible labels, and tooltips.
- `editor.json`: import, timeline, playback, and export messages.
- `voiceover.json`: microphone and recorded-audio controls.
- `errors.json`: user-facing messages keyed by API error code.

Add matching keys to the English and Turkish catalogs when introducing interface text. Preserve interpolation tokens such as `{count}` and `{time}`. Render translations as text, and retain error codes or message keys so an existing status can be translated when the language changes.

To add a language, copy the `en` directory, translate its JSON values, and register its code and display label in `config.json`. No JavaScript changes are required. Missing translations fall back to English. Production deployments require a new build after catalog changes.

## Validation

For code changes, run the relevant tests while developing, then run the repository checks before opening a pull request:

```sh
npm test
npm run build
```

Examples of focused checks:

```sh
npm test --workspace apps/web
npm test --workspace apps/api
node --test apps/web/test/i18n-dom.test.js
node --test apps/api/test/timeline-export.test.js
```

Use synthetic or shareable media fixtures for repeatable tests. Network-dependent social-platform checks are supplemental; record the tested URL, result, and any external access restriction without treating a platform failure as a passing test.

For video-processing changes, inspect the resulting file as well as its metadata. For UI changes, exercise the affected flow in a browser. State whether a check used mocked DOM behavior or actual browser/media processing.

For documentation-only changes, verify referenced paths, commands, and links. Do not claim checks that were not run.

## Commits and pull requests

Use a concise English commit subject that describes the change, such as `feat: add JSON-based language configuration` or `fix: preserve clips when cancelling an import`.

A pull request should explain the concrete problem, resulting behavior, and relevant validation. Include screenshots for meaningful UI changes and mention any remaining limitation. Keep the description current with the final implementation.

Before submitting, review the staged files. Keep downloaded media, local test exports, credentials, `.env` files, `node_modules`, generated builds, and `.tools` artifacts out of version control. Preserve existing third-party notices, including `apps/web/public/fonts/OFL.txt`.

When reporting a bug, include reproduction steps, expected and actual behavior, operating system, Node.js version, and relevant sanitized error codes. For media issues, include a small reproducible fixture or a shareable source URL when possible.
