import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { createEditor } from '../src/editor.js';
import { normalizeEdit } from '../src/edit-spec.js';
import { DownloadError } from '../src/errors.js';
import { defaultFfmpeg, probeVideo, runVideoProcess } from '../src/video-tools.js';

const metadata = { duration: 4, width: 320, height: 240, fps: 30, hasAudio: true };
const validUrl = 'https://www.instagram.com/reel/TEST/';
const edit = (mediaId, overrides = {}) => ({
  mediaId, trim: { start: 0.5, end: 2.5 }, crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
  text: {
    value: "İstanbul %{pts} : 'test'", x: 0.5, y: 0.5, size: 10,
    color: '#ffffff', start: 0, end: 1,
  },
  output: { name: 'Düzenlenmiş video', format: 'mp4', codec: 'h264', fps: 30, resolution: 'source', quality: 'recommended' },
  ...overrides,
});

async function harness(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'insta-editor-test-'));
  const work = join(root, 'work');
  await mkdir(work);
  const source = join(root, 'source.mp4');
  let releases = 0;
  const downloader = {
    health: async () => ({ available: true }),
    download: async () => ({ filePath: source, filename: 'instagram-TEST.mp4', cleanup: async () => { releases += 1; } }),
  };
  const service = createEditor({
    downloader, tempRoot: work, cleanupIntervalMs: 60_000,
    probe: async () => metadata, logger: { error() {} }, ...options,
  });
  t.after(async () => {
    await service.shutdown();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  await writeFile(source, 'source fixture');
  return { service, source, work, root, downloader, releases: () => releases };
}

async function until(callback, message = 'Condition timed out') {
  const start = Date.now();
  while (Date.now() - start < 20_000) {
    const value = await callback();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(message);
}

async function terminal(service, id) {
  return until(() => {
    const job = service.exportStatus(id);
    return ['completed', 'failed', 'cancelled'].includes(job.status) && job;
  }, 'Export never reached terminal state');
}

test('edit validation rejects out-of-frame crops, invalid timing, filter injections and unsupported output', () => {
  for (const patch of [
    { crop: { x: 0.8, y: 0, width: 0.5, height: 0.5 } },
    { crop: { x: 0, y: 0, width: -0.5, height: 0.5 } },
    { crop: { x: 0, y: 0, width: NaN, height: 1 } },
    { trim: { start: 3, end: 2 } },
    { trim: { start: 0, end: 5 } },
    { trim: { start: '0', end: 2 } },
    { text: { ...edit().text, color: "white:fontfile=secret" } },
    { text: { ...edit().text, end: 3 } },
    { text: { ...edit().text, size: 10000 } },
    { text: { ...edit().text, value: 'x'.repeat(501) } },
    { output: { ...edit().output, fps: 2000 } },
    { output: { ...edit().output, format: 'gif' } },
    { output: { ...edit().output, codec: 'unknown' } },
  ]) {
    assert.throws(() => normalizeEdit(edit('id', patch), metadata), { code: 'INVALID_EDIT', status: 400 });
  }
});

test('source dimensions stay native; selected resolution fits orientation box, permits upscale and stays even', () => {
  const small = normalizeEdit(edit('id'), metadata);
  assert.equal(small.width, 160);
  assert.equal(small.height, 120);
  const portrait = normalizeEdit(edit('id', {
    trim: { start: 0, end: 4 }, crop: { x: 0, y: 0, width: 1, height: 1 }, text: null,
    output: { ...edit().output, resolution: '1080' },
  }), { ...metadata, width: 2160, height: 3840 });
  assert.equal(portrait.width, 1080);
  assert.equal(portrait.height, 1920);
  const upscaled = normalizeEdit(edit('id', {
    output: { ...edit().output, resolution: '1080' },
  }), metadata);
  assert.equal(upscaled.width, 1440);
  assert.equal(upscaled.height, 1080);
  const square = normalizeEdit(edit('id', {
    crop: { x: 0, y: 0, width: 0.75, height: 1 },
    output: { ...edit().output, resolution: '2160' },
  }), metadata);
  assert.equal(square.width, 2160);
  assert.equal(square.height, 2160);
  const sanitized = normalizeEdit(edit('id', {
    output: { ...edit().output, name: '../../bad.mp4', format: 'mov' },
  }), metadata);
  assert.equal(sanitized.filename, '-..-bad.mov');
});

test('ratio presets preserve exact phone and landscape dimensions before rounding fractional source crops', () => {
  for (const [resolution, short, long] of [['720', 720, 1280], ['1080', 1080, 1920], ['2160', 2160, 3840]]) {
    for (const dimensions of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }, { width: 639, height: 359 }]) {
      for (const ratio of [9 / 16, 16 / 9]) {
        const width = Math.min(1, ratio / (dimensions.width / dimensions.height));
        const height = Math.min(1, dimensions.width / dimensions.height / ratio);
        const spec = normalizeEdit(edit('id', {
          crop: { x: (1 - width) / 2, y: (1 - height) / 2, width, height },
          output: { ...edit().output, resolution },
        }), { ...metadata, ...dimensions });
        assert.deepEqual({ width: spec.width, height: spec.height }, ratio < 1
          ? { width: short, height: long } : { width: long, height: short });
        assert.equal(spec.crop.width % 2, 0);
        assert.equal(spec.crop.height % 2, 0);
      }
    }
  }
  const spec = normalizeEdit(edit('id', {
    crop: { x: (1 - 81 / 256) / 2, y: 0, width: 81 / 256, height: 1 },
  }), { ...metadata, width: 1920, height: 1080 });
  assert.deepEqual({ width: spec.width, height: spec.height }, { width: 606, height: 1080 });
});

test('media ownership releases downloader immediately and defers deletion while a reader holds the file', async (t) => {
  const { service, work, releases } = await harness(t);
  const media = await service.importMedia(validUrl);
  assert.equal(releases(), 1);
  const reader = service.mediaFile(media.id);
  await service.deleteMedia(media.id);
  assert.throws(() => service.mediaFile(media.id), { code: 'NOT_FOUND' });
  assert.ok((await stat(reader.filePath)).isFile());
  await reader.release();
  await reader.release();
  assert.deepEqual(await readdir(work), []);
});

test('failed media probing releases both source artifact and editor directory', async (t) => {
  const { service, work, releases } = await harness(t, {
    probe: async () => { throw new DownloadError('INVALID_VIDEO', 'Geçersiz video.'); },
  });
  await assert.rejects(service.importMedia(validUrl), { code: 'INVALID_VIDEO' });
  assert.equal(releases(), 1);
  assert.deepEqual(await readdir(work), []);
});

test('queue is bounded, reports progress, supports cancellation, and keeps locked source until export finishes', async (t) => {
  const invocations = [];
  const runProcess = async (_exe, _args, options) => new Promise((resolve, reject) => {
    options.onProgress(37);
    invocations.push({ ...options, resolve, reject });
    options.signal.addEventListener('abort', () => reject(new DownloadError('CANCELLED', 'İptal.')), { once: true });
  });
  const { service, work } = await harness(t, { runProcess });
  const media = await service.importMedia(validUrl);
  const first = service.createExport(edit(media.id, { text: null }));
  const second = service.createExport(edit(media.id, { text: null }));
  const third = service.createExport(edit(media.id, { text: null }));
  assert.throws(() => service.createExport(edit(media.id)), { code: 'SERVER_BUSY' });
  await until(() => invocations.length === 1);
  assert.equal(service.exportStatus(first.id).progress, 37);
  assert.equal(service.exportStatus(second.id).status, 'queued');
  await service.deleteMedia(media.id);
  await service.deleteExport(second.id);
  await service.deleteExport(third.id);
  await service.deleteExport(first.id);
  assert.throws(() => service.exportStatus(first.id), { code: 'NOT_FOUND' });
  assert.deepEqual(await readdir(work), []);
  assert.equal(invocations.length, 1);
});

test('export errors remain readable and clean partial outputs; expiry cleans retained media and job', async (t) => {
  const { service, work } = await harness(t, {
    ttlMs: -1,
    runProcess: async (_exe, _args, { outputPath }) => {
      await writeFile(outputPath, 'partial');
      throw new DownloadError('VIDEO_PROCESS_FAILED', 'Video işlenemedi.');
    },
  });
  const media = await service.importMedia(validUrl);
  const job = service.createExport(edit(media.id, { text: null }));
  const result = await terminal(service, job.id);
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'VIDEO_PROCESS_FAILED');
  assert.deepEqual((await readdir(work)).map((name) => name.startsWith('insta-media-')), [true]);
  await service.expire();
  assert.deepEqual(await readdir(work), []);
  assert.throws(() => service.exportStatus(job.id), { code: 'NOT_FOUND' });
});

test('real FFmpeg crops, trims, burns literal Turkish text, retains audio, and produces browser-ready MP4', async (t) => {
  const { service, source, work } = await harness(t, { probe: probeVideo });
  await runVideoProcess(defaultFfmpeg(), [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:r=30:d=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=4',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-threads', '2', '-shortest', source,
  ]);
  const media = await service.importMedia(validUrl);
  assert.equal(media.width, 320);
  assert.equal(media.hasAudio, true);
  const job = service.createExport(edit(media.id));
  const result = await terminal(service, job.id);
  assert.equal(result.status, 'completed', JSON.stringify(result.error));
  assert.equal(result.progress, 100);
  const output = service.exportFile(job.id);
  const info = await probeVideo(output.filePath);
  assert.equal(info.width, 160);
  assert.equal(info.height, 120);
  assert.equal(info.hasAudio, true);
  assert.ok(Math.abs(info.duration - 2) < 0.1, `duration=${info.duration}`);
  assert.equal(info.fps, 30);
  // Inspect central pixels: the text is bright while enabled; after its range ends
  // the same area returns to the blue background.
  const brightness = async (time) => {
    const { stdout } = await runVideoProcess(defaultFfmpeg(), [
      '-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', output.filePath,
      '-vf', 'crop=120:30:20:45,signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=-',
      '-frames:v', '1', '-an', '-f', 'null', '-',
    ]);
    return Number(stdout.match(/lavfi\.signalstats\.YAVG=([\d.]+)/)?.[1]);
  };
  assert.ok((await brightness(0.4)) > (await brightness(1.5)) + 5);
  await output.release();
  await service.deleteExport(job.id);
  await service.deleteMedia(media.id);
  assert.deepEqual(await readdir(work), []);
});

test('real FFmpeg supports silent sources and MOV/HEVC export', async (t) => {
  const { service, source } = await harness(t, { probe: probeVideo });
  await runVideoProcess(defaultFfmpeg(), [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'color=c=green:s=320x240:r=30:d=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-threads', '2', source,
  ]);
  const media = await service.importMedia(validUrl);
  assert.equal(media.hasAudio, false);
  const job = service.createExport(edit(media.id, {
    text: null, output: { ...edit().output, format: 'mov', codec: 'hevc', fps: 24 },
  }));
  const result = await terminal(service, job.id);
  assert.equal(result.status, 'completed', JSON.stringify(result.error));
  assert.match(result.filename, /\.mov$/);
  const output = service.exportFile(job.id);
  assert.equal(output.contentType, 'video/quicktime');
  const info = await probeVideo(output.filePath);
  assert.equal(info.hasAudio, false);
  assert.equal(info.fps, 24);
  await output.release();
});

test('HTTP media Range playback and export lifecycle preserve stable JSON errors', async (t) => {
  const { service, downloader } = await harness(t, {
    runProcess: async (_exe, _args, { outputPath, onProgress }) => {
      onProgress(50);
      await writeFile(outputPath, 'encoded output');
    },
  });
  const app = createApp({ downloader, editor: service, webDist: false, logger: { error() {} } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const imported = await post('/api/media', { url: validUrl });
  assert.equal(imported.status, 201);
  const media = await imported.json();
  const range = await fetch(`${base}${media.url}`, { headers: { Range: 'bytes=0-5' } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), 'bytes 0-5/14');
  assert.equal(await range.text(), 'source');
  const submitted = await post('/api/exports', edit(media.id, { text: null }));
  assert.equal(submitted.status, 202);
  const queued = await submitted.json();
  const result = await terminal(service, queued.id);
  const download = await fetch(`${base}${result.downloadUrl}`);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), 'encoded output');
  assert.match(download.headers.get('content-disposition'), /attachment/);
  assert.equal((await fetch(`${base}/api/exports/${queued.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await fetch(`${base}/api/media/${media.id}`, { method: 'DELETE' })).status, 204);
  const missing = await post('/api/exports', edit(media.id));
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, 'NOT_FOUND');
});
