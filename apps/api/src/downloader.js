import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cancelledError, DownloadError, tooLargeError, unavailableError } from './errors.js';
import { parsePlatformUrl } from './platform-url.js';
import { terminateProcessTree } from './process-tree.js';
import { defaultFfmpeg } from './video-tools.js';

export const MAX_DOWNLOAD_BYTES = Infinity;
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

export function defaultExecutable() {
  return process.env.YT_DLP_PATH
    ? resolve(process.env.YT_DLP_PATH)
    : join(repositoryRoot, '.tools', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
}

function mapProcessError(output, platform = 'instagram') {
  const label = { instagram: 'Instagram', youtube: 'YouTube', x: 'X' }[platform];
  const prefix = platform.toUpperCase();
  if (/max-filesize|larger than.*(?:max|size)|file.*too large/i.test(output)) {
    return tooLargeError();
  }
  if (/429|too many requests|rate.?limit/i.test(output)) {
    return new DownloadError(
      `${prefix}_RATE_LIMIT`,
      `${label} şu anda çok fazla istek alıyor. Bir süre sonra tekrar deneyin.`,
      503,
    );
  }
  if (/does not pass filter|does not match filter/i.test(output)) {
    return new DownloadError('UNSUPPORTED_VIDEO', 'Devam eden canlı yayınlar desteklenmez. Tamamlanmış bir video seçin.', 422);
  }
  if (platform !== 'instagram' && /sign.?in|log.?in|authentication|cookies|private|age.?restrict|confirm.*(?:age|bot)/i.test(output)) {
    return new DownloadError(
      `${prefix}_AUTH_REQUIRED`,
      `${label} bu video için giriş veya doğrulama istiyor. Giriş gerektirmeyen herkese açık bir video seçin.`,
    );
  }
  if (/requested format.*not available|no video|does not contain.*video|only images/i.test(output)) {
    return new DownloadError(
      'VIDEO_NOT_FOUND',
      platform === 'instagram'
        ? 'Bu gönderide indirilebilir bir MP4 video bulunamadı. Çoklu gönderilerde yalnızca ilk öğe desteklenir.'
        : `${label} bağlantısında desteklenen indirilebilir bir video bulunamadı.`,
    );
  }
  return new DownloadError(
    platform === 'instagram' ? 'VIDEO_UNAVAILABLE' : `${prefix}_VIDEO_UNAVAILABLE`,
    `${label} videosu alınamadı. Video kaldırılmış, bölgenizde engellenmiş veya erişim kısıtlı olabilir. Herkese açık bağlantılar da bazen giriş gerektirebilir.`,
  );
}

async function directorySizes(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sizes = await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
    try {
      return (await stat(join(directory, entry.name))).size;
    } catch (error) {
      if (error.code === 'ENOENT') return 0;
      throw error;
    }
  }));
  return { total: sizes.reduce((total, size) => total + size, 0), largest: Math.max(0, ...sizes) };
}

export function createDownloader({
  executable = defaultExecutable(),
  spawnProcess = spawn,
  timeoutMs = 0,
  maxBytes = MAX_DOWNLOAD_BYTES,
  concurrency = 2,
  tempRoot = tmpdir(),
  sizeCheckIntervalMs = 200,
  terminateProcess = terminateProcessTree,
  ffmpeg = defaultFfmpeg(),
} = {}) {
  let active = 0;
  let shuttingDown = false;
  const downloads = new Set();

  async function health() {
    try {
      await access(executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      return { available: true };
    } catch {
      return { available: false };
    }
  }

  function runDownload(source, directory, signal) {
    return new Promise((resolveDownload, rejectDownload) => {
      const youtube = source.platform === 'youtube';
      const args = [
        '--ignore-config',
        '--no-plugin-dirs',
        '--no-playlist',
        '--playlist-items', '1',
        '--use-extractors', { instagram: 'Instagram', youtube: 'Youtube', x: 'Twitter' }[source.platform],
        '--no-cookies',
        '--no-cookies-from-browser',
        '--no-js-runtimes',
        '--js-runtimes', `node:${process.execPath}`,
        '--no-cache-dir',
        '--no-progress',
        '--no-colors',
        '--no-part',
        '--no-continue',
        '--no-mtime',
        '--fixup', 'never',
        '--hls-prefer-native',
        '--socket-timeout', '20',
        '--retries', '1',
        '--fragment-retries', '1',
        ...(Number.isFinite(maxBytes) ? ['--max-filesize', String(maxBytes)] : []),
        '--match-filter', '!is_live',
        ...(youtube ? [
          '--ffmpeg-location', ffmpeg,
          '--format', 'bv+ba/b',
          '--merge-output-format', 'mp4',
          '--remux-video', 'mp4',
        ] : ['--format', 'best[ext=mp4]/bestvideo[ext=mp4]']),
        '--output', join(directory, youtube ? 'video.%(ext)s' : 'video.mp4'),
        '--', source.url,
      ];
      let child;
      try {
        child = spawnProcess(executable, args, {
          shell: false,
          windowsHide: true,
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: directory,
        });
      } catch (error) {
        rejectDownload(['ENOENT', 'EACCES'].includes(error.code) ? unavailableError() : error);
        return;
      }

      let output = '';
      let failure;
      let settled = false;
      let checkingSize = false;
      const capture = (chunk) => {
        output = (output + chunk.toString()).slice(-32_768);
      };
      child.stdout.on('data', capture);
      child.stderr.on('data', capture);

      const stop = (error) => {
        if (settled || failure) return;
        failure = error;
        void terminateProcess(child);
      };
      const onAbort = () => stop(cancelledError());
      signal?.addEventListener('abort', onAbort, { once: true });
      const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? setTimeout(() => stop(new DownloadError(
        'DOWNLOAD_TIMEOUT',
        'İndirme zaman aşımına uğradı. Lütfen tekrar deneyin.',
        504,
      )), timeoutMs) : undefined;
      const sizeTimer = Number.isFinite(maxBytes) ? setInterval(async () => {
        if (checkingSize || settled || failure) return;
        checkingSize = true;
        try {
          const sizes = await directorySizes(directory);
          // DASH merging briefly keeps both source tracks and the output. Each
          // file and the final result still have the explicitly configured limit.
          if (sizes.largest > maxBytes || sizes.total > maxBytes * (youtube ? 2 : 1)) stop(tooLargeError());
        } catch (error) {
          if (error.code !== 'ENOENT') stop(error);
        } finally {
          checkingSize = false;
        }
      }, sizeCheckIntervalMs) : undefined;

      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearInterval(sizeTimer);
        signal?.removeEventListener('abort', onAbort);
        if (error) rejectDownload(error);
        else resolveDownload(output);
      };
      child.once('error', (error) => finish(
        failure || (['ENOENT', 'EACCES'].includes(error.code) ? unavailableError() : error),
      ));
      child.once('close', (code) => finish(failure || (code === 0 ? null : mapProcessError(output, source.platform))));
      if (signal?.aborted) onAbort();
    });
  }

  async function download(value, { signal } = {}) {
    const source = parsePlatformUrl(value);
    if (signal?.aborted) throw cancelledError();
    if (shuttingDown) {
      throw new DownloadError('SERVER_SHUTTING_DOWN', 'Sunucu kapanıyor. Lütfen tekrar deneyin.', 503);
    }
    if (active >= concurrency) {
      throw new DownloadError(
        'SERVER_BUSY',
        'Sunucu şu anda iki indirme işliyor. Biraz sonra tekrar deneyin.',
        429,
      );
    }
    active += 1;
    const controller = new AbortController();
    signal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let resolveDone;
    const task = {
      controller,
      ready: false,
      done: new Promise((resolve) => { resolveDone = resolve; }),
    };
    downloads.add(task);
    let directory;
    let cleanupPromise;
    const cleanup = () => {
      cleanupPromise ??= (async () => {
        try {
          if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        } finally {
          active -= 1;
          downloads.delete(task);
          resolveDone();
        }
      })();
      return cleanupPromise;
    };
    task.cleanup = cleanup;

    try {
      await mkdir(tempRoot, { recursive: true });
      directory = await mkdtemp(join(tempRoot, 'insta-download-'));
      if (signal?.aborted) throw cancelledError();
      const output = await runDownload(source, directory, signal);
      if (signal?.aborted) throw cancelledError();
      if (/max-filesize|larger than.*(?:max|size)/i.test(output)) throw tooLargeError();
      const filePath = join(directory, 'video.mp4');
      const file = await stat(filePath).catch((error) => {
        if (error.code === 'ENOENT') throw mapProcessError(output || 'no video', source.platform);
        throw error;
      });
      if (!file.isFile() || file.size === 0) throw mapProcessError('no video', source.platform);
      if (file.size > maxBytes) throw tooLargeError();
      if (signal.aborted) throw cancelledError();
      task.ready = true;
      return {
        filePath,
        filename: `${source.platform}-${source.id}.mp4`,
        size: file.size,
        cleanup,
      };
    } catch (error) {
      await cleanup();
      throw error;
    }
  }

  async function shutdown() {
    shuttingDown = true;
    const pending = [...downloads];
    for (const task of pending) task.controller.abort();
    await Promise.all(pending.map((task) => task.ready ? task.cleanup() : task.done));
  }

  return { download, health, shutdown };
}
