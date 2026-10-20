# Frame Studio guide

Use the [README](../README.md#local-setup) for installation. This guide covers editing a video, choosing export settings, and configuring the web application.

## Import a video

1. Paste an Instagram, YouTube, YouTube Shorts, or X video URL and select **Import video**. Alternatively, select **Choose a local video**.
2. For other websites, provide a public HTTP(S) URL that returns a video file directly. Ordinary web pages, streaming playlists, and private network URLs are not supported by the direct-file importer.
3. Wait for the preview and timeline to appear. Local files and direct links are prepared for browser playback. **Cancel import** stops an unfinished import; an existing project stays available if its replacement fails or is cancelled.

Social imports use public access without browser cookies or account sign-in. A publicly visible post may still be unavailable to the downloader because of platform restrictions. There is no default application-level video size or duration limit; processing still depends on available disk space, memory, and CPU.

## Edit the timeline

1. Select a clip and move the playhead to the desired frame. Use **Split at playhead**, or select the **Blade tool** and click a cut point. Three cuts divide a clip into four parts.
2. Trim by dragging a clip's edge handles or editing its **Start** and **End** values. Those values refer to positions in the original source video.
3. Drag clips to reorder them. Use **Duplicate selected clip** to repeat a section, **Delete selected clip** to remove one, and **Undo** / **Redo** to compare changes.
4. Adjust the selected clip's speed, volume, mute, or reverse setting. **Add freeze frame** inserts a still frame whose duration can be changed in the inspector.

Use **Snap to edges and markers** for alignment, **Main track magnet** to close gaps, and **Fit timeline** or the zoom controls to inspect cuts. Markers help identify positions without changing the exported picture. Gaps export as silent black video; freeze frames are also silent. Reverse preview is silent, while export reverses the source audio as well.

## Crop, text, and voice

- **Crop:** choose an aspect ratio in the Video panel. Select **Edit crop**, move or resize the rectangle, then **Apply crop**. Numeric position and size controls are also available. **Reset crop** restores the full source frame.
- **Text:** open the Text panel, enable text, enter its content, and choose size and color. Drag it in the preview to position it. Set visibility start/end times relative to the edited timeline, rather than the source video.
- **Voice:** place the playhead, select **Record from microphone**, grant browser permission, and select it again to stop. The recording appears on the audio track. Select it to change its start time, source offset, duration, volume, or mute setting. Link it to a video clip when it should move with that clip.

The crop applies to the whole output, and the current editor provides one timed text overlay. Use clip mute/volume settings to change exported source audio; the preview player's mute button only affects listening during editing.

## Export, including phone video

1. Play through the edited sequence and check text and recorded audio timing.
2. For a vertical phone video, choose **9:16** under **Aspect ratio** and reposition the crop to keep the subject visible. Cropping can remove content at the edges; it does not add padding to preserve a wider source frame. Choose **Original** when retaining the entire frame matters more than a fixed phone ratio.
3. Select **Export**. Enter a filename, then choose resolution, quality, frame rate, format (**MP4** / **MOV**), and codec (**H.264** / **HEVC**).
4. For a 9:16 output, **1080p** produces **1080 × 1920**; **720p** produces **720 × 1280**. Check the dimensions displayed in the dialog. Resolution preserves the chosen crop ratio, and upscaling does not create source detail.
5. Start the export and wait for completion. Select **Download video** to save the result. Cancelling a render preserves your edits.

Export renders the **entire timeline into one file**, including its clips, gaps, text, and voice recordings. Selecting one of four split clips does not export only that clip. To create separate files, leave the desired section on the timeline, export and download it, then undo the removals before preparing the next section. Download a completed export before opening a new export operation, which releases the previous result.

## Project scope and storage

Each project uses one imported source video; multiple timeline clips are sections or copies of that source. Importing another video replaces the project after the new import succeeds. There is no saved project file, multi-source video composition, or project recovery after a page reload.

Edits live in the browser's current session. Imported media, voice recordings, and renders use temporary server storage, not a permanent media library. Idle media and completed exports normally expire after about one hour; active work is retained while in use. Restarting the API invalidates existing sessions. Save finished exports to your device.

## JSON language settings

English is the default; Turkish is included. The interface language selector remembers your choice in the browser without changing your captions or filenames.

Configure languages in [`apps/web/src/locales/config.json`](../apps/web/src/locales/config.json):

```json
{
  "defaultLanguage": "en",
  "languages": [
    { "code": "en", "label": "English" },
    { "code": "tr", "label": "Türkçe" }
  ]
}
```

To add a language, copy `apps/web/src/locales/en` to a directory named with its language code, translate the values in `ui.json`, `editor.json`, `voiceover.json`, and `errors.json`, then add its code and label to the configuration. Preserve keys and placeholders such as `{count}`. Missing translations fall back to English. No JavaScript changes are required; rebuild the application after changing production catalogs. A saved browser preference takes precedence over `defaultLanguage`.

## Running and configuring the application

Run commands from the repository root with Node.js **22.13+**; Node.js **24** is recommended. The [setup steps](../README.md#local-setup) install dependencies with `npm ci` and the social downloader with `npm run setup:downloader`.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the frontend at `127.0.0.1:5173` and API at `127.0.0.1:3001`. Restart after API changes. |
| `npm run dev:api` / `npm run dev:web` | Run separately in two terminals when API watch mode is useful. |
| `npm run build` then `npm start` | Build the frontend, then serve it and the API together at `127.0.0.1:3001`. |
| `npm test` | Run workspace tests; see [contribution guidelines](../CONTRIBUTING.md#validation) for focused checks. |

Set these variables in the launching shell before starting the API. The application does not automatically load `.env` files.

| Variable | Default / meaning |
| --- | --- |
| `HOST` | `127.0.0.1`; API bind address. |
| `PORT` | `3001`; API port. |
| `YT_DLP_PATH` | Repository `.tools/yt-dlp.exe` on Windows or `.tools/yt-dlp` elsewhere; override with an executable path. |
| `FFMPEG_PATH` | Binary provided by `ffmpeg-static`; override with an executable path. |
| `FFPROBE_PATH` | Binary provided by `ffprobe-static`; override with an executable path. |

The development proxy targets `http://127.0.0.1:3001`. If you change the API address, update [`apps/web/vite.config.js`](../apps/web/vite.config.js) to match. By default, the server listens on localhost and has no user authentication.

## Troubleshooting

- **Social import fails:** verify the URL is a single accessible video. Rerun `npm run setup:downloader` to update yt-dlp. Sign-in requirements, removed content, and platform rate limits can prevent import; inspect the displayed error.
- **Direct URL is rejected:** provide the actual video file URL, or download the file separately and use local import. Check the API is running if requests cannot connect.
- **Preview or export session expired:** import the source again. Refreshing the page does not restore edits.
- **Export fails or takes a long time:** check temporary-disk space and the displayed error, then try a smaller resolution. Long videos and demanding encodes require more processing. Use **Cancel** to stop an unwanted render.
- **Voice recording cannot start:** check browser microphone support and site permission, and confirm an input device is available.
