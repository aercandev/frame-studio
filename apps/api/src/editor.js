import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DownloadError } from './errors.js';
import { exportArguments, exportFilterGraph, normalizeEdit } from './edit-spec.js';
import { defaultFfmpeg, prepareVideoArguments, probeVideo, runVideoProcess } from './video-tools.js';
import { createSourceImporter } from './source-importer.js';
import { identifyPlatform, parsePlatformUrl } from './platform-url.js';
import { createVoiceoverStore } from './voiceover-store.js';

const fontFile = fileURLToPath(new URL('../../web/public/fonts/NotoSans-Regular.ttf', import.meta.url));
const notFound = () => new DownloadError('NOT_FOUND', 'Video veya dışa aktarma bulunamadı. Oturumu yenileyip tekrar deneyin.', 404);
const removeDirectory = (directory) => directory
  ? rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  : Promise.resolve();

export function createEditor({
  downloader, tempRoot = tmpdir(), ttlMs = 60 * 60_000,
  cleanupIntervalMs = 60_000, maxMedia = Infinity, maxExports = Infinity,
  maxExportBytes = Infinity, exportTimeoutMs = 0,
  maxConcurrentImports = 2, maxPreparedBytes = Infinity, prepareTimeoutMs = 0,
  ffmpeg = defaultFfmpeg(), fontPath = fontFile, probe = probeVideo,
  runProcess = runVideoProcess, logger = console, sourceImporter = createSourceImporter({ tempRoot }),
  voiceoverStore = createVoiceoverStore({ tempRoot }),
} = {}) {
  const mediaItems = new Map();
  const jobs = new Map();
  const imports = new Set();
  const queue = [];
  let running = false;
  let stopping = false;
  const checkRunning = () => {
    if (stopping) throw new DownloadError('SERVER_SHUTTING_DOWN', 'Sunucu kapanıyor. Lütfen tekrar deneyin.', 503);
  };
  const publicMedia = (media) => ({
    id: media.id, url: `/api/media/${media.id}/file`, filename: media.filename,
    ...media.metadata,
  });
  const publicJob = (job) => ({
    id: job.id, status: job.status, progress: Math.round(job.progress),
    filename: job.spec.filename, format: job.spec.format, codec: job.spec.codec,
    width: job.spec.width, height: job.spec.height, fps: job.spec.fps, duration: job.spec.duration,
    ...(job.error ? { error: job.error } : {}),
    ...(job.status === 'completed' ? { downloadUrl: `/api/exports/${job.id}/file` } : {}),
  });
  function getMedia(id) {
    const media = mediaItems.get(id);
    if (!media || media.deleted) throw notFound();
    media.touched = Date.now();
    return media;
  }
  function getJob(id) {
    const job = jobs.get(id);
    if (!job || job.deleted) throw notFound();
    job.touched = Date.now();
    return job;
  }
  async function cleanupMedia(media) {
    if (!media.deleted || media.refs > 0) return;
    media.cleanup ??= (async () => {
      await Promise.all([...media.voiceovers.keys()].map((id) => voiceoverStore.delete(id)));
      await removeDirectory(media.directory);
      mediaItems.delete(media.id);
    })();
    await media.cleanup;
  }
  async function releaseMedia(media) {
    media.refs -= 1;
    await cleanupMedia(media);
  }
  async function releaseSource(job) {
    if (job.sourceReleased) return;
    job.sourceReleased = true;
    try {
      await Promise.all(job.voices.map((voice) => voice.release()));
    } finally {
      await releaseMedia(job.media);
    }
  }
  async function cleanupJob(job) {
    if (!job.deleted || job.refs > 0 || ['processing', 'queued'].includes(job.status)) return;
    job.cleanup ??= removeDirectory(job.directory).then(() => jobs.delete(job.id));
    await job.cleanup;
  }

  async function importArtifact(acquireArtifact, { signal, prepare = false } = {}) {
    checkRunning();
    if (imports.size >= maxConcurrentImports) {
      throw new DownloadError('SERVER_BUSY', 'İki video içe aktarılıyor. Lütfen tamamlanmasını bekleyin.', 429);
    }
    if (mediaItems.size + imports.size >= maxMedia) {
      throw new DownloadError('MEDIA_LIMIT', 'Sunucunun video saklama sınırına ulaşıldı. Kullanılmayan projeleri kapatın.', 429);
    }
    const controller = new AbortController();
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let finish;
    const task = { controller, done: new Promise((resolve) => { finish = resolve; }) };
    imports.add(task);
    let artifact;
    let directory;
    let retained = false;
    try {
      artifact = await acquireArtifact(combinedSignal);
      if (combinedSignal.aborted) throw new DownloadError('CANCELLED', 'İşlem iptal edildi.', 499);
      await mkdir(tempRoot, { recursive: true });
      directory = await mkdtemp(join(tempRoot, 'insta-media-'));
      const filePath = join(directory, 'source.mp4');
      if (prepare) {
        try {
          // Validate before decoding; a video extension or MIME type is not proof
          // of a standalone video. The probe and decoder restrict input formats.
          const sourceMetadata = await probe(artifact.filePath, { signal: combinedSignal, squarePixels: true });
          await runProcess(ffmpeg, prepareVideoArguments(artifact.filePath, filePath, sourceMetadata), {
            cwd: directory, signal: combinedSignal, outputPath: filePath,
            maxBytes: maxPreparedBytes, timeoutMs: prepareTimeoutMs,
          });
          const file = await stat(filePath);
          if (!file.size) throw new DownloadError('INVALID_VIDEO', 'Video dosyası boş veya okunamıyor.');
          if (file.size > maxPreparedBytes) {
            throw new DownloadError('EXPORT_TOO_LARGE', 'Video boyut sınırını aşıyor.', 413);
          }
        } catch (error) {
          if (error.code === 'EXPORT_TIMEOUT') {
            throw new DownloadError('IMPORT_TIMEOUT', 'Video hazırlama sunucuda tanımlanan süre içinde tamamlanamadı.', 504);
          }
          if (error.code === 'EXPORT_TOO_LARGE') {
            throw new DownloadError('PREPARED_VIDEO_TOO_LARGE', 'Hazırlanan video sunucuda tanımlanan boyut sınırını aşıyor.', 413);
          }
          if (error.code === 'VIDEO_PROCESS_FAILED') {
            throw new DownloadError('INVALID_VIDEO', 'Video okunamadı. MP4, MOV, WebM, MKV veya AVI biçiminde bir video seçin.', 422);
          }
          throw error;
        }
      } else {
        // Downloader slots live until artifact.cleanup, so editor owns a copy.
        await copyFile(artifact.filePath, filePath);
      }
      const metadata = await probe(filePath, { signal: combinedSignal });
      if (combinedSignal.aborted) throw new DownloadError('CANCELLED', 'İşlem iptal edildi.', 499);
      const media = {
        id: randomUUID(), filename: prepare ? `${parse(artifact.filename).name || 'video'}.mp4` : artifact.filename,
        filePath, directory, metadata,
        voiceovers: new Map(),
        refs: 0, deleted: false, touched: Date.now(),
      };
      mediaItems.set(media.id, media);
      retained = true;
      return publicMedia(media);
    } finally {
      try {
        try {
          await artifact?.cleanup();
        } finally {
          if (!retained) await removeDirectory(directory);
        }
      } finally {
        imports.delete(task);
        finish();
      }
    }
  }

  function importMedia(value, { signal } = {}) {
    const platform = identifyPlatform(value);
    return importArtifact(
      (combinedSignal) => {
        // Validate before choosing transport; malformed recognized platform URLs
        // must not become generic HTTP downloads.
        const url = platform ? parsePlatformUrl(value).url : value;
        return (platform ? downloader : sourceImporter).download(url, { signal: combinedSignal });
      },
      { signal, prepare: platform !== 'instagram' },
    );
  }

  function uploadMedia(readable, { signal, filename, contentLength } = {}) {
    return importArtifact(
      (combinedSignal) => sourceImporter.upload(readable, { signal: combinedSignal, filename, contentLength }),
      { signal, prepare: true },
    );
  }

  async function uploadVoiceover(mediaId, readable, { signal, ...options } = {}) {
    checkRunning();
    const media = getMedia(mediaId);
    if (imports.size >= maxConcurrentImports) {
      throw new DownloadError('SERVER_BUSY', 'İki içe aktarma işlemi devam ediyor. Lütfen tamamlanmasını bekleyin.', 429);
    }
    const controller = new AbortController();
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let finish;
    const task = { controller, done: new Promise((resolve) => { finish = resolve; }) };
    imports.add(task);
    media.refs += 1;
    try {
      const voice = await voiceoverStore.upload(readable, { ...options, signal: combinedSignal });
      if (media.deleted || combinedSignal.aborted) {
        await voiceoverStore.delete(voice.id);
        if (media.deleted) throw notFound();
        throw new DownloadError('CANCELLED', 'Seslendirme yüklemesi iptal edildi.', 499);
      }
      media.voiceovers.set(voice.id, voice);
      return { id: voice.id, duration: voice.duration, url: `/api/media/${media.id}/voiceovers/${voice.id}/file` };
    } finally {
      try { await releaseMedia(media); } finally { imports.delete(task); finish(); }
    }
  }

  function voiceoverFile(mediaId, id) {
    const media = getMedia(mediaId);
    if (!media.voiceovers.has(id)) throw notFound();
    const reader = voiceoverStore.acquire(id);
    media.refs += 1;
    let released = false;
    return {
      filePath: reader.filePath, filename: media.voiceovers.get(id).filename, contentType: 'audio/mp4',
      release: async () => {
        if (released) return;
        released = true;
        try { await reader.release(); } finally { await releaseMedia(media); }
      },
    };
  }

  async function deleteVoiceover(mediaId, id) {
    const media = getMedia(mediaId);
    if (!media.voiceovers.has(id)) throw notFound();
    media.voiceovers.delete(id);
    await voiceoverStore.delete(id);
  }

  function mediaFile(id) {
    const media = getMedia(id);
    media.refs += 1;
    let released = false;
    return {
      filePath: media.filePath, filename: media.filename,
      release: async () => {
        if (released) return;
        released = true;
        await releaseMedia(media);
      },
    };
  }

  async function deleteMedia(id) {
    const media = getMedia(id);
    media.deleted = true;
    await cleanupMedia(media);
  }

  async function execute(job) {
    job.status = 'processing';
    try {
      await mkdir(tempRoot, { recursive: true });
      job.directory = await mkdtemp(join(tempRoot, 'insta-export-'));
      job.filePath = join(job.directory, `export.${job.spec.format}`);
      if (job.spec.text) {
        await copyFile(fontPath, join(job.directory, 'font.ttf'));
        await writeFile(join(job.directory, 'text.txt'), job.spec.text.value, 'utf8');
      }
      if (job.spec.clips || job.spec.voiceovers.length) {
        // Keep large timelines out of the Windows command-line length limit.
        await writeFile(join(job.directory, 'timeline.ffgraph'), exportFilterGraph(job.spec), 'utf8');
      }
      await runProcess(ffmpeg, exportArguments(job.media.filePath, job.spec, job.voices), {
        cwd: job.directory, signal: job.controller.signal, outputPath: job.filePath,
        duration: job.spec.duration, maxBytes: maxExportBytes, timeoutMs: exportTimeoutMs,
        onProgress: (progress) => { job.progress = Math.max(job.progress, progress); },
      });
      if (job.controller.signal.aborted) throw new DownloadError('CANCELLED', 'Dışa aktarma iptal edildi.', 499);
      const file = await stat(job.filePath);
      if (file.size > maxExportBytes) throw new DownloadError('EXPORT_TOO_LARGE', 'Çıktı sunucuda tanımlanan boyut sınırını aşıyor.', 413);
      if (file.size === 0) throw new DownloadError('VIDEO_PROCESS_FAILED', 'Dışa aktarılan video boş.');
      job.progress = 100;
      job.status = 'completed';
    } catch (error) {
      job.status = job.controller.signal.aborted || error.code === 'CANCELLED' ? 'cancelled' : 'failed';
      if (job.status === 'failed') {
        job.error = error instanceof DownloadError
          ? { code: error.code, message: error.message }
          : { code: 'EXPORT_FAILED', message: 'Video dışa aktarılamadı. Lütfen tekrar deneyin.' };
        if (!(error instanceof DownloadError)) logger.error('Video export failed:', error);
      }
      await removeDirectory(job.directory);
      job.directory = undefined;
    } finally {
      job.touched = Date.now();
      try {
        await releaseSource(job);
      } finally {
        job.finish();
      }
    }
  }

  async function pump() {
    if (running || stopping) return;
    running = true;
    try {
      while (queue.length && !stopping) {
        const job = queue.shift();
        if (job.status === 'queued') await execute(job);
      }
    } finally {
      running = false;
    }
  }

  function createExport(body) {
    checkRunning();
    const media = getMedia(body?.mediaId);
    const spec = normalizeEdit(body, media.metadata, media.voiceovers);
    const pending = [...jobs.values()].filter((job) => ['queued', 'processing'].includes(job.status)).length;
    if (pending >= 3) throw new DownloadError('SERVER_BUSY', 'Bir video işleniyor ve iki video sırada. Lütfen bekleyin.', 429);
    if (jobs.size >= maxExports) throw new DownloadError('EXPORT_LIMIT', 'Sunucunun çıktı saklama sınırına ulaşıldı. Önceki çıktıları kaldırın.', 429);
    const voices = [];
    try {
      for (const voice of spec.voiceovers) voices.push(voiceoverStore.acquire(voice.id));
    } catch (error) {
      void Promise.all(voices.map((voice) => voice.release())).catch((releaseError) => logger.error('Voiceover release failed:', releaseError));
      throw error;
    }
    const job = {
      id: randomUUID(), media, spec, status: 'queued', progress: 0, refs: 0,
      voices,
      controller: new AbortController(), touched: Date.now(), deleted: false,
    };
    job.done = new Promise((resolve) => { job.finish = resolve; });
    media.refs += 1;
    jobs.set(job.id, job);
    queue.push(job);
    queueMicrotask(() => { void pump().catch((error) => logger.error('Export queue failed:', error)); });
    return publicJob(job);
  }

  function exportStatus(id) { return publicJob(getJob(id)); }

  function exportFile(id) {
    const job = getJob(id);
    if (job.status !== 'completed') throw new DownloadError('EXPORT_NOT_READY', 'Video henüz hazır değil.', 409);
    job.refs += 1;
    let released = false;
    return {
      filePath: job.filePath, filename: job.spec.filename,
      contentType: job.spec.format === 'mov' ? 'video/quicktime' : 'video/mp4',
      release: async () => {
        if (released) return;
        released = true;
        job.refs -= 1;
        await cleanupJob(job);
      },
    };
  }

  async function deleteExport(id) {
    const job = getJob(id);
    job.deleted = true;
    job.controller.abort();
    if (job.status === 'queued') {
      job.status = 'cancelled';
      await releaseSource(job);
      job.finish();
    }
    await job.done;
    await cleanupJob(job);
  }

  async function expire() {
    const cutoff = Date.now() - ttlMs;
    for (const job of [...jobs.values()]) {
      if (!job.deleted && job.touched < cutoff && !['queued', 'processing'].includes(job.status)) {
        await deleteExport(job.id);
      }
    }
    for (const media of [...mediaItems.values()]) {
      if (!media.deleted && media.refs === 0 && media.touched < cutoff) await deleteMedia(media.id);
    }
  }
  const timer = setInterval(() => {
    void expire().catch((error) => logger.error('Editor cleanup failed:', error));
  }, cleanupIntervalMs);
  timer.unref();

  async function shutdown() {
    stopping = true;
    clearInterval(timer);
    for (const task of imports) task.controller.abort();
    await Promise.all([...jobs.values()].filter((job) => !job.deleted).map((job) => deleteExport(job.id)));
    await Promise.all([...imports].map((task) => task.done));
    await Promise.all([...mediaItems.values()].filter((media) => !media.deleted).map((media) => deleteMedia(media.id)));
    await voiceoverStore.shutdown();
  }

  return {
    importMedia, uploadMedia, mediaFile, deleteMedia, createExport, exportStatus, exportFile,
    uploadVoiceover, voiceoverFile, deleteVoiceover,
    deleteExport, expire, shutdown,
  };
}
