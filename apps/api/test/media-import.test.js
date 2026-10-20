import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { createEditor } from '../src/editor.js';
import { DownloadError } from '../src/errors.js';
import { createSourceImporter } from '../src/source-importer.js';
import { defaultFfmpeg, defaultFfprobe, probeVideo, runVideoProcess } from '../src/video-tools.js';

const fakeMetadata = { duration: 1, width: 160, height: 120, fps: 24, hasAudio: true };
const edit = (mediaId) => ({
  mediaId, trim: { start: 0.1, end: 0.8 },
  crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, text: null,
  output: { name: 'local-edit', format: 'mp4', codec: 'h264', resolution: 'source', fps: 24, quality: 'recommended' },
});

async function until(callback) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const result = await callback();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Condition timed out');
}

async function harness(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'video-import-test-'));
  const work = join(root, 'work');
  await mkdir(work);
  const downloader = {
    health: async () => ({ available: true }),
    download: async () => { throw new Error('Instagram downloader must not handle this source'); },
  };
  const sourceImporter = createSourceImporter({ tempRoot: work, ...options.importerOptions });
  const editor = createEditor({ downloader, sourceImporter, tempRoot: work, logger: { error() {} }, ...options });
  const app = createApp({ downloader, editor, webDist: false, logger: { error() {} } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await editor.shutdown();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const upload = (body, filename = 'video.mp4', contentType = 'application/octet-stream') => fetch(`${base}/api/media/upload`, {
    method: 'POST', headers: { 'Content-Type': contentType, 'X-File-Name': encodeURIComponent(filename) }, body,
  });
  return { root, work, editor, base, upload };
}

async function makeVideo(filePath, format) {
  const codecs = {
    mp4: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'],
    mov: ['-c:v', 'mpeg4', '-c:a', 'pcm_s16le'],
    webm: ['-c:v', 'libvpx', '-b:v', '100k', '-c:a', 'libvorbis'],
    mkv: ['-c:v', 'ffv1', '-c:a', 'flac'],
    avi: ['-c:v', 'mpeg4', '-c:a', 'pcm_s16le'],
  };
  await runVideoProcess(defaultFfmpeg(), [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'color=c=red:s=160x120:r=24:d=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=1',
    ...codecs[format], '-threads', '2', '-shortest', filePath,
  ]);
}

test('HTTP local MP4/MOV/WebM/MKV/AVI uploads become playable H264/AAC MP4 with preview and export', async (t) => {
  const { root, editor, base, upload, work } = await harness(t);
  for (const format of ['mp4', 'mov', 'webm', 'mkv', 'avi']) {
    const source = join(root, `fixture.${format}`);
    await makeVideo(source, format);
    const imported = await upload(await readFile(source), `İstanbul.${format}`, `video/${format}`);
    const media = await imported.json();
    assert.equal(imported.status, 201, JSON.stringify(media));
    assert.equal(media.filename, 'İstanbul.mp4');
    assert.equal(media.width, 160);
    assert.equal(media.height, 120);
    assert.equal(media.hasAudio, true);
    assert.ok(Math.abs(media.duration - 1) < 0.1);
    const reader = editor.mediaFile(media.id);
    const { stdout } = await runVideoProcess(defaultFfprobe(), [
      '-v', 'error', '-show_entries', 'stream=codec_name,codec_type', '-of', 'json', reader.filePath,
    ]);
    const streams = JSON.parse(stdout).streams;
    assert.equal(streams.find((stream) => stream.codec_type === 'video').codec_name, 'h264');
    assert.equal(streams.find((stream) => stream.codec_type === 'audio').codec_name, 'aac');
    await reader.release();
    const preview = await fetch(`${base}${media.url}`, { headers: { Range: 'bytes=0-31' } });
    assert.equal(preview.status, 206);
    assert.equal((await preview.arrayBuffer()).byteLength, 32);
    const job = editor.createExport(edit(media.id));
    const result = await until(() => {
      const current = editor.exportStatus(job.id);
      return ['completed', 'failed'].includes(current.status) && current;
    });
    assert.equal(result.status, 'completed', JSON.stringify(result.error));
    const exported = editor.exportFile(job.id);
    const metadata = await probeVideo(exported.filePath);
    assert.equal(metadata.width, 128);
    assert.equal(metadata.height, 96);
    assert.equal(metadata.hasAudio, true);
    assert.ok(Math.abs(metadata.duration - 0.7) < 0.1);
    await exported.release();
    await editor.deleteExport(job.id);
    await editor.deleteMedia(media.id);
  }
  assert.deepEqual(await readdir(work), []);
});

test('preparation preserves anamorphic display aspect and bakes rotation into square-pixel dimensions', async (t) => {
  const { root, editor, upload } = await harness(t);
  const source = join(root, 'anamorphic.mov');
  await runVideoProcess(defaultFfmpeg(), [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=s=720x576:r=24:d=1',
    '-vf', 'setsar=16/15', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-threads', '2', source,
  ]);
  const rotated = join(root, 'rotated.mov');
  await runVideoProcess(defaultFfmpeg(), [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-display_rotation:v:0', '90', '-i', source, '-c', 'copy', rotated,
  ]);
  const beforeRotation = await probeVideo(rotated);
  assert.equal(beforeRotation.width, 576);
  assert.equal(beforeRotation.height, 720);
  for (const [filePath, width, height, aspect] of [
    [source, 720, 540, '4:3'], [rotated, 540, 720, '3:4'],
  ]) {
    const response = await upload(await readFile(filePath), 'anamorphic.mov');
    const media = await response.json();
    assert.equal(response.status, 201, JSON.stringify(media));
    assert.equal(media.width, width);
    assert.equal(media.height, height);
    const reader = editor.mediaFile(media.id);
    const { stdout } = await runVideoProcess(defaultFfprobe(), [
      '-v', 'error', '-show_streams', '-of', 'json', reader.filePath,
    ]);
    const video = JSON.parse(stdout).streams.find((stream) => stream.codec_type === 'video');
    assert.equal(video.width, width);
    assert.equal(video.height, height);
    assert.equal(video.sample_aspect_ratio, '1:1');
    assert.equal(video.display_aspect_ratio, aspect);
    assert.ok(!video.side_data_list?.some((item) => item.rotation));
    await reader.release();
    await editor.deleteMedia(media.id);
  }
  const pathological = join(root, 'pathological.mov');
  await runVideoProcess(defaultFfmpeg(), [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'color=s=160x120:r=24:d=1',
    '-vf', 'setsar=100/1', '-c:v', 'libx264', '-threads', '2', pathological,
  ]);
  const invalid = await upload(await readFile(pathological), 'pathological.mov');
  assert.equal(invalid.status, 422);
  assert.equal((await invalid.json()).error.code, 'INVALID_VIDEO');
});

test('upload rejects non-video content and playlists even with a video filename/MIME; leaves no temp files', async (t) => {
  const { root, work, upload } = await harness(t);
  const audio = join(root, 'audio.mp4');
  await runVideoProcess(defaultFfmpeg(), [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'sine=duration=1', '-c:a', 'aac', audio,
  ]);
  const coverAudio = join(root, 'cover-audio.mp4');
  await runVideoProcess(defaultFfmpeg(), [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'color=s=160x120:d=1',
    '-f', 'lavfi', '-i', 'sine=duration=1',
    '-map', '0:v', '-map', '1:a', '-c:v', 'mjpeg', '-frames:v', '1',
    '-disposition:v', 'attached_pic', '-c:a', 'aac', '-threads', '2', coverAudio,
  ]);
  const content = [
    Buffer.from('<html><body>Sign in to watch</body></html>'),
    Buffer.from('#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nfile:///private.mp4\n#EXT-X-ENDLIST\n'),
    Buffer.from('ffconcat version 1.0\nfile file:///private.mp4\n'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC48AAAAASUVORK5CYII=', 'base64'),
    await readFile(audio),
    await readFile(coverAudio),
  ];
  for (const body of content) {
    const response = await upload(body, 'looks-valid.mp4', 'video/mp4');
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'INVALID_VIDEO');
    assert.deepEqual(await readdir(work), []);
  }
});

test('HTTP upload size errors remain JSON for known and chunked lengths; client disconnect removes partial upload', async (t) => {
  const { upload, base, work } = await harness(t, { importerOptions: { maxBytes: 1024 } });
  const knownLength = await upload(Buffer.alloc(1025));
  assert.equal(knownLength.status, 413);
  assert.equal((await knownLength.json()).error.code, 'FILE_TOO_LARGE');
  const chunked = await new Promise((resolve, reject) => {
    const request = http.request(`${base}/api/media/upload`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.write(Buffer.alloc(512));
    request.end(Buffer.alloc(513));
  });
  assert.equal(chunked.status, 413);
  assert.equal(chunked.body.error.code, 'FILE_TOO_LARGE');
  assert.deepEqual(await readdir(work), []);
  const request = http.request(`${base}/api/media/upload`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' },
  });
  request.on('error', () => {});
  request.write(Buffer.alloc(512));
  await until(async () => (await readdir(work)).length > 0);
  request.destroy();
  await until(async () => (await readdir(work)).length === 0);
});

test('raw upload rejects unsupported body encodings and reports malformed filenames as JSON', async (t) => {
  const { upload, base, work } = await harness(t);
  const unsupported = await upload('data', 'video.mp4', 'multipart/form-data; boundary=demo');
  assert.equal(unsupported.status, 415);
  assert.equal((await unsupported.json()).error.code, 'INVALID_UPLOAD_TYPE');
  for (const headers of [
    { 'X-File-Name': '%ZZ' },
    { 'X-File-Name': 'video.mp4', 'Content-Encoding': 'gzip' },
  ]) {
    const response = await fetch(`${base}/api/media/upload`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...headers }, body: 'data',
    });
    assert.equal(response.status, headers['Content-Encoding'] ? 415 : 400);
  }
  assert.deepEqual(await readdir(work), []);
});

test('direct link routes through source importer, retains query, normalizes video and releases source', async (t) => {
  let source;
  let released = 0;
  let received;
  const sourceImporter = {
    async download(url) {
      received = url;
      return { filePath: source, filename: 'remote.webm', cleanup: async () => { released += 1; } };
    },
  };
  const { root, editor, base } = await harness(t, { sourceImporter });
  source = join(root, 'remote.webm');
  await makeVideo(source, 'webm');
  const url = 'https://video.example/remote.webm?signature=keep-this';
  const response = await fetch(`${base}/api/media`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
  });
  const media = await response.json();
  assert.equal(response.status, 201, JSON.stringify(media));
  assert.equal(received, url);
  assert.equal(media.filename, 'remote.mp4');
  assert.equal(media.width, 160);
  assert.equal(released, 1);
  await editor.deleteMedia(media.id);
});

test('YouTube, Shorts and X use platform transport then normalize to playable H264/AAC for editing', async (t) => {
  let source;
  let releases = 0;
  const received = [];
  const downloader = {
    health: async () => ({ available: true }),
    async download(url) {
      received.push(url);
      return {
        filePath: source, filename: url.includes('youtube.com') ? 'youtube-test.mp4' : 'x-test.mp4',
        cleanup: async () => { releases += 1; },
      };
    },
  };
  const sourceImporter = {
    download: async () => { throw new Error('Platform links must never use generic HTTP'); },
  };
  const { root, editor, base, work } = await harness(t, { downloader, sourceImporter });
  source = join(root, 'remote.webm');
  await makeVideo(source, 'webm');
  for (const [url, canonical] of [
    ['https://www.youtube.com/watch?v=0rW7Fbm4S7g&list=tracking', 'https://www.youtube.com/watch?v=0rW7Fbm4S7g'],
    ['https://youtube.com/shorts/q_WdpYiXXaQ?si=Iqc0wdj2_prU_e6F', 'https://www.youtube.com/watch?v=q_WdpYiXXaQ'],
    ['https://x.com/RealFedeURU/status/2112511582714347954?s=20', 'https://x.com/RealFedeURU/status/2112511582714347954'],
  ]) {
    const response = await fetch(`${base}/api/media`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
    });
    const media = await response.json();
    assert.equal(response.status, 201, JSON.stringify(media));
    assert.equal(received.at(-1), canonical);
    assert.equal(media.hasAudio, true);
    assert.equal(media.width, 160);
    const reader = editor.mediaFile(media.id);
    const { stdout } = await runVideoProcess(defaultFfprobe(), [
      '-v', 'error', '-show_entries', 'stream=codec_name,codec_type', '-of', 'json', reader.filePath,
    ]);
    const streams = JSON.parse(stdout).streams;
    assert.equal(streams.find((stream) => stream.codec_type === 'video').codec_name, 'h264');
    assert.equal(streams.find((stream) => stream.codec_type === 'audio').codec_name, 'aac');
    await reader.release();
    const job = editor.createExport(edit(media.id));
    const result = await until(() => {
      const current = editor.exportStatus(job.id);
      return ['completed', 'failed'].includes(current.status) && current;
    });
    assert.equal(result.status, 'completed', JSON.stringify(result.error));
    const exported = editor.exportFile(job.id);
    const metadata = await probeVideo(exported.filePath);
    assert.equal(metadata.width, 128);
    assert.equal(metadata.hasAudio, true);
    assert.ok(Math.abs(metadata.duration - 0.7) < 0.1);
    await exported.release();
    await editor.deleteExport(job.id);
    await editor.deleteMedia(media.id);
  }
  assert.equal(releases, 3);
  assert.deepEqual(await readdir(work), []);
});

test('malformed recognized platform pages reject before either downloader or direct transport', async (t) => {
  let calls = 0;
  const download = async () => { calls += 1; throw new Error('Must not fetch'); };
  const { editor, work } = await harness(t, { downloader: { download }, sourceImporter: { download } });
  for (const url of [
    'https://youtube.com/playlist?list=PLabc',
    'https://youtube.com/watch?v=bad',
    'http://youtu.be/0rW7Fbm4S7g',
    'https://studio.youtube.com/watch?v=0rW7Fbm4S7g',
    'https://youtube.com:443/watch?v=0rW7Fbm4S7g',
    'https://x.com/RealFedeURU',
    'https://twitter.com/person/status/not-digits',
    'https://api.twitter.com/person/status/123',
    'https://instagram.com/person',
    'https://help.instagram.com/reel/ABC',
  ]) await assert.rejects(editor.importMedia(url), { code: 'INVALID_URL', status: 400 }, url);
  assert.equal(calls, 0);
  assert.deepEqual(await readdir(work), []);
});

test('concurrent import limit spans source acquisition and preparation; shutdown cancels and cleans both', async (t) => {
  let source;
  let releases = 0;
  const invocations = [];
  const sourceImporter = {
    async upload() {
      return { filePath: source, filename: 'video.mkv', cleanup: async () => { releases += 1; } };
    },
  };
  const runProcess = async (_executable, _args, options) => new Promise((resolve, reject) => {
    invocations.push(options);
    options.signal.addEventListener('abort', () => reject(new DownloadError('CANCELLED', 'İptal.', 499)), { once: true });
  });
  const { root, work, editor } = await harness(t, { sourceImporter, runProcess, probe: async () => fakeMetadata });
  source = join(root, 'source.mkv');
  await writeFile(source, 'fixture');
  const first = editor.uploadMedia(Readable.from('first')).catch((error) => error);
  const second = editor.uploadMedia(Readable.from('second')).catch((error) => error);
  await until(() => invocations.length === 2);
  await assert.rejects(editor.uploadMedia(Readable.from('third')), { code: 'SERVER_BUSY', status: 429 });
  await editor.shutdown();
  assert.equal((await first).code, 'CANCELLED');
  assert.equal((await second).code, 'CANCELLED');
  assert.equal(releases, 2);
  assert.deepEqual(await readdir(work), []);
  await assert.rejects(editor.uploadMedia(Readable.from('late')), { code: 'SERVER_SHUTTING_DOWN' });
});

test('failed or oversized preparation releases artifacts and exposes import-specific errors', async (t) => {
  for (const failure of ['EXPORT_TIMEOUT', 'EXPORT_TOO_LARGE', 'VIDEO_PROCESS_FAILED']) {
    await t.test(failure, async (t) => {
      let source;
      let released = 0;
      const sourceImporter = {
        async upload() {
          return { filePath: source, filename: 'video.mov', cleanup: async () => { released += 1; } };
        },
      };
      const { root, work, editor } = await harness(t, {
        sourceImporter, probe: async () => fakeMetadata,
        runProcess: async (_executable, _args, { outputPath }) => {
          await writeFile(outputPath, 'partial');
          throw new DownloadError(failure, 'Failure');
        },
      });
      source = join(root, 'source.mov');
      await writeFile(source, 'fixture');
      const expected = {
        EXPORT_TIMEOUT: 'IMPORT_TIMEOUT',
        EXPORT_TOO_LARGE: 'PREPARED_VIDEO_TOO_LARGE',
        VIDEO_PROCESS_FAILED: 'INVALID_VIDEO',
      }[failure];
      await assert.rejects(editor.uploadMedia(Readable.from('data')), { code: expected });
      assert.equal(released, 1);
      assert.deepEqual(await readdir(work), []);
    });
  }
});
