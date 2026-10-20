import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { DownloadError } from './errors.js';
import { terminateProcessTree } from './process-tree.js';

export const defaultFfmpeg = () => process.env.FFMPEG_PATH ? resolve(process.env.FFMPEG_PATH) : ffmpegStatic;
export const defaultFfprobe = () => process.env.FFPROBE_PATH ? resolve(process.env.FFPROBE_PATH) : ffprobeStatic.path;

// Only standalone video containers may be opened. In particular, uploaded HLS,
// concat lists and image sequences cannot trigger secondary file/network reads.
// MOV's external-track options (enable_drefs/use_absolute_path) stay disabled.
export const safeVideoInputArguments = () => [
  '-protocol_whitelist', 'file',
  '-format_whitelist', 'mov,matroska,webm,avi',
];

export function prepareVideoArguments(sourcePath, outputPath, metadata) {
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    ...safeVideoInputArguments(), '-i', sourcePath,
    '-map', '0:V:0', '-map', '0:a:0?', '-sn', '-dn',
    '-vf', `scale=${metadata.width}:${metadata.height},setsar=1`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-threads', '2',
    '-c:a', 'aac', '-b:a', '192k',
    '-map_metadata', '-1', '-map_chapters', '-1',
    '-movflags', '+faststart', '-f', 'mp4', outputPath,
  ];
}

// Both tools have an owned process group; all exits settle only after pipe closure.
export function runVideoProcess(executable, args, {
  cwd, signal, timeoutMs = 0, outputPath, maxBytes = Infinity,
  onProgress, duration, spawnProcess = spawn, terminateProcess = terminateProcessTree,
} = {}) {
  return new Promise((resolveRun, rejectRun) => {
    if (signal?.aborted) return rejectRun(new DownloadError('CANCELLED', 'İşlem iptal edildi.', 499));
    let child;
    try {
      child = spawnProcess(executable, args, {
        shell: false, windowsHide: true, detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'], cwd,
      });
    } catch {
      rejectRun(new DownloadError('VIDEO_TOOL_UNAVAILABLE', 'FFmpeg veya FFprobe başlatılamadı. Sunucu kurulumunu kontrol edin.', 503));
      return;
    }
    let stdout = '';
    let stderr = '';
    let progressBuffer = '';
    let failure;
    let settled = false;
    let checking = false;
    const stop = (error) => {
      if (settled || failure) return;
      failure = error;
      void terminateProcess(child);
    };
    const abort = () => stop(new DownloadError('CANCELLED', 'İşlem iptal edildi.', 499));
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? setTimeout(() => stop(new DownloadError(
      'EXPORT_TIMEOUT', 'Video işlemi zaman aşımına uğradı.', 504,
    )), timeoutMs) : undefined;
    const timer = outputPath && Number.isFinite(maxBytes) ? setInterval(async () => {
      if (settled || checking || failure) return;
      checking = true;
      try {
        if ((await stat(outputPath)).size > maxBytes) {
          stop(new DownloadError('EXPORT_TOO_LARGE', 'Çıktı yapılandırılmış video boyutu sınırını aşıyor.', 413));
        }
      } catch (error) {
        if (error.code !== 'ENOENT') stop(error);
      } finally {
        checking = false;
      }
    }, 250) : undefined;
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk.toString()).slice(-128_000);
      if (!onProgress) return;
      progressBuffer += chunk.toString();
      const lines = progressBuffer.split(/\r?\n/);
      progressBuffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('out_time_us=')) {
          const seconds = Number(line.slice(12)) / 1_000_000;
          if (Number.isFinite(seconds) && duration > 0) onProgress(Math.min(99, Math.max(0, seconds / duration * 100)));
        }
      }
    });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-16_000); });
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(timer);
      signal?.removeEventListener('abort', abort);
      if (error) rejectRun(error);
      else resolveRun({ stdout, stderr });
    };
    child.once('error', () => finish(failure || new DownloadError(
      'VIDEO_TOOL_UNAVAILABLE', 'FFmpeg veya FFprobe bulunamadı. Sunucu kurulumunu kontrol edin.', 503,
    )));
    child.once('close', (code) => finish(failure || (code === 0 ? null : new DownloadError(
      'VIDEO_PROCESS_FAILED', 'Video işlenemedi. Video biçimini ve düzenleme ayarlarını kontrol edin.', 422,
    ))));
    if (signal?.aborted) abort();
  });
}

export async function probeVideo(filePath, { executable = defaultFfprobe(), signal, squarePixels = false, ...options } = {}) {
  const { stdout } = await runVideoProcess(executable, [
    '-v', 'error', ...safeVideoInputArguments(),
    '-show_streams', '-show_format', '-of', 'json', filePath,
  ], { ...options, signal, timeoutMs: 20_000 });
  let data;
  try { data = JSON.parse(stdout); } catch {
    throw new DownloadError('INVALID_VIDEO', 'Video bilgileri okunamadı.');
  }
  const video = data.streams?.find((stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1);
  const duration = Number(video?.duration || data.format?.duration);
  const rate = String(video?.avg_frame_rate || video?.r_frame_rate || '30/1').split('/').map(Number);
  const fps = rate[1] ? rate[0] / rate[1] : rate[0];
  const rotation = Number(video?.side_data_list?.find((item) => item.rotation !== undefined)?.rotation || video?.tags?.rotate || 0);
  const rotated = Math.abs(rotation % 180) === 90;
  const sourceWidth = Number(video?.width);
  const sourceHeight = Number(video?.height);
  let width = sourceWidth;
  let height = sourceHeight;
  if (squarePixels) {
    const [numerator, denominator] = String(video?.sample_aspect_ratio || '1:1').split(':').map(Number);
    const ratio = numerator > 0 && denominator > 0 && Number.isFinite(numerator / denominator)
      ? numerator / denominator : 1;
    // Preserve display aspect without expanding a source axis. This also bounds
    // unusual sample-aspect ratios before the decoder allocates output frames.
    width = Math.floor(sourceWidth * Math.min(ratio, 1) / 2) * 2;
    height = Math.floor(sourceHeight / Math.max(ratio, 1) / 2) * 2;
  }
  if (rotated) [width, height] = [height, width];
  if (!video || !Number.isFinite(duration) || duration <= 0 ||
      !Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) ||
      sourceWidth < 2 || sourceHeight < 2 ||
      !Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 ||
      !Number.isFinite(fps) || fps <= 0) {
    throw new DownloadError('INVALID_VIDEO', 'Video süresi, boyutları veya kare hızı geçerli değil.');
  }
  return { duration, width, height, fps, hasAudio: data.streams.some((stream) => stream.codec_type === 'audio') };
}
