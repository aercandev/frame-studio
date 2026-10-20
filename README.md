# Frame Studio

Frame Studio is a browser-based video editing web application. Import a video, arrange clips on a timeline, adjust the frame, add text or voice, and export the result from one workspace.

The frontend provides the editing interface, while a self-hosted Node.js backend handles downloads and video rendering.

## What you can do

| Area | Features |
| --- | --- |
| Import | Local video files, direct video URLs, public Instagram posts and Reels, YouTube videos and Shorts, and X/Twitter videos |
| Timeline | Split, trim, duplicate, reorder, delete, undo/redo, snapping, markers, and zoom |
| Video and audio | Crop, portrait aspect ratios, playback speed, reverse, freeze frames, clip volume, and microphone recordings |
| Text | Timed text overlay with position, size, and color controls |
| Export | MP4 or MOV, H.264 or H.265, source/720p/1080p/4K resolution, frame rate, quality, progress, and cancellation |
| Languages | English by default, Turkish included, and JSON-based translation catalogs |

## Using the website

1. **Import a video.** Paste a supported URL and select **Import video**, or choose a file from your computer.
2. **Edit the timeline.** Move the playhead, split the video into clips, trim their edges, and arrange them in the desired order.
3. **Adjust the picture.** Choose an aspect ratio in the video panel and position the crop. Use **9:16** for portrait phone videos.
4. **Add text or voice.** Set caption timing and appearance, or record a voiceover with the microphone tool.
5. **Export and download.** Open **Export**, choose the output settings, start rendering, and download the completed file.

A project currently uses one source video with multiple clips. Export renders the entire edited timeline. See the [usage and configuration guide](docs/GUIDE.md) for practical examples and current limitations.

## Technical overview

| Component | Technology and responsibility |
| --- | --- |
| Frontend — `apps/web` | Vite and plain JavaScript; media preview, timeline, editing controls, and localization |
| Backend — `apps/api` | Node.js and Express; imports, media sessions, preview streaming, and export jobs |
| Media processing | yt-dlp resolves social-platform videos; FFprobe reads media metadata; FFmpeg prepares and renders video |
| Repository | npm workspaces monorepo with shared root scripts and a single lockfile |

The browser sends editing settings to the API. The backend processes media on its host machine and returns preview and download URLs. Media and project sessions are temporary; there is no saved-project database.

## Local setup

Requires **Node.js 22.13+**; Node.js 24 is recommended.

```sh
git clone https://github.com/aercandev/frame-studio.git
cd frame-studio
npm ci
npm run setup:downloader
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The API runs at `http://127.0.0.1:3001`.

The downloader setup installs yt-dlp for social-platform imports. FFmpeg and FFprobe are provided by the project dependencies. Initial setup requires internet access.

## Build and run

```sh
npm run build
npm start
```

The backend serves both the built website and API at [http://127.0.0.1:3001](http://127.0.0.1:3001). Running the complete application requires a Node.js backend with media-processing tools and writable temporary storage; the frontend build alone cannot import or render videos.

## Documentation

- [Usage and configuration guide](docs/GUIDE.md): editing workflow, portrait exports, languages, runtime settings, and troubleshooting.
- [Development guidelines](CONTRIBUTING.md): repository structure, testing, contribution practices, and English Git conventions.
