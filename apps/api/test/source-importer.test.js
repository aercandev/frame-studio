import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import test from 'node:test';
import { createSourceImporter, isPublicAddress, parsePublicVideoUrl } from '../src/source-importer.js';

const publicAddress = '93.184.215.14';
const videoBytes = Buffer.from('\x00\x00\x00\x18ftypmp42fixture video');
const lookup = async () => [{ address: publicAddress, family: 4 }];

async function workspace(t) {
  const tempRoot = await mkdtemp(join(tmpdir(), 'source-import-test-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return tempRoot;
}

async function fixture(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const requests = [];
  // Explicit test-only transport sends to the fixture; the production factory
  // never relaxes address checks or accepts private DNS answers.
  const request = (url, options, callback) => {
    requests.push({ url: url.href, options });
    return http.request(new URL(`${url.pathname}${url.search}`, `http://127.0.0.1:${server.address().port}`), options, callback);
  };
  return { request, requests };
}

test('public URL validation rejects private/reserved and IPv4-mapped addresses, including URL-normalized forms', () => {
  for (const address of [
    '0.0.0.0', '10.20.30.40', '100.64.0.1', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '172.31.255.255', '192.0.0.8', '192.0.2.2', '192.88.99.1',
    '192.168.1.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1',
    '255.255.255.255', '::', '::1', '::ffff:127.0.0.1', '::ffff:8.8.8.8',
    '::ffff:7f00:1', '64:ff9b::7f00:1', 'fe80::1', 'fc00::1', 'ff02::1',
    '2001::7f00:1', '2001:db8::1', '2002:7f00:1::', '3fff::1',
  ]) assert.equal(isPublicAddress(address), false, address);
  for (const address of [publicAddress, '8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888']) {
    assert.equal(isPublicAddress(address), true, address);
  }
  for (const value of [
    'http://2130706433/video.mp4', 'http://0x7f000001/video.mp4', 'http://127.1/video.mp4',
    'http://[::ffff:7f00:1]/video.mp4', 'file:///video.mp4', 'ftp://example.com/video',
    'https://user:pass@example.com/video.mp4', 'data:video/mp4,abc', 'not a URL',
  ]) assert.throws(() => parsePublicVideoUrl(value), { name: 'DownloadError' }, value);
  assert.equal(parsePublicVideoUrl('https://media.example/a.mp4?token=a%2Bb%2Fc&expires=20#ignore').href,
    'https://media.example/a.mp4?token=a%2Bb%2Fc&expires=20');
});

test('all DNS answers must be public before requesting; failed and mixed DNS leave no artifacts', async (t) => {
  const tempRoot = await workspace(t);
  let requested = false;
  for (const addresses of [
    [{ address: '127.0.0.1', family: 4 }],
    [{ address: publicAddress, family: 4 }, { address: '10.0.0.1', family: 4 }],
    [{ address: '::ffff:127.0.0.1', family: 6 }],
  ]) {
    const importer = createSourceImporter({
      tempRoot, lookup: async () => addresses, request() { requested = true; throw Error('must not connect'); },
    });
    await assert.rejects(importer.download('https://media.example/video.mp4'), { code: 'URL_NOT_ALLOWED' });
  }
  assert.equal(requested, false);
  assert.deepEqual(await readdir(tempRoot), []);
});

test('direct chunked video streams to disk, signed queries survive and socket lookup is pinned without re-resolving', async (t) => {
  const tempRoot = await workspace(t);
  const transport = await fixture(t, (req, res) => {
    assert.equal(req.url, '/clip%20one.mp4?token=a%2Bb%2Fc');
    res.writeHead(200, { 'Content-Type': 'video/mp4' });
    res.write(videoBytes.subarray(0, 10));
    res.end(videoBytes.subarray(10));
  });
  let lookups = 0;
  const importer = createSourceImporter({
    tempRoot, request: transport.request,
    lookup: async (_hostname, options) => {
      assert.equal(options.all, true);
      lookups += 1;
      return lookups === 1 ? [{ address: publicAddress, family: 4 }] : [{ address: '127.0.0.1', family: 4 }];
    },
  });
  const artifact = await importer.download('https://media.example/clip%20one.mp4?token=a%2Bb%2Fc');
  assert.deepEqual(await readFile(artifact.filePath), videoBytes);
  assert.equal(artifact.filename, 'clip one.mp4');
  assert.equal(artifact.size, videoBytes.length);
  assert.equal(lookups, 1);
  const { options, url } = transport.requests[0];
  assert.equal(url, 'https://media.example/clip%20one.mp4?token=a%2Bb%2Fc');
  assert.equal(options.agent, false);
  assert.equal(options.autoSelectFamily, false);
  await new Promise((resolve, reject) => options.lookup('media.example', {}, (error, address, family) => {
    if (error) { reject(error); return; }
    assert.equal(address, publicAddress); assert.equal(family, 4); resolve();
  }));
  await new Promise((resolve) => options.lookup('media.example', { all: true }, (_error, addresses) => {
    assert.deepEqual(addresses, [{ address: publicAddress, family: 4 }]); resolve();
  }));
  await artifact.cleanup();
  await artifact.cleanup();
  assert.deepEqual(await readdir(tempRoot), []);
});

test('every redirect is revalidated, including same-host DNS rebinding and private literal targets', async (t) => {
  const tempRoot = await workspace(t);
  let destination = 'http://169.254.169.254/metadata';
  const transport = await fixture(t, (_req, res) => {
    res.writeHead(302, { Location: destination });
    res.end();
  });
  let calls = 0;
  const importer = createSourceImporter({
    tempRoot, request: transport.request,
    lookup: async () => (++calls === 1 ? [{ address: publicAddress, family: 4 }] : [{ address: '127.0.0.1', family: 4 }]),
  });
  await assert.rejects(importer.download('https://media.example/video.mp4'), { code: 'URL_NOT_ALLOWED' });
  assert.equal(transport.requests.length, 1);
  destination = '/next.mp4';
  calls = 0;
  await assert.rejects(importer.download('https://media.example/video.mp4'), { code: 'URL_NOT_ALLOWED' });
  assert.equal(transport.requests.length, 2);
  assert.deepEqual(await readdir(tempRoot), []);
});

test('public relative redirects work and redirect loops stop after five hops', async (t) => {
  const tempRoot = await workspace(t);
  const transport = await fixture(t, (req, res) => {
    if (req.url === '/actual.mov') { res.end(videoBytes); return; }
    res.writeHead(307, { Location: req.url === '/first' ? '/actual.mov' : '/loop' });
    res.end();
  });
  const importer = createSourceImporter({ tempRoot, request: transport.request, lookup });
  const artifact = await importer.download('https://media.example/first');
  assert.equal(artifact.filename, 'actual.mov');
  await artifact.cleanup();
  const before = transport.requests.length;
  await assert.rejects(importer.download('https://media.example/loop'), { code: 'TOO_MANY_REDIRECTS' });
  assert.equal(transport.requests.length - before, 6);
  assert.deepEqual(await readdir(tempRoot), []);
});

test('web pages, JSON and manifests are rejected before a file reaches the editor', async (t) => {
  const tempRoot = await workspace(t);
  const transport = await fixture(t, (req, res) => {
    const variants = {
      '/html': ['text/html', '<html>not a video</html>'],
      '/json': ['application/json', '{"url":"video"}'],
      '/playlist': ['application/vnd.apple.mpegurl', '#EXTM3U\nsegment.ts'],
      '/hidden-html': ['application/octet-stream', '<!DOCTYPE html><html>login</html>'],
      '/hidden-playlist': ['video/mp4', '#EXTM3U\nsegment.ts'],
      '/empty': ['video/mp4', ''],
    };
    const [type, body] = variants[req.url];
    res.writeHead(200, { 'Content-Type': type });
    res.end(body);
  });
  const importer = createSourceImporter({ tempRoot, request: transport.request, lookup });
  for (const path of ['/html', '/json', '/playlist', '/hidden-html', '/hidden-playlist', '/empty']) {
    await assert.rejects(importer.download(`https://media.example${path}`), { code: path === '/empty' ? 'EMPTY_VIDEO' : 'INVALID_VIDEO' });
  }
  assert.deepEqual(await readdir(tempRoot), []);
});

test('chunked downloads and uploads enforce measured byte limits independent of claimed content length', async (t) => {
  const tempRoot = await workspace(t);
  const transport = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'video/mp4' });
    res.write(Buffer.alloc(8)); res.end(Buffer.alloc(8));
  });
  const importer = createSourceImporter({ tempRoot, request: transport.request, lookup, maxBytes: 10 });
  await assert.rejects(importer.download('https://media.example/video.mp4'), { code: 'FILE_TOO_LARGE', status: 413 });
  const input = new PassThrough();
  const uploading = importer.upload(input, { filename: 'movie.mp4', contentLength: 1 });
  input.write(Buffer.alloc(16));
  await assert.rejects(uploading, { code: 'FILE_TOO_LARGE', status: 413 });
  assert.equal(input.destroyed, false, 'oversized upload stream must remain available for the route JSON response');
  input.destroy();
  await assert.rejects(importer.upload(Readable.from(videoBytes), { contentLength: 100 }), { code: 'FILE_TOO_LARGE' });
  assert.deepEqual(await readdir(tempRoot), []);
});

test('default uploads and direct downloads accept content above the former 100 MiB limit', async (t) => {
  const tempRoot = await workspace(t);
  const chunk = Buffer.alloc(1024 * 1024);
  const total = chunk.length * 101;
  function* chunks() {
    for (let index = 0; index < 101; index += 1) yield chunk;
  }
  const importer = createSourceImporter({
    tempRoot, lookup,
    request(_url, _options, callback) {
      const req = new EventEmitter();
      req.end = () => {
        const response = Readable.from(chunks());
        response.statusCode = 200;
        response.headers = { 'content-type': 'video/mp4', 'content-length': String(total) };
        queueMicrotask(() => callback(response));
      };
      return req;
    },
  });
  const uploaded = await importer.upload(Readable.from(chunks()), { filename: 'large.mp4', contentLength: total });
  assert.equal(uploaded.size, total);
  await uploaded.cleanup();
  const downloaded = await importer.download('https://media.example/large.mp4');
  assert.equal(downloaded.size, total);
  await downloaded.cleanup();
  assert.deepEqual(await readdir(tempRoot), []);
});

test('dishonest upstream Content-Length cannot bypass the measured stream limit', async (t) => {
  const tempRoot = await workspace(t);
  const importer = createSourceImporter({
    tempRoot, lookup, maxBytes: 10,
    request(_url, _options, callback) {
      const req = new EventEmitter();
      req.end = () => {
        const response = Readable.from([Buffer.alloc(16)]);
        response.statusCode = 200;
        response.headers = { 'content-length': '1' };
        queueMicrotask(() => callback(response));
      };
      return req;
    },
  });
  await assert.rejects(importer.download('https://media.example/movie.mp4'), { code: 'FILE_TOO_LARGE' });
  assert.deepEqual(await readdir(tempRoot), []);
});

test('upload writes bytes without trusting extensions and sanitizes Windows paths and reserved names', async (t) => {
  const tempRoot = await workspace(t);
  const importer = createSourceImporter({ tempRoot });
  const artifact = await importer.upload(Readable.from(videoBytes), { filename: 'C:\\fakepath\\güzel: video?.MOV' });
  assert.equal(artifact.filename, 'güzel_ video_.MOV');
  assert.deepEqual(await readFile(artifact.filePath), videoBytes);
  await artifact.cleanup();
  const reserved = await importer.upload(Readable.from(videoBytes), { filename: '../CON.mp4' });
  assert.equal(reserved.filename, 'video.bin');
  await reserved.cleanup();
  await assert.rejects(importer.upload(Readable.from([])), { code: 'EMPTY_VIDEO' });
  await assert.rejects(importer.upload(Readable.from(['<html>bad</html>']), { filename: 'movie.mp4' }), { code: 'INVALID_VIDEO' });
  assert.deepEqual(await readdir(tempRoot), []);
});

test('timeouts cover DNS and stalled response bodies and clean temporary files', async (t) => {
  const tempRoot = await workspace(t);
  const stalledLookup = createSourceImporter({ tempRoot, timeoutMs: 50, lookup: () => new Promise(() => {}) });
  await assert.rejects(stalledLookup.download('https://media.example/video.mp4'), { code: 'IMPORT_TIMEOUT', status: 504 });
  const transport = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'video/mp4' });
    res.write(videoBytes);
  });
  const importer = createSourceImporter({ tempRoot, timeoutMs: 50, lookup, request: transport.request });
  await assert.rejects(importer.download('https://media.example/video.mp4'), { code: 'IMPORT_TIMEOUT' });
  const input = new PassThrough();
  await assert.rejects(importer.upload(input, { filename: 'video.mp4' }), { code: 'IMPORT_TIMEOUT' });
  assert.equal(input.destroyed, false);
  input.destroy();
  assert.deepEqual(await readdir(tempRoot), []);
});

test('cancellation interrupts stalled uploads and DNS without leaving artifacts', async (t) => {
  const tempRoot = await workspace(t);
  const importer = createSourceImporter({ tempRoot, lookup: () => new Promise(() => {}) });
  const controller = new AbortController();
  const pending = importer.download('https://media.example/video.mp4', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: 'CANCELLED' });
  const uploadController = new AbortController();
  const input = new PassThrough();
  const uploading = importer.upload(input, { signal: uploadController.signal });
  setTimeout(() => uploadController.abort(), 10);
  await assert.rejects(uploading, { code: 'CANCELLED' });
  assert.equal(input.destroyed, false);
  input.destroy();
  assert.deepEqual(await readdir(tempRoot), []);
});
