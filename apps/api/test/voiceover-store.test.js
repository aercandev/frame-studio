import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import test from 'node:test';
import { DownloadError } from '../src/errors.js';
import { createVoiceoverStore } from '../src/voiceover-store.js';
import { defaultFfmpeg, defaultFfprobe, runVideoProcess } from '../src/video-tools.js';

async function until(condition) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Condition timed out');
}

async function harness(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'voiceover-test-'));
  const work = join(root, 'work');
  await mkdir(work);
  const store = createVoiceoverStore({ tempRoot: work, ...options });
  t.after(async () => {
    await store.shutdown();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return { root, work, store };
}

async function makeRecording(path, format = 'webm') {
  await runVideoProcess(defaultFfmpeg(), [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.6',
    ...(format === 'webm' ? ['-c:a', 'libopus', '-f', 'webm', '-live', '1'] : ['-c:a', 'aac']),
    path,
  ]);
}

test('durationless recorded WebM and MP4 audio normalize to playable AAC M4A with measured duration', async (t) => {
  const { root, work, store } = await harness(t);
  for (const format of ['webm', 'mp4']) {
    const source = join(root, `microphone.${format}`);
    await makeRecording(source, format);
    if (format === 'webm') {
      const { stdout } = await runVideoProcess(defaultFfprobe(), [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', source,
      ]);
      assert.equal(JSON.parse(stdout).format.duration, undefined, 'fixture matches MediaRecorder WebM without a finalized duration');
    }
    const recording = await store.upload(Readable.from(await readFile(source)), { filename: `İstanbul.${format}` });
    assert.match(recording.id, /^[0-9a-f-]{36}$/);
    assert.equal(recording.filename, 'İstanbul.m4a');
    assert.ok(recording.duration >= 0.59 && recording.duration < 0.7, String(recording.duration));
    assert.deepEqual(store.get(recording.id), recording);
    const { stdout } = await runVideoProcess(defaultFfprobe(), [
      '-v', 'error', '-show_streams', '-of', 'json', recording.filePath,
    ]);
    const streams = JSON.parse(stdout).streams;
    assert.equal(streams.length, 1);
    assert.equal(streams[0].codec_type, 'audio');
    assert.equal(streams[0].codec_name, 'aac');
    assert.equal(streams[0].sample_rate, '48000');
    assert.equal(streams[0].channels, 2);
    await store.delete(recording.id);
  }
  assert.deepEqual(await readdir(work), []);
});

test('deleted voiceovers reject new access but keep their files until every acquired reference releases', async (t) => {
  const { root, work, store } = await harness(t);
  const source = join(root, 'microphone.webm');
  await makeRecording(source);
  const recording = await store.upload(Readable.from(await readFile(source)));
  const first = store.acquire(recording.id);
  const second = store.acquire(recording.id);
  await store.delete(recording.id);
  assert.throws(() => store.get(recording.id), { code: 'VOICEOVER_NOT_FOUND' });
  assert.throws(() => store.acquire(recording.id), { code: 'VOICEOVER_NOT_FOUND' });
  assert.equal((await stat(first.filePath)).isFile(), true);
  await first.release();
  await first.release();
  assert.equal((await stat(second.filePath)).isFile(), true);
  await second.release();
  await assert.rejects(stat(recording.filePath), { code: 'ENOENT' });
  assert.deepEqual(await readdir(work), []);
});

test('malformed recordings, playlists and video without audio are rejected and leave no artifacts', async (t) => {
  const { root, work, store } = await harness(t);
  const video = join(root, 'silent.mp4');
  await runVideoProcess(defaultFfmpeg(), [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'color=c=red:s=160x120:r=24:d=0.2',
    '-c:v', 'libx264', '-threads', '2', video,
  ]);
  for (const bytes of [
    Buffer.alloc(0), Buffer.from('not a media file'),
    Buffer.from('#EXTM3U\n#EXTINF:1,\nfile:///private.mp4\n'),
    Buffer.from('<html>not a recording</html>'), await readFile(video),
  ]) {
    await assert.rejects(store.upload(Readable.from(bytes), { filename: 'recording.webm' }), { code: 'INVALID_VOICEOVER' });
    assert.deepEqual(await readdir(work), []);
  }
});

test('client cancellation interrupts a stalled upload without destroying its incoming stream', async (t) => {
  const { work, store } = await harness(t);
  const controller = new AbortController();
  const incoming = new PassThrough();
  const uploading = store.upload(incoming, { signal: controller.signal });
  const rejected = assert.rejects(uploading, { code: 'CANCELLED' });
  incoming.write(Buffer.alloc(16));
  await until(async () => (await readdir(work)).length > 0);
  controller.abort();
  await rejected;
  assert.equal(incoming.destroyed, false);
  incoming.destroy();
  assert.deepEqual(await readdir(work), []);
});

test('shutdown cancels normalization, cleans partial files and rejects later uploads', async (t) => {
  let normalizing = false;
  const { root, work, store } = await harness(t, {
    runProcess(executable, args, options) {
      if (args.includes('-show_entries')) return runVideoProcess(executable, args, options);
      assert.equal(options.timeoutMs, 0);
      assert.equal(options.maxBytes, Infinity);
      normalizing = true;
      return new Promise((_resolve, reject) => {
        const cancel = () => reject(new DownloadError('CANCELLED', 'İptal edildi.', 499));
        options.signal.addEventListener('abort', cancel, { once: true });
        if (options.signal.aborted) cancel();
      });
    },
  });
  const source = join(root, 'microphone.webm');
  await makeRecording(source);
  const uploading = store.upload(Readable.from(await readFile(source)));
  const rejected = assert.rejects(uploading, { code: 'CANCELLED' });
  await until(() => normalizing);
  await store.shutdown();
  await rejected;
  assert.deepEqual(await readdir(work), []);
  await assert.rejects(store.upload(Readable.from('late')), { code: 'SERVER_SHUTTING_DOWN' });
});

test('shutdown deletes completed voiceovers while deferring removal for an active reader', async (t) => {
  const { root, work, store } = await harness(t);
  const source = join(root, 'microphone.webm');
  await makeRecording(source);
  const recording = await store.upload(Readable.from(await readFile(source)));
  const reader = store.acquire(recording.id);
  await store.shutdown();
  assert.equal((await stat(reader.filePath)).isFile(), true);
  assert.throws(() => store.acquire(recording.id), { code: 'SERVER_SHUTTING_DOWN' });
  await reader.release();
  assert.deepEqual(await readdir(work), []);
});
