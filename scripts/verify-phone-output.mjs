// Verify real exported files without browser automation or external services.
// Usage: node scripts/verify-phone-output.mjs .tools/phone-test-VIDEO_ID [--only-parts|--only-timeline]
// The directory must contain manifest.json, sourceFile and its declared outputs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';

const arguments_ = process.argv.slice(2);
const flags = arguments_.filter((argument) => argument.startsWith('--'));
assert.ok(flags.length <= 1 && flags.every((flag) => ['--only-parts', '--only-timeline'].includes(flag)),
  'Use either --only-parts or --only-timeline, or omit both to verify every output.');
const mode = flags[0]?.slice('--only-'.length) ?? 'all';
const directory = resolve(arguments_.find((argument) => !argument.startsWith('--')) || '.tools/phone-test-3pCGU3bIPEc');
const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
assert.ok(Array.isArray(manifest.outputs), 'Manifest outputs must be an array.');
const isPart = (output) => /part[-_]?0?[1-4]/i.test(output.file);
const selectedOutputs = manifest.outputs.filter((output) =>
  mode === 'all' || (mode === 'parts' ? isPart(output) : !isPart(output)));
const report = {
  checkedAt: new Date().toISOString(),
  manifest: join(directory, 'manifest.json'),
  mode,
  source: {},
  outputs: [],
  failures: [],
};
const fileInDirectory = (name) => {
  assert.equal(typeof name, 'string', 'Manifest file names must be strings.');
  const file = resolve(directory, name);
  const relativePath = relative(directory, file);
  assert.ok(!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`),
    `Artifact file escapes its directory: ${name}`);
  return file;
};
const run = (executable, args, { binary = false } = {}) => new Promise((resolveRun, rejectRun) => {
  const child = spawn(executable, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  let stderr = '';
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-16_384); });
  child.once('error', rejectRun);
  child.once('close', (code) => {
    if (code !== 0) {
      rejectRun(new Error(`${executable} exited ${code}: ${stderr}`));
    } else {
      resolveRun({ stdout: binary ? Buffer.concat(stdout) : Buffer.concat(stdout).toString(), stderr });
    }
  });
});
const probe = async (file) => JSON.parse((await run(ffprobe.path, [
  '-v', 'error', '-show_streams', '-show_format', '-of', 'json', file,
])).stdout);
const rate = (value) => {
  const [numerator, denominator = 1] = String(value).split('/').map(Number);
  return numerator / denominator;
};
const summarize = (info) => {
  const video = info.streams.find((stream) => stream.codec_type === 'video');
  const audio = info.streams.find((stream) => stream.codec_type === 'audio');
  assert.ok(video, 'Video stream missing.');
  return {
    width: video.width,
    height: video.height,
    fps: rate(video.avg_frame_rate),
    videoCodec: video.codec_name,
    pixelFormat: video.pix_fmt,
    duration: Number(info.format.duration),
    videoDuration: Number(video.duration ?? info.format.duration),
    audioCodec: audio?.codec_name ?? null,
    audioSampleRate: audio ? Number(audio.sample_rate) : null,
    audioDuration: audio ? Number(audio.duration ?? info.format.duration) : null,
    frameCount: video.nb_frames ? Number(video.nb_frames) : null,
    displayAspectRatio: video.display_aspect_ratio,
    sampleAspectRatio: video.sample_aspect_ratio,
  };
};
const inspect = (name, action) => {
  try {
    action();
    return { name, passed: true };
  } catch (error) {
    report.failures.push({ name, message: error.message });
    return { name, passed: false, message: error.message };
  }
};
const meanAbsoluteError = (left, right) => {
  assert.equal(left.length, right.length, 'Comparison frames must have equal pixel counts.');
  let sum = 0;
  for (let i = 0; i < left.length; i += 1) sum += Math.abs(left[i] - right[i]);
  return sum / left.length;
};
const signature = async (file, time, crop) => {
  const filters = [
    ...(crop ? [`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`] : []),
    'scale=54:96:flags=area',
    'format=rgb24',
  ];
  const { stdout } = await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', String(Math.max(0, time)),
    '-i', file, '-map', '0:v:0', '-frames:v', '1', '-vf', filters.join(','),
    '-threads', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
  ], { binary: true });
  assert.equal(stdout.length, 54 * 96 * 3, `Cannot extract signature at ${time}s from ${file}.`);
  return stdout;
};
const sourceFile = fileInDirectory(manifest.sourceFile ?? manifest.source?.file ?? 'source.mp4');
report.source = { file: sourceFile, ...summarize(await probe(sourceFile)) };
const frameDuration = 1 / report.source.fps;
const sourceSignatures = new Map();
const getSourceSignature = (time, crop) => {
  const safeTime = Math.max(0, Math.min(time, report.source.videoDuration - frameDuration));
  const key = `${safeTime.toFixed(6)}:${JSON.stringify(crop)}`;
  if (!sourceSignatures.has(key)) sourceSignatures.set(key, signature(sourceFile, safeTime, crop));
  return sourceSignatures.get(key);
};
assert.ok(selectedOutputs.length > 0, `No output files selected for ${mode}.`);
if (mode === 'parts') assert.equal(selectedOutputs.length, 4, 'All four parts must be ready before verification.');
for (const output of selectedOutputs) {
  const file = fileInDirectory(output.file);
  const result = { file: output.file, checks: [] };
  report.outputs.push(result);
  console.log(`Verifying ${output.file}`);
  try {
    result.bytes = (await stat(file)).size;
    result.metadata = summarize(await probe(file));
    const actual = result.metadata;
    const expectedFps = output.expectedFps ?? output.fps ?? report.source.fps;
    const hasAudio = output.hasAudio ?? manifest.source?.hasAudio ?? Boolean(report.source.audioCodec);
    const tolerance = 1 / expectedFps + (hasAudio ? 1024 / (actual.audioSampleRate || 48000) : 0) + 0.002;
    result.expectedDuration = output.expectedDuration;
    result.durationTolerance = tolerance;
    result.checks.push(inspect(`${output.file}: codec and dimensions`, () => {
      assert.equal(actual.videoCodec, 'h264');
      assert.equal(actual.pixelFormat, 'yuv420p');
      assert.equal(actual.width, output.expectedWidth ?? 1080);
      assert.equal(actual.height, output.expectedHeight ?? 1920);
      assert.equal(actual.sampleAspectRatio, '1:1');
      assert.ok(Math.abs(actual.fps - expectedFps) <= 0.001,
        `Expected ${expectedFps}fps; received ${actual.fps}.`);
      if (hasAudio) assert.equal(actual.audioCodec, 'aac');
      else assert.equal(actual.audioCodec, null);
    }));
    result.checks.push(inspect(`${output.file}: duration`, () => {
      assert.ok(Number.isFinite(output.expectedDuration) && output.expectedDuration > 0);
      assert.ok(Math.abs(actual.duration - output.expectedDuration) <= tolerance,
        `Expected ${output.expectedDuration}s; received ${actual.duration}s (tolerance ${tolerance}s).`);
      assert.ok(Math.abs(actual.videoDuration - output.expectedDuration) <= 1 / expectedFps + 0.002,
        `Video stream duration ${actual.videoDuration}s differs from ${output.expectedDuration}s.`);
      if (hasAudio) assert.ok(Math.abs(actual.audioDuration - output.expectedDuration) <= tolerance,
        `Audio stream duration ${actual.audioDuration}s differs from ${output.expectedDuration}s.`);
    }));
    result.requestedDimensions = {
      width: output.requestedWidth ?? 1080,
      height: output.requestedHeight ?? 1920,
      exact: actual.width === (output.requestedWidth ?? 1080) && actual.height === (output.requestedHeight ?? 1920),
      aspectRatioError: Math.abs(actual.width / actual.height - 9 / 16),
    };
    const decode = await run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-xerror', '-nostdin', '-threads', '2',
      '-i', file, '-map', '0:v:0', '-map', '0:a:0?', '-f', 'null', '-',
    ]);
    result.checks.push(inspect(`${output.file}: full decode`, () => {
      assert.equal(decode.stderr.trim(), '', `Decoder reported errors: ${decode.stderr}`);
    }));
    const segments = output.segments ?? output.clips;
    const crop = output.crop;
    if (Array.isArray(segments) && segments.length && crop) {
      const samples = [];
      let timelineStart = 0;
      for (const segment of segments) {
        const speed = segment.speed ?? 1;
        const duration = segment.gapDuration ?? segment.freezeDuration ?? (segment.end - segment.start) / speed;
        if (segment.gapDuration) { timelineStart += duration; continue; }
        // Check both sides of every boundary without sampling the exact seam.
        const offset = Math.min(0.2, duration / 4);
        for (const localTime of [offset, duration - offset]) {
          const outputTime = timelineStart + localTime;
          const sourceTime = segment.freezeDuration ? segment.start : segment.reverse
            ? segment.end - frameDuration - localTime * speed
            : segment.start + localTime * speed;
          const rendered = await signature(file, outputTime);
          const candidates = await Promise.all([-2, -1, 0, 1, 2].map(async (delta) => ({
            sourceTime: sourceTime + delta * frameDuration,
            error: meanAbsoluteError(rendered, await getSourceSignature(sourceTime + delta * frameDuration, crop)),
          })));
          const best = candidates.reduce((left, right) => left.error < right.error ? left : right);
          samples.push({ outputTime, expectedSourceTime: sourceTime, matchedSourceTime: best.sourceTime,
            meanAbsoluteRgbError: best.error });
        }
        timelineStart += duration;
      }
      result.frameComparisons = samples;
      const threshold = output.maxMeanAbsoluteRgbError ?? 15;
      result.checks.push(inspect(`${output.file}: source-frame correspondence`, () => {
        assert.ok(samples.length > 0);
        for (const sample of samples) assert.ok(sample.meanAbsoluteRgbError < threshold,
          `At output ${sample.outputTime}s, RGB error ${sample.meanAbsoluteRgbError.toFixed(2)} exceeds ${threshold}.`);
      }));
    } else {
      result.frameComparisons = { skipped: 'Manifest does not contain source segments and an integer-pixel crop.' };
    }
  } catch (error) {
    result.error = error.message;
    report.failures.push({ name: output.file, message: error.message });
  }
}

const parts = selectedOutputs.filter(isPart);
if (parts.length === 4 && parts.every((part) => !report.outputs.find((output) => output.file === part.file)?.error)) {
  try {
    const images = [];
    for (const [index, part] of parts.entries()) {
      const imageFile = join(directory, `contact-part-${index + 1}.png`);
      await run(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-ss', String(part.expectedDuration / 2), '-i', fileInDirectory(part.file),
        '-frames:v', '1', '-vf', 'scale=216:384:force_original_aspect_ratio=decrease,pad=216:384:(ow-iw)/2:(oh-ih)/2',
        '-threads', '1', '-update', '1', imageFile,
      ]);
      images.push(imageFile);
    }
    report.contactSheet = join(directory, 'phone-contact-sheet.png');
    await run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      ...images.flatMap((file) => ['-i', file]),
      '-filter_complex', '[0:v][1:v][2:v][3:v]hstack=inputs=4[contact]',
      '-map', '[contact]', '-frames:v', '1', '-threads', '1', '-update', '1', report.contactSheet,
    ]);
  } catch (error) {
    report.failures.push({ name: 'contact sheet', message: error.message });
  }
}
report.passed = report.failures.length === 0;
report.script = relative(dirname(fileURLToPath(import.meta.url)), fileURLToPath(import.meta.url));
const reportFile = join(directory, mode === 'all' ? 'verification.json' : `verification-${mode}.json`);
await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ passed: report.passed, outputs: report.outputs.length,
  failures: report.failures, reportFile, contactSheet: report.contactSheet }, null, 2));
if (!report.passed) process.exitCode = 1;
