import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { probeVideo, runVideoProcess } from '../src/video-tools.js';

function fakeProcess(onStart) {
  return (_executable, _args, _options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    queueMicrotask(() => onStart(child));
    return child;
  };
}

function metadataProcess(overrides = {}) {
  return fakeProcess((child) => {
    child.stdout.end(JSON.stringify({
      streams: [{
        codec_type: 'video', width: 16384, height: 9216,
        duration: '7200', avg_frame_rate: '480/1', ...overrides,
      }],
    }));
    child.emit('close', 0);
  });
}

test('probe accepts valid long, high-resolution and high-frame-rate videos without former ceilings', async () => {
  const metadata = await probeVideo('fixture.mp4', { spawnProcess: metadataProcess() });
  assert.deepEqual(metadata, { duration: 7200, width: 16384, height: 9216, fps: 480, hasAudio: false });
});

test('probe still rejects nonfinite duration, dimensions and frame rates', async () => {
  for (const invalid of [
    { duration: 'Infinity' }, { duration: '-1' }, { width: 0 }, { height: 1.5 },
    { width: Infinity }, { avg_frame_rate: 'Infinity/1' }, { avg_frame_rate: '0/1' },
  ]) {
    await assert.rejects(probeVideo('fixture.mp4', { spawnProcess: metadataProcess(invalid) }), { code: 'INVALID_VIDEO' });
  }
});

test('video processing has no default output size cap, while an explicit cap still cancels processing', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'video-tools-test-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const outputPath = join(root, 'large.mp4');
  await writeFile(outputPath, 'fixture');
  await truncate(outputPath, 250 * 1024 * 1024 + 1);
  let killed = 0;
  const spawnProcess = fakeProcess((child) => {
    child.timer = setTimeout(() => child.emit('close', 0), 350);
  });
  const terminateProcess = async (child) => {
    killed += 1;
    clearTimeout(child.timer);
    child.emit('close', 1);
  };
  await runVideoProcess('fixture', [], { outputPath, spawnProcess, terminateProcess });
  assert.equal(killed, 0);
  await assert.rejects(runVideoProcess('fixture', [], {
    outputPath, spawnProcess, terminateProcess, maxBytes: 1024,
  }), { code: 'EXPORT_TOO_LARGE' });
  assert.equal(killed, 1);
});

test('explicit process timeout and cancellation remain effective without default timeout timers', async () => {
  const spawnProcess = fakeProcess(() => {});
  const terminateProcess = async (child) => child.emit('close', 1);
  await assert.rejects(runVideoProcess('fixture', [], {
    spawnProcess, terminateProcess, timeoutMs: 20,
  }), { code: 'EXPORT_TIMEOUT' });
  const controller = new AbortController();
  const processing = runVideoProcess('fixture', [], {
    spawnProcess, terminateProcess, signal: controller.signal, timeoutMs: Infinity,
  });
  controller.abort();
  await assert.rejects(processing, { code: 'CANCELLED' });
});
