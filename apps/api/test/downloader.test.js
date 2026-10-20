import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createDownloader } from '../src/downloader.js';
import { parseInstagramUrl } from '../src/instagram-url.js';

const fixture = fileURLToPath(new URL('./fixtures/fake-downloader.js', import.meta.url));
const validUrl = 'https://www.instagram.com/reel/ABC_123-/';

async function makeDownloader(t, scenario = 'success', overrides = {}) {
  const tempRoot = await mkdtemp(join(tmpdir(), 'insta-test-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true, maxRetries: 3 }));
  const calls = [];
  const service = createDownloader({
    executable: process.execPath,
    tempRoot,
    spawnProcess(executable, args, options) {
      calls.push({ executable, args, options });
      return spawn(process.execPath, [fixture, scenario, ...args], options);
    },
    ...overrides,
  });
  return { service, tempRoot, calls };
}

test('accepts only post/reel/tv URLs and strips tracking data', () => {
  for (const type of ['p', 'reel', 'tv']) {
    assert.deepEqual(
      parseInstagramUrl(` https://m.instagram.com/${type}/ABC_123-?igsh=tracking#part `),
      { url: `https://www.instagram.com/${type}/ABC_123-/`, shortcode: 'ABC_123-' },
    );
  }
});

test('rejects other domains, schemes, paths, credentials and ports', () => {
  const invalid = [
    '', null, 7, {}, 'not a link',
    'http://www.instagram.com/reel/ABC/',
    'https://instagram.com.evil.test/reel/ABC/',
    'https://instagram.com@evil.test/reel/ABC/',
    'https://user:password@instagram.com/reel/ABC/',
    'https://instagram.com:8080/reel/ABC/',
    'https://instagram.com/profile/',
    'https://instagram.com/stories/person/123/',
    'https://instagram.com/reel/ABC/extra',
    'https://instagram.com/reel/a%2fb/',
    'https:\\\\instagram.com\\reel\\ABC',
    'https://127.0.0.1/reel/ABC/',
  ];
  for (const value of invalid) {
    assert.throws(() => parseInstagramUrl(value), { code: 'INVALID_URL' }, String(value));
  }
});

test('invalid URLs fail before creating a process or temporary files', async (t) => {
  const { service, tempRoot, calls } = await makeDownloader(t);
  await assert.rejects(service.download('https://evil.test/video'), { code: 'INVALID_URL' });
  assert.equal(calls.length, 0);
  assert.deepEqual(await readdir(tempRoot), []);
});

test('downloads a single file with safe arguments and releases its directory on cleanup', async (t) => {
  const { service, tempRoot, calls } = await makeDownloader(t);
  const result = await service.download(`${validUrl}?igsh=tracking`);
  assert.equal(await readFile(result.filePath, 'utf8'), 'fake mp4 contents');
  assert.equal(result.filename, 'instagram-ABC_123-.mp4');
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[0].options.detached, process.platform !== 'win32');
  assert.equal(calls[0].args.at(-1), validUrl);
  assert.equal(calls[0].args[calls[0].args.indexOf('--playlist-items') + 1], '1');
  assert.ok(calls[0].args.includes('--ignore-config'));
  assert.ok(calls[0].args.includes('--no-cookies-from-browser'));
  await result.cleanup();
  await result.cleanup();
  assert.deepEqual(await readdir(tempRoot), []);
});

test('maps unavailable and rate-limited videos without leaking subprocess output', async (t) => {
  for (const [scenario, code] of [['private', 'VIDEO_UNAVAILABLE'], ['rate-limit', 'INSTAGRAM_RATE_LIMIT']]) {
    const { service, tempRoot } = await makeDownloader(t, scenario);
    await assert.rejects(service.download(validUrl), (error) => {
      assert.equal(error.code, code);
      assert.ok(!error.message.includes('Secret'));
      return true;
    });
    assert.deepEqual(await readdir(tempRoot), []);
  }
});

test('rejects oversized completed files and max-filesize skips', async (t) => {
  for (const scenario of ['oversize', 'max-filesize']) {
    const { service, tempRoot } = await makeDownloader(t, scenario, { maxBytes: 1024 });
    await assert.rejects(service.download(validUrl), { code: 'FILE_TOO_LARGE' });
    assert.deepEqual(await readdir(tempRoot), []);
  }
});

test('default downloads accept files above the former 100 MiB limit without size or duration arguments', async (t) => {
  const { service, tempRoot, calls } = await makeDownloader(t, 'large-unlimited');
  const result = await service.download(validUrl);
  assert.equal(result.size, 100 * 1024 * 1024 + 1);
  assert.equal(calls[0].args.includes('--max-filesize'), false);
  assert.equal(calls[0].args[calls[0].args.indexOf('--match-filter') + 1], '!is_live');
  await result.cleanup();
  assert.deepEqual(await readdir(tempRoot), []);
});

test('kills a growing download when the observed file size exceeds the limit', async (t) => {
  const { service, tempRoot } = await makeDownloader(t, 'oversize-running', {
    maxBytes: 1024, sizeCheckIntervalMs: 10,
  });
  await assert.rejects(service.download(validUrl), { code: 'FILE_TOO_LARGE' });
  assert.deepEqual(await readdir(tempRoot), []);
});

test('empty/non-video posts receive a clear error and cleanup', async (t) => {
  const { service, tempRoot } = await makeDownloader(t, 'empty');
  await assert.rejects(service.download(validUrl), { code: 'VIDEO_NOT_FOUND' });
  assert.deepEqual(await readdir(tempRoot), []);
});

test('timeout terminates the child and removes partial files', async (t) => {
  const { service, tempRoot } = await makeDownloader(t, 'hang', { timeoutMs: 150 });
  await assert.rejects(service.download(validUrl), { code: 'DOWNLOAD_TIMEOUT', status: 504 });
  assert.deepEqual(await readdir(tempRoot), []);
});

test('client cancellation terminates an active child and removes partial files', async (t) => {
  const { service, tempRoot, calls } = await makeDownloader(t, 'hang');
  const controller = new AbortController();
  const pending = service.download(validUrl, { signal: controller.signal });
  const rejection = assert.rejects(pending, { code: 'CANCELLED' });
  while (calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  await rejection;
  assert.deepEqual(await readdir(tempRoot), []);
});

test('concurrency remains bounded until file transfer cleanup finishes', async (t) => {
  const { service } = await makeDownloader(t, 'success', { concurrency: 1 });
  const first = await service.download(validUrl);
  await assert.rejects(service.download(validUrl), { code: 'SERVER_BUSY', status: 429 });
  await first.cleanup();
  const next = await service.download(validUrl);
  assert.ok((await stat(next.filePath)).isFile());
  await next.cleanup();
});

test('a missing executable produces a recoverable setup error and cleanup', async (t) => {
  const { tempRoot } = await makeDownloader(t);
  const service = createDownloader({ executable: join(tempRoot, 'missing-binary'), tempRoot });
  assert.deepEqual(await service.health(), { available: false });
  await assert.rejects(service.download(validUrl), { code: 'DOWNLOADER_UNAVAILABLE', status: 503 });
  assert.deepEqual(await readdir(tempRoot), []);
});

test('shutdown cancels children, waits for cleanup and rejects new downloads', async (t) => {
  const { service, tempRoot, calls } = await makeDownloader(t, 'hang');
  const pending = service.download(validUrl);
  const rejected = assert.rejects(pending, { code: 'CANCELLED' });
  while (calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  await service.shutdown();
  await rejected;
  assert.deepEqual(await readdir(tempRoot), []);
  await assert.rejects(service.download(validUrl), { code: 'SERVER_SHUTTING_DOWN' });
});

test('shutdown also releases completed artifacts waiting for transfer cleanup', async (t) => {
  const { service, tempRoot } = await makeDownloader(t);
  await service.download(validUrl);
  await service.shutdown();
  assert.deepEqual(await readdir(tempRoot), []);
});

test('YouTube downloads the best DASH video and audio without resolution or codec caps and merges to MP4', async (t) => {
  const { service, calls } = await makeDownloader(t, 'success', { ffmpeg: 'C:\\owned tools\\ffmpeg.exe' });
  const result = await service.download('https://youtube.com/shorts/q_WdpYiXXaQ?si=tracking');
  assert.equal(result.filename, 'youtube-q_WdpYiXXaQ.mp4');
  const args = calls[0].args;
  const option = (key) => args[args.indexOf(key) + 1];
  assert.equal(option('--use-extractors'), 'Youtube');
  assert.equal(option('--js-runtimes'), `node:${process.execPath}`);
  assert.ok(args.includes('--no-js-runtimes'));
  assert.ok(args.includes('--no-plugin-dirs'));
  assert.ok(args.includes('--no-cookies'));
  assert.ok(args.includes('--no-cookies-from-browser'));
  assert.equal(option('--ffmpeg-location'), 'C:\\owned tools\\ffmpeg.exe');
  assert.equal(option('--merge-output-format'), 'mp4');
  assert.equal(option('--remux-video'), 'mp4');
  assert.match(option('--output'), /video\.%\(ext\)s$/);
  assert.equal(args.includes('--format-sort'), false);
  assert.equal(args.includes('--max-filesize'), false);
  assert.equal(option('--match-filter'), '!is_live');
  const alternatives = option('--format').split('/');
  assert.deepEqual(alternatives, ['bv+ba', 'b']);
  assert.ok(alternatives.filter((alternative) => alternative.startsWith('bv')).every((alternative) => alternative.includes('+ba')));
  assert.ok(!alternatives.some((alternative) => alternative.startsWith('ba')));
  assert.equal(args.at(-1), 'https://www.youtube.com/watch?v=q_WdpYiXXaQ');
  await result.cleanup();
});

test('X uses only its extractor and preserves support for direct silent MP4 posts', async (t) => {
  const { service, calls } = await makeDownloader(t);
  const result = await service.download('https://twitter.com/RealFedeURU/status/2112511582714347954/video/1?s=20');
  assert.equal(result.filename, 'x-2112511582714347954.mp4');
  const args = calls[0].args;
  assert.equal(args[args.indexOf('--use-extractors') + 1], 'Twitter');
  assert.equal(args[args.indexOf('--format') + 1], 'best[ext=mp4]/bestvideo[ext=mp4]');
  assert.equal(args.at(-1), 'https://x.com/RealFedeURU/status/2112511582714347954');
  assert.equal(args.includes('--merge-output-format'), false);
  await result.cleanup();
});

test('temporary DASH source/output duplication is allowed while final and aggregate size stay bounded', async (t) => {
  const youtube = 'https://youtu.be/0rW7Fbm4S7g';
  const { service, tempRoot } = await makeDownloader(t, 'merging', { maxBytes: 1024, sizeCheckIntervalMs: 5 });
  const result = await service.download(youtube);
  assert.equal(result.size, 800);
  await result.cleanup();
  assert.deepEqual(await readdir(tempRoot), []);
  for (const scenario of ['oversize-running', 'oversize-aggregate']) {
    const fixture = await makeDownloader(t, scenario, { maxBytes: 1024, sizeCheckIntervalMs: 5 });
    await assert.rejects(fixture.service.download(youtube), { code: 'FILE_TOO_LARGE' });
    assert.deepEqual(await readdir(fixture.tempRoot), []);
  }
  const instagram = await makeDownloader(t, 'merging', { maxBytes: 1024, sizeCheckIntervalMs: 5 });
  await assert.rejects(instagram.service.download(validUrl), { code: 'FILE_TOO_LARGE' });
  assert.deepEqual(await readdir(instagram.tempRoot), []);
});

test('YouTube/X failures are platform specific, safe, and handle successful filter skips without artifacts', async (t) => {
  for (const [url, prefix] of [
    ['https://youtube.com/watch?v=0rW7Fbm4S7g', 'YOUTUBE'],
    ['https://x.com/person/status/123', 'X'],
  ]) {
    for (const [scenario, code] of [
      ['auth', `${prefix}_AUTH_REQUIRED`],
      ['rate-limit', `${prefix}_RATE_LIMIT`],
      ['filtered', 'UNSUPPORTED_VIDEO'],
    ]) {
      const { service, tempRoot } = await makeDownloader(t, scenario);
      await assert.rejects(service.download(url), (error) => {
        assert.equal(error.code, code);
        assert.ok(!error.message.includes('Secret'));
        return true;
      });
      assert.deepEqual(await readdir(tempRoot), []);
    }
  }
});
