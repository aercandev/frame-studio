# Frame Studio

A local video editor for importing videos, editing a timeline, and exporting finished files. Import a video from your computer, a direct video link, or a public Instagram, YouTube, or X post, then edit it in the browser while the Node.js backend handles media processing.

Built as an npm workspaces monorepo with **Vite + JavaScript**, **Express**, **FFmpeg/FFprobe**, and **yt-dlp**.

## Features

- **Multiple import sources:** local files, direct HTTP/HTTPS video URLs, Instagram Reels and video posts, YouTube videos and Shorts, and X/Twitter video posts.
- **Timeline editing:** split, trim, delete, duplicate, reorder, undo/redo, markers, snapping, zoom, frame stepping, and playhead following.
- **Clip controls:** playback speed, reverse playback, freeze frames, volume, and mute.
- **Crop and text:** original, 9:16, 16:9, 1:1, and 4:5 aspect ratios, adjustable crop position, and a timed text overlay with color, size, and position controls.
- **Voice recording:** record from your microphone, trim and position recordings, adjust their volume, and link them to video clips.
- **Export controls:** MP4 or MOV, H.264 or H.265, source/720p/1080p/4K resolution, frame rate and quality settings, progress reporting, and cancellation.
- **JSON localization:** English by default, Turkish included, and additional languages configurable through JSON files.
- **No application-imposed size or duration cap:** imports and exports are limited by available resources and source-platform access. Concurrency is managed separately.

## Quick start

Use **Node.js 22.13 or later**. Node.js 24 is recommended and specified in [`.nvmrc`](.nvmrc).

```sh
git clone https://github.com/aercandev/frame-studio.git
cd frame-studio
npm ci
npm run setup:downloader
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The API runs at [http://127.0.0.1:3001](http://127.0.0.1:3001).

`npm ci` installs the bundled FFmpeg and FFprobe packages. `setup:downloader` downloads an official yt-dlp executable into `.tools/` and verifies its SHA-256 checksum against the release. The supplied executable includes the YouTube EJS component; the application supplies Node.js as its JavaScript runtime. A separate Python installation is not required. Initial setup needs internet access.

The downloader is only needed for social-platform imports. Local files and direct video URLs work without it. Automatic downloader setup supports Windows x64/ARM64/ia32, macOS x64/ARM64, and Linux x64/ARM64; otherwise, provide your own executable through `YT_DLP_PATH`.

### Run the built application

```sh
npm run build
npm start
```

The API serves the built frontend at [http://127.0.0.1:3001](http://127.0.0.1:3001).

## Editing workflow

1. Select a local video or paste a supported URL in the import panel.
2. Play the preview and split, trim, duplicate, or reorder clips on the timeline.
3. Adjust the crop in the video panel. Choose **9:16** for a portrait phone output.
4. Add a timed caption in the text panel or record a voiceover using the microphone tool.
5. Open **Export**, choose the filename and output settings, and start encoding.
6. Follow the progress and download the completed file, or cancel the job.

Edits do not modify the original file on your computer. The editor currently works with **one source video**, multiple clips derived from it, one text overlay, and voice recordings. Export renders the full timeline, including gaps and audio, rather than only the selected clip.

Portrait video thumbnails show the full frame. Choosing a different export aspect ratio applies a crop; for example, converting a landscape video to 9:16 can remove content from its sides. Adjust the crop before exporting.

### Timeline tools

| Tool | Behavior |
| --- | --- |
| Select / blade | Select a clip or split it at the clicked position |
| Split / trim left / trim right | Edit at the playhead; drag clip edges for trimming |
| Delete / duplicate / move | Remove, copy, or reorder clips |
| Undo / redo | Restore clip, crop, text, and voiceover edits |
| Main track magnet | Close deleted-clip gaps when enabled; preserve black, silent gaps when disabled |
| Snapping / markers | Snap to clip boundaries and add or remove time markers |
| Zoom / fit / follow | Change the timeline scale and keep the playhead visible |
| Frame stepping | Move to the previous or next frame |
| Speed / reverse | Apply 0.25–4× speed or reverse the selected clip |
| Freeze frame | Insert a three-second freeze with an adjustable duration |
| Clip audio | Set volume from 0–200% or mute the clip |
| Microphone / audio link | Record audio and attach a recording to a clip so it follows reordering |

Voice recordings have editable timeline start, source offset, duration, volume, and mute settings. Deleting a linked video clip excludes its recording from the output; undo restores it. Microphone access is requested only after choosing to record.

Reverse playback in the browser uses silent frame stepping. The exported video reverses both the picture and source audio.

**Keyboard shortcuts:** Space to play/pause, Left/Right to step frames, Ctrl+B to split, Q/W to trim left/right, Delete to remove, Ctrl+D to duplicate, Ctrl+Z to undo, Ctrl+Shift+Z to redo, Alt+Left/Right to reorder, M for markers, V/B for select/blade, and N for snapping.

## Import sources

| Source | Supported input |
| --- | --- |
| Local files | Video files such as MP4, MOV, WebM, MKV, and AVI; contents are validated |
| Direct links | Public HTTP/HTTPS URLs that return a video file; signed query parameters are preserved |
| Instagram | Public Reel and video-post URLs |
| YouTube | `youtube.com/watch?v=...`, `youtube.com/shorts/...`, and `youtu.be/...` |
| X / Twitter | `x.com/user/status/...` and `twitter.com/user/status/...`; the first video is used when a post contains several |

Imports can be cancelled. A failed or cancelled replacement preserves the currently loaded video and edits.

Live streams, channel/profile pages, playlist imports, arbitrary webpages, and standalone HLS/DASH playlists are not supported. Public posts can still be unavailable because a platform requires sign-in, rate-limits requests, or restricts access. The app does not use account login or browser cookies. Update the downloader with `npm run setup:downloader` when platform changes require a newer extractor.

## How media processing works

The API validates each source. For social links, yt-dlp resolves the media and downloads the selected video. YouTube imports select the best available video and audio streams without a fixed resolution ceiling; FFmpeg merges separate streams when needed.

Local uploads and direct downloads stream to disk. FFprobe checks the video and extracts duration, dimensions, frame rate, and audio metadata. Local, direct-link, YouTube, and X imports are prepared as browser-compatible H.264/AAC MP4 files. The frontend previews media through HTTP range requests.

During export, FFmpeg trims source ranges, applies speed, reverse, freezes, and clip audio settings, and assembles the ordered timeline with its gaps. It then applies the crop and timed text, mixes voice recordings, and encodes the chosen output. Progress comes from FFmpeg's processing output. Filter graphs are written to a file to avoid long command-line limits on Windows.

### Export options

| Setting | Options |
| --- | --- |
| Container | MP4, MOV |
| Video codec | H.264, H.265 / HEVC |
| Resolution | Source, 720p, 1080p, 4K |
| Frame rate | Source, 24, 25, 29.97, 30, 50, 59.94, 60 fps |
| Quality | Encoding quality presets |

Resolution presets preserve the crop's aspect ratio. Landscape bounds are 1280×720, 1920×1080, and 3840×2160; portrait bounds are swapped. Square output is 720×720, 1080×1080, or 2160×2160. Upscaling does not restore detail absent from the source. MP4 with H.264 is the default; HEVC playback depends on the player.

## Language configuration

English is the default. Users can select English or Turkish from the header or export dialog. The preference is saved in browser storage under `frame-language`, and switching languages preserves media, edits, user text, and active exports.

Edit [`apps/web/src/locales/config.json`](apps/web/src/locales/config.json) to configure languages:

```json
{
  "defaultLanguage": "en",
  "languages": [
    { "code": "en", "label": "English" },
    { "code": "tr", "label": "Türkçe" }
  ]
}
```

Each language has four JSON files:

```text
apps/web/src/locales/
  config.json
  en/
    ui.json          Interface text, tooltips, and accessible labels
    editor.json      Import, timeline, playback, and export messages
    voiceover.json   Recording controls and status messages
    errors.json      User-facing API error messages
  tr/                Matching Turkish catalogs
```

To add a language, copy `en` to a new language directory, translate its values, and add its code and label to `config.json`. No JavaScript changes are required. Keep placeholders such as `{count}` and `{time}` intact. Missing keys fall back to English, and translations are rendered as text. A saved user preference takes precedence over `defaultLanguage`.

Vite discovers the JSON catalogs automatically. Rebuild the frontend after changing catalogs in a deployed application.

## Development

```text
apps/
  web/       Vite frontend, preview, timeline, inspector, and export dialog
  api/       Express API, media sessions, imports, and FFmpeg export jobs
scripts/     Development startup, downloader setup, and media verification
docs/        Technical notes and research
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the API and frontend with frontend hot reload |
| `npm run dev:api` | Run the API with automatic restart on changes |
| `npm run dev:web` | Run only the frontend |
| `npm test` | Run the workspace test suites |
| `npm run build` | Build the frontend into `apps/web/dist` |
| `npm start` | Serve the API and built frontend |
| `npm run setup:downloader` | Install or update yt-dlp |

Restart `npm run dev` after API changes, or run `dev:api` and `dev:web` in separate terminals for API watch mode. Tests include editor model and DOM workflows, API validation and lifecycle checks, and real FFmpeg media-processing checks.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines, localization rules, validation, and English Git/issue/pull-request conventions.

## Configuration

Set environment variables in your shell before starting the app; `.env` files are not loaded automatically.

| Variable | Default |
| --- | --- |
| `HOST` | `127.0.0.1` |
| `PORT` | `3001` |
| `YT_DLP_PATH` | `.tools/yt-dlp` or `.tools/yt-dlp.exe` |
| `FFMPEG_PATH` | Executable from `ffmpeg-static` |
| `FFPROBE_PATH` | Executable from `ffprobe-static` |

The development frontend proxy expects the API at `127.0.0.1:3001`. A different `PORT` can be used when serving the built application. A custom yt-dlp distribution should include the EJS component required for YouTube.

## API overview

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Service and tool status |
| `POST /api/media` | Import a social or direct video URL using `{ "url": "..." }` |
| `POST /api/media/upload` | Upload a raw file with `Content-Type: application/octet-stream` and a URL-encoded `X-File-Name` header |
| `GET /api/media/:id/file` | Preview video with HTTP range support |
| `DELETE /api/media/:id` | Release a media session |
| `POST /api/media/:id/voiceovers` | Import a raw WebM or MP4 audio recording |
| `GET /api/media/:id/voiceovers/:voiceId/file` | Stream the prepared recording |
| `DELETE /api/media/:id/voiceovers/:voiceId` | Release a recording |
| `POST /api/exports` | Start an export job |
| `GET /api/exports/:id` | Read job status and progress |
| `GET /api/exports/:id/file` | Download completed output |
| `DELETE /api/exports/:id` | Cancel an export or release its result |
| `POST /api/download` | Download a supported social-platform video directly as MP4 |

Errors use `{ "error": { "code": "...", "message": "..." } }`.

Export requests include `mediaId`, `crop`, `text`, `output`, and a `clips` array. A clip contains `{id, start, end, speed, reverse, volume, muted}`; freezes add `freezeDuration`, and gaps use `{id, gapDuration}`. Times are in seconds and API volume is a multiplier from 0 to 2. Optional `voiceovers` use `{id, start, offset, duration, volume, muted}` and must belong to the same media session. Text timing is relative to the assembled timeline. The earlier single-clip `trim` format is also supported.

## Runtime behavior and scope

- There are no default caps on download/upload size, source duration or resolution, preparation/export time, or output size. Available disk space, memory, CPU, and platform access still determine what can complete.
- The source, prepared preview, and exported output may coexist on disk. Up to two imports can run concurrently; one export runs at a time with up to two queued jobs.
- Direct URLs must resolve to public internet addresses. Private, loopback, and local-network destinations are rejected, including redirects.
- Unused media and export sessions are cleaned up after roughly one hour. Files and session state are temporary; there is no saved-project database. Restarting the API loses sessions, and reloading the page loses the editing project.
- The server binds to the local machine by default. Processing runs in the Node.js backend on the machine hosting the app. Child processes and temporary resources are cleaned up on cancellation and shutdown.
- Multiple source videos in one project, multiple visual tracks, an effects library, automatic captions, cloud synchronization, and hardware encoder selection are outside the current scope.

## References and notices

Frame Studio's editor and export pipeline are independently implemented. Some interaction research used limited static observations of an installed CapCut package; see the [research notes](docs/capcut-analysis.md) for evidence and limitations. This project does not use CapCut's code, assets, or export engine and does not claim full feature parity.

Preview and export text use the bundled Noto Sans font. Its license is included in [`apps/web/public/fonts/OFL.txt`](apps/web/public/fonts/OFL.txt).

Upstream references: [yt-dlp](https://github.com/yt-dlp/yt-dlp), [YouTube EJS requirements](https://github.com/yt-dlp/yt-dlp/wiki/EJS), [FFmpeg](https://ffmpeg.org/ffmpeg-all.html), [Vite](https://vite.dev/guide/), and [Express](https://expressjs.com/).
