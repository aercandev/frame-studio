import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { cancelledError, DownloadError } from './errors.js';
import { createSourceImporter } from './source-importer.js';
import { defaultFfmpeg, defaultFfprobe, runVideoProcess } from './video-tools.js';

const safeAudioInput = () => ['-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,webm'];
const invalidRecording = () => new DownloadError(
  'INVALID_VOICEOVER', 'Ses kaydı okunamadı. Yalnızca ses içeren WebM veya MP4/M4A kaydı kullanın.', 422,
);
const missingRecording = () => new DownloadError('VOICEOVER_NOT_FOUND', 'Ses kaydı bulunamadı.', 404);
const removeDirectory = (directory) => directory
  ? rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  : Promise.resolve();

export function createVoiceoverStore({
  tempRoot = tmpdir(),
  ffmpeg = defaultFfmpeg(), ffprobe = defaultFfprobe(), runProcess = runVideoProcess,
  sourceImporter = createSourceImporter({ tempRoot }),
} = {}) {
  const recordings = new Map();
  const uploads = new Set();
  let stopping = false;

  function checkRunning() {
    if (stopping) throw new DownloadError('SERVER_SHUTTING_DOWN', 'Sunucu kapanıyor. Lütfen tekrar deneyin.', 503);
  }

  const descriptor = (recording) => ({
    id: recording.id, duration: recording.duration, filename: recording.filename, filePath: recording.filePath,
  });

  function find(id) {
    const recording = recordings.get(id);
    if (!recording || recording.deleted) throw missingRecording();
    return recording;
  }

  async function cleanup(recording) {
    if (!recording.deleted || recording.refs > 0) return;
    recording.cleanup ??= removeDirectory(recording.directory).then(() => recordings.delete(recording.id));
    await recording.cleanup;
  }

  async function inspect(filePath, signal, requireDuration) {
    const { stdout } = await runProcess(ffprobe, [
      '-v', 'error', ...safeAudioInput(),
      '-show_entries', 'stream=codec_type,sample_rate,channels,duration:format=duration',
      '-of', 'json', filePath,
    ], { signal, timeoutMs: 20_000 });
    let metadata;
    try { metadata = JSON.parse(stdout); } catch { throw invalidRecording(); }
    const streams = Array.isArray(metadata.streams) ? metadata.streams : [];
    const audio = streams.find((stream) => stream.codec_type === 'audio');
    if (!audio || streams.some((stream) => stream.codec_type === 'video') ||
        !Number.isFinite(Number(audio.sample_rate)) || Number(audio.sample_rate) <= 0 ||
        !Number.isInteger(audio.channels) || audio.channels < 1) throw invalidRecording();
    // MediaRecorder's streaming WebM often has no duration until it is remuxed.
    // Validate the streams first, then use the normalized M4A's actual duration.
    const duration = Number(metadata.format?.duration || audio.duration);
    if (requireDuration && (!Number.isFinite(duration) || duration <= 0)) throw invalidRecording();
    return duration;
  }

  async function upload(readable, { signal, filename = 'seslendirme.webm', contentLength } = {}) {
    checkRunning();
    const controller = new AbortController();
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let finish;
    const task = { controller, done: new Promise((resolve) => { finish = resolve; }) };
    uploads.add(task);
    let artifact;
    let directory;
    let retained = false;
    try {
      if (combinedSignal.aborted) throw cancelledError();
      artifact = await sourceImporter.upload(readable, { signal: combinedSignal, filename, contentLength });
      if (combinedSignal.aborted) throw cancelledError();
      await inspect(artifact.filePath, combinedSignal, false);
      await mkdir(tempRoot, { recursive: true });
      directory = await mkdtemp(join(tempRoot, 'video-voiceover-'));
      const filePath = join(directory, 'voiceover.m4a');
      await runProcess(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        ...safeAudioInput(), '-i', artifact.filePath,
        '-map', '0:a:0', '-vn', '-sn', '-dn',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
        '-map_metadata', '-1', '-map_chapters', '-1',
        '-movflags', '+faststart', '-f', 'ipod', filePath,
      ], { cwd: directory, signal: combinedSignal, outputPath: filePath, timeoutMs: 0, maxBytes: Infinity });
      const file = await stat(filePath);
      if (!file.isFile() || file.size === 0) throw invalidRecording();
      const duration = await inspect(filePath, combinedSignal, true);
      if (combinedSignal.aborted) throw cancelledError();
      const recording = {
        id: randomUUID(), duration, filename: `${parse(artifact.filename).name || 'seslendirme'}.m4a`,
        filePath, directory, refs: 0, deleted: false,
      };
      recordings.set(recording.id, recording);
      retained = true;
      return descriptor(recording);
    } catch (error) {
      if (combinedSignal.aborted) throw cancelledError();
      if (['INVALID_VIDEO', 'EMPTY_VIDEO', 'VIDEO_PROCESS_FAILED'].includes(error.code)) throw invalidRecording();
      throw error;
    } finally {
      try {
        try { await artifact?.cleanup(); }
        finally { if (!retained) await removeDirectory(directory); }
      } finally {
        uploads.delete(task);
        finish();
      }
    }
  }

  function get(id) {
    checkRunning();
    return descriptor(find(id));
  }

  function acquire(id) {
    checkRunning();
    const recording = find(id);
    recording.refs += 1;
    let released = false;
    return {
      ...descriptor(recording),
      release: async () => {
        if (released) return;
        released = true;
        recording.refs -= 1;
        await cleanup(recording);
      },
    };
  }

  async function deleteRecording(id) {
    const recording = find(id);
    recording.deleted = true;
    await cleanup(recording);
  }

  async function shutdown() {
    stopping = true;
    const pending = [...uploads];
    for (const task of pending) task.controller.abort();
    await Promise.all(pending.map((task) => task.done));
    for (const recording of recordings.values()) recording.deleted = true;
    await Promise.all([...recordings.values()].map(cleanup));
  }

  return { upload, get, acquire, delete: deleteRecording, shutdown };
}
