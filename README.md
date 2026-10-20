# Frame Studio

A local video editor for downloading, editing, and exporting videos in your browser.

## Features

- Import local files, direct video links, Instagram, YouTube, and X videos.
- Trim, split, reorder, and crop clips. Add text and voice recordings.
- Export as MP4 or MOV with adjustable quality and resolution.
- English and Turkish interface, with JSON-based language settings.

## Getting started

Requires **Node.js 22.13+**.

```sh
git clone https://github.com/aercandev/frame-studio.git
cd frame-studio
npm ci
npm run setup:downloader
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

Built with Node.js, Vite, Express, FFmpeg, and yt-dlp.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.
