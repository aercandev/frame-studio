import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createEditor } from '../src/editor.js';
import { normalizeEdit } from '../src/edit-spec.js';
import { defaultFfmpeg, probeVideo, runVideoProcess } from '../src/video-tools.js';

const metadata = { duration: 4, width: 160, height: 90, fps: 20, hasAudio: true };
const edit = (mediaId, clips, overrides = {}) => ({
  mediaId, clips, crop: { x: 0, y: 0, width: 1, height: 1 }, text: null,
  output: { name: 'timeline', format: 'mp4', codec: 'h264', fps: 'source', resolution: 'source', quality: 'high' },
  ...overrides,
});
const normal = { id: 'one', start: 0, end: 1, speed: 1, volume: 1, reverse: false, muted: false };

async function harness(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'timeline-export-test-'));
  const work = join(root, 'work');
  await mkdir(work);
  const source = join(root, 'source.mp4');
  await writeFile(source, 'fixture');
  const service = createEditor({
    downloader: { download: async () => ({ filePath: source, filename: 'source.mp4', cleanup: async () => {} }) },
    tempRoot: work, probe: probeVideo, logger: { error() {} }, ...options,
  });
  t.after(async () => {
    await service.shutdown();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return { service, source };
}

async function terminal(service, id) {
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    const result = service.exportStatus(id);
    if (['completed', 'failed', 'cancelled'].includes(result.status)) return result;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  assert.fail('Timeline export did not finish');
}

test('timeline strictly validates clips, gaps, freeze frames, audio and speed while accepting frame-length edits', () => {
  for (const clips of [
    null, [], [null], ['clip'], [{ ...normal, start: -1 }], [{ ...normal, end: 9 }],
    [{ ...normal, start: 1, end: 1 }], [{ ...normal, start: 2, end: 1 }],
    [{ ...normal, speed: 0 }], [{ ...normal, speed: 5 }], [{ ...normal, speed: '2' }],
    [{ ...normal, reverse: 'true' }], [{ ...normal, muted: 1 }],
    [{ ...normal, volume: -1 }], [{ ...normal, volume: 2.1 }],
    [{ ...normal, freezeDuration: 0 }], [{ ...normal, freezeDuration: Infinity }],
    [{ start: 4, end: 4, freezeDuration: 1 }], [{ gapDuration: -1 }],
    [{ gapDuration: 0 }], [{ gapDuration: 1, start: 0 }], [{ id: {}, gapDuration: 1 }],
  ]) assert.throws(() => normalizeEdit(edit('id', clips), metadata), { code: 'INVALID_EDIT', status: 400 });
  const spec = normalizeEdit(edit('id', [
    { ...normal, end: 1 / metadata.fps },
    { id: 'f', start: 2, end: 2, freezeDuration: 1 },
    { id: 'g', gapDuration: 0.5 },
  ]), metadata);
  assert.equal(spec.duration, 1.55);
  assert.equal(spec.clips[1].duration, 1);
  assert.equal(spec.clips[2].duration, 0.5);
  const withText = { value: 'last clip', x: 0.5, y: 0.5, size: 6, color: '#ffffff', start: 1.2, end: 1.5 };
  assert.equal(normalizeEdit(edit('id', spec.clips, { text: withText }), metadata).text.end, 1.5);
  assert.throws(() => normalizeEdit(edit('id', [normal], { text: withText }), metadata), { code: 'INVALID_EDIT' });
});

test('large source dimensions and long timeline durations are not restricted by editorial limits', () => {
  const spec = normalizeEdit(edit('id', [{ start: 0, end: 7200 }]), {
    ...metadata, duration: 7200, width: 10000, height: 8000,
  });
  assert.equal(spec.width, 10000);
  assert.equal(spec.height, 8000);
  assert.equal(spec.duration, 7200);
});

test('voiceovers validate parent membership and finite settings, then trim to source and timeline remainder', () => {
  const voices = new Map([['voice', { duration: 3 }]]);
  const payload = (voiceovers) => ({ ...edit('id', [normal]), voiceovers });
  for (const voiceovers of [
    {}, [null], [{ id: 'foreign' }], [{ id: 'voice', start: 1 }], [{ id: 'voice', offset: 3 }],
    [{ id: 'voice', offset: -1 }], [{ id: 'voice', duration: 0 }], [{ id: 'voice', duration: Infinity }],
    [{ id: 'voice', muted: 'true' }], [{ id: 'voice', volume: 3 }],
  ]) assert.throws(() => normalizeEdit(payload(voiceovers), metadata, voices), { code: 'INVALID_EDIT' });
  const spec = normalizeEdit(payload([{ id: 'voice', start: 0.5, offset: 2, duration: 2 }]), metadata, voices);
  assert.equal(spec.voiceovers[0].duration, 0.5);
  assert.equal(spec.voiceovers[0].offset, 2);
  assert.equal(spec.voiceovers[0].volume, 1);
});

test('editor defaults do not impose retained-media, retained-export, byte or processing-time limits', async (t) => {
  const seen = [];
  const { service } = await harness(t, {
    probe: async () => metadata,
    runProcess: async (_exe, _args, options) => {
      seen.push(options);
      await writeFile(options.outputPath, 'output');
    },
  });
  for (let index = 0; index < 14; index += 1) {
    const media = await service.importMedia('https://www.instagram.com/reel/TEST/');
    const job = service.createExport(edit(media.id, [normal]));
    assert.equal((await terminal(service, job.id)).status, 'completed');
  }
  assert.equal(seen.length, 14);
  assert.ok(seen.every((options) => options.maxBytes === Infinity && options.timeoutMs === 0));
});

test('real timeline export applies reordering, speed, reverse, freeze, gaps, duplication and per-clip audio', async (t) => {
  const { service, source } = await harness(t);
  await runVideoProcess(defaultFfmpeg(), [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', "nullsrc=s=160x90:r=20:d=4,geq=lum='40+40*T':cb=128:cr=128",
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4',
    '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-threads', '2', '-shortest', source,
  ]);
  const media = await service.importMedia('https://www.instagram.com/reel/TEST/');
  const job = service.createExport(edit(media.id, [
    { id: 'fast-half-volume', start: 2, end: 3, speed: 2, volume: 0.5 },
    { id: 'reverse', start: 0, end: 1, reverse: true },
    { id: 'freeze', start: 1.5, end: 1.5, freezeDuration: 0.5 },
    { id: 'gap', gapDuration: 0.5 },
    { id: 'duplicate-muted', start: 2, end: 3, speed: 2, muted: true },
  ]));
  const result = await terminal(service, job.id);
  assert.equal(result.status, 'completed', JSON.stringify(result.error));
  assert.equal(result.duration, 3);
  const output = service.exportFile(job.id);
  const info = await probeVideo(output.filePath);
  assert.equal(info.width, 160);
  assert.equal(info.height, 90);
  assert.equal(info.hasAudio, true);
  assert.ok(Math.abs(info.duration - 3) < 0.1, `duration=${info.duration}`);
  const brightness = async (time) => {
    const { stdout } = await runVideoProcess(defaultFfmpeg(), [
      '-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', output.filePath,
      '-vf', 'signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=-',
      '-frames:v', '1', '-an', '-f', 'null', '-',
    ]);
    return Number(stdout.match(/lavfi\.signalstats\.YAVG=([\d.]+)/)?.[1]);
  };
  const frames = await Promise.all([0.1, 0.4, 0.6, 1.3, 1.6, 1.9, 2.1, 2.6, 2.9].map(brightness));
  assert.ok(frames[1] > frames[0] + 15, `Speed progression ${frames}`);
  assert.ok(frames[2] > frames[3] + 15, `Reverse progression ${frames}`);
  assert.ok(Math.abs(frames[4] - frames[5]) < 2, `Freeze ${frames}`);
  assert.ok(frames[6] < 20, `Black gap ${frames}`);
  assert.ok(Math.abs(frames[7] - frames[0]) < 3 && Math.abs(frames[8] - frames[1]) < 3, `Duplicate ${frames}`);
  const volume = async (time) => {
    const { stderr } = await runVideoProcess(defaultFfmpeg(), [
      '-hide_banner', '-loglevel', 'info', '-i', output.filePath,
      '-vn', '-af', `atrim=start=${time}:duration=0.2,asetpts=PTS-STARTPTS,volumedetect`, '-f', 'null', '-',
    ]);
    return Number(stderr.match(/mean_volume:\s*(-?[\d.]+) dB/)?.[1]);
  };
  const levels = await Promise.all([0.1, 0.7, 1.6, 2.1, 2.6].map(volume));
  assert.ok(levels[1] - levels[0] > 5 && levels[1] - levels[0] < 7, `Half-volume ${levels}`);
  assert.ok(levels.slice(2).every((level) => level <= -80), `Silent freeze, gap and mute ${levels}`);
  await output.release();
});

test('real silent timeline accepts only gaps and freezes without inventing an audio stream', async (t) => {
  const { service, source } = await harness(t);
  await runVideoProcess(defaultFfmpeg(), [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=20:d=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-threads', '2', source,
  ]);
  const media = await service.importMedia('https://www.instagram.com/reel/TEST/');
  for (const clips of [
    [{ start: 1, freezeDuration: 0.5 }, { gapDuration: 0.5 }],
    [{ gapDuration: 1 }],
    [{ start: 1.999, freezeDuration: 1 }],
    [{ start: 0, end: 0.05, speed: 4 }, { gapDuration: 0.9875 }],
  ]) {
    const job = service.createExport(edit(media.id, clips));
    const result = await terminal(service, job.id);
    assert.equal(result.status, 'completed', JSON.stringify(result.error));
    const output = service.exportFile(job.id);
    const info = await probeVideo(output.filePath);
    assert.equal(info.hasAudio, false);
    assert.ok(Math.abs(info.duration - 1) < 0.1);
    await output.release();
  }
});

test('real recorded voiceovers mix at the requested timeline position, survive deletion during export, and obey parent ownership', async (t) => {
  const { service, source } = await harness(t);
  const voicePath = join(source, '..', 'microphone.webm');
  await runVideoProcess(defaultFfmpeg(), [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=1',
    '-c:a', 'libopus', '-f', 'webm', '-live', '1', voicePath,
  ]);
  for (const sourceAudio of [true, false]) {
    await runVideoProcess(defaultFfmpeg(), [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=20:d=3',
      ...(sourceAudio ? ['-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=3', '-c:a', 'aac'] : []),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-threads', '2', source,
    ]);
    const media = await service.importMedia('https://www.instagram.com/reel/TEST/');
    const foreignMedia = await service.importMedia('https://www.instagram.com/reel/TEST/');
    const voice = await service.uploadVoiceover(media.id, createReadStream(voicePath), { filename: 'microphone.webm' });
    assert.equal(voice.filePath, undefined);
    const reader = service.voiceoverFile(media.id, voice.id);
    assert.equal(reader.contentType, 'audio/mp4');
    assert.throws(() => service.voiceoverFile(foreignMedia.id, voice.id), { code: 'NOT_FOUND' });
    assert.throws(() => service.createExport(edit(foreignMedia.id, [normal], { voiceovers: [{ id: voice.id }] })), { code: 'INVALID_EDIT' });
    const job = service.createExport(edit(media.id, [{ start: 0, end: 3 }], {
      voiceovers: [{ id: voice.id, start: 1, offset: 0.1, duration: 0.5, volume: 1 }],
    }));
    // The queued render owns its recording independently of the media library.
    await service.deleteVoiceover(media.id, voice.id);
    assert.throws(() => service.voiceoverFile(media.id, voice.id), { code: 'NOT_FOUND' });
    await reader.release();
    const result = await terminal(service, job.id);
    assert.equal(result.status, 'completed', JSON.stringify(result.error));
    const output = service.exportFile(job.id);
    const info = await probeVideo(output.filePath);
    assert.equal(info.hasAudio, true);
    assert.ok(Math.abs(info.duration - 3) < 0.1);
    const volume = async (time) => {
      const { stderr } = await runVideoProcess(defaultFfmpeg(), [
        '-hide_banner', '-loglevel', 'info', '-i', output.filePath,
        '-vn', '-af', `atrim=start=${time}:duration=0.15,asetpts=PTS-STARTPTS,volumedetect`, '-f', 'null', '-',
      ]);
      return Number(stderr.match(/mean_volume:\s*(-?[\d.]+) dB/)?.[1]);
    };
    const levels = await Promise.all([0.4, 1.2, 2.1].map(volume));
    if (sourceAudio) {
      assert.ok(levels[1] > levels[0] + 1, `Source and microphone mix: ${levels}`);
      assert.ok(Math.abs(levels[0] - levels[2]) < 1, `Source preserved around recording: ${levels}`);
    } else {
      assert.ok(levels[0] <= -80 && levels[2] <= -80 && levels[1] > -40, `Silent source receives positioned recording: ${levels}`);
    }
    await output.release();
  }
});
