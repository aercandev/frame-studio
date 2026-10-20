import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { createDownloader } from '../src/downloader.js';

const validUrl = 'https://www.instagram.com/reel/ABC/';
const fixture = fileURLToPath(new URL('./fixtures/fake-downloader.js', import.meta.url));

async function startServer(t, scenario = 'success', options = {}) {
  const tempRoot = await mkdtemp(join(tmpdir(), 'insta-http-test-'));
  let spawned;
  const hasSpawned = new Promise((resolve) => { spawned = resolve; });
  const downloader = createDownloader({
    executable: process.execPath,
    tempRoot,
    spawnProcess(_executable, args, spawnOptions) {
      const child = spawn(process.execPath, [fixture, scenario, ...args], spawnOptions);
      spawned();
      return child;
    },
    ...options,
  });
  const app = createApp({ downloader, webDist: false, logger: { error() {} } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 3 });
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    tempRoot,
    hasSpawned,
  };
}

async function assertClean(tempRoot) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await readdir(tempRoot)).length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.deepEqual(await readdir(tempRoot), []);
}

function post(base, body) {
  return fetch(`${base}/api/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('health reports downloader readiness', async (t) => {
  const { base } = await startServer(t);
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', downloader: { available: true } });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('download streams an MP4 attachment and cleans up after transfer', async (t) => {
  const { base, tempRoot } = await startServer(t);
  const response = await post(base, { url: validUrl });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'video/mp4');
  assert.match(response.headers.get('content-disposition'), /attachment; filename="?instagram-ABC\.mp4"?$/);
  assert.equal(response.headers.get('accept-ranges'), null);
  assert.equal(await response.text(), 'fake mp4 contents');
  await assertClean(tempRoot);
});

test('invalid URL, malformed JSON and oversized JSON use stable error objects', async (t) => {
  const { base } = await startServer(t);
  const invalid = await post(base, { url: 'https://evil.test/' });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'INVALID_URL');
  const malformed = await fetch(`${base}/api/download`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_JSON');
  const tooLarge = await post(base, { url: 'a'.repeat(5000) });
  assert.equal(tooLarge.status, 413);
  assert.equal((await tooLarge.json()).error.code, 'REQUEST_TOO_LARGE');
});

test('upstream failure is readable JSON without internal output', async (t) => {
  const { base, tempRoot } = await startServer(t, 'private');
  const response = await post(base, { url: validUrl });
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.error.code, 'VIDEO_UNAVAILABLE');
  assert.ok(!body.error.message.includes('Secret'));
  await assertClean(tempRoot);
});

test('timeline edit lists larger than URL requests reach the export endpoint intact', async (t) => {
  let received;
  const app = createApp({
    webDist: false,
    downloader: { health: async () => ({ available: true }) },
    editor: { createExport(body) { received = body; return { id: 'timeline-job', status: 'queued' }; } },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const body = {
    mediaId: 'timeline-source',
    clips: Array.from({ length: 150 }, (_, index) => ({
      id: `clip-${index}`, start: index, end: index + 1,
      speed: 1, reverse: false, volume: 1, muted: false,
    })),
  };
  assert.ok(JSON.stringify(body).length > 4096);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/exports`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal(response.status, 202);
  assert.deepEqual(received, body);
  assert.equal((await response.json()).id, 'timeline-job');
});

test('disconnecting an HTTP request cancels the child and cleans partial files', async (t) => {
  const { base, tempRoot, hasSpawned } = await startServer(t, 'hang');
  const req = http.request(`${base}/api/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  req.on('error', () => {});
  req.end(JSON.stringify({ url: validUrl }));
  await hasSpawned;
  req.destroy();
  await assertClean(tempRoot);
});
