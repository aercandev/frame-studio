// Run after saving a real /api/media import as source.json + source.mp4.
// DOM events use the application's actual handlers; decoding/layout is mocked
// there. Import, export, progress polling and output downloads use the live API.
import assert from 'node:assert/strict';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { exercisePhoneWorkflow } from '../apps/web/test/helpers/phone-workflow.js';
import { normalizeEdit } from '../apps/api/src/edit-spec.js';

const directory = resolve(process.argv[2] || '.tools/phone-test-3pCGU3bIPEc');
const base = process.env.TEST_API_URL || 'http://127.0.0.1:3001';
const imported = JSON.parse(await readFile(join(directory, 'source.json'), 'utf8'));
const sourcePath = join(directory, 'source.mp4');
const manifestPath = join(directory, 'manifest.json');
const manifest = {
  sourceFile: 'source.mp4', source: imported, outputs: [],
  testScope: 'Actual DOM handlers with mocked decoding/layout; real API download/import/export; external output validation.',
};
async function json(path, options) {
  const response = await fetch(new URL(path, base), options);
  const body = await response.json();
  assert.ok(response.ok, `${response.status} ${JSON.stringify(body)}`);
  return body;
}
let media;
// A server restart invalidates temporary media IDs. Reuse a live session when
// possible; otherwise upload the saved real source without another download.
let candidate = imported;
try { candidate = JSON.parse(await readFile(join(directory, 'active-media.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const existing = await fetch(new URL(candidate.url, base), { headers: { Range: 'bytes=0-0' } });
await existing.arrayBuffer();
if (existing.status === 206) media = candidate;
else {
  console.log('Reimporting saved real video into the current API session…');
  media = await json('/api/media/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String((await stat(sourcePath)).size),
      'X-File-Name': encodeURIComponent(imported.filename),
    },
    body: createReadStream(sourcePath), duplex: 'half',
  });
  await writeFile(join(directory, 'active-media.json'), JSON.stringify(media, null, 2));
}
console.log(`Media ready: ${media.duration}s, ${media.width}×${media.height}, ${media.fps}fps`);
const cleanup = [];
let workflow;
try {
  workflow = await exercisePhoneWorkflow({ after(fn) { cleanup.push(fn); } }, media);
} finally {
  for (const dispose of cleanup.reverse()) dispose();
}
manifest.payload = workflow.payload;
manifest.checks = workflow.checks;
manifest.boundaries = workflow.boundaries;
await writeFile(join(directory, 'timeline-workflow.json'), JSON.stringify(workflow, null, 2));
console.log(`DOM timeline checks passed: ${workflow.checks.length}; cuts: ${workflow.boundaries.join(', ')}`);
const tasks = [
  ...workflow.payload.clips.map((clip, index) => ({
    file: `part-${String(index + 1).padStart(2, '0')}-phone.mp4`,
    label: `Parça ${index + 1}`, clips: [clip],
  })),
  { file: 'timeline-phone.mp4', label: 'Dört klipli timeline', clips: workflow.payload.clips },
];
for (const task of tasks) {
  const payload = {
    ...workflow.payload, clips: task.clips,
    output: { ...workflow.payload.output, name: task.file.replace(/\.mp4$/, '') },
  };
  const spec = normalizeEdit(payload, media);
  assert.deepEqual([spec.width, spec.height], [1080, 1920]);
  let job = await json('/api/exports', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  console.log(`${task.label}: queued ${job.id}, expected ${spec.duration}s at ${job.width}×${job.height}`);
  assert.deepEqual([job.width, job.height], [1080, 1920], 'Running API must include the phone-aspect fix');
  let lastProgress = -1;
  while (job.status === 'queued' || job.status === 'processing') {
    await new Promise((done) => setTimeout(done, 1000));
    job = await json(`/api/exports/${job.id}`);
    const progress = Math.floor(job.progress / 10) * 10;
    if (progress !== lastProgress) { console.log(`${task.label}: ${job.status} ${job.progress}%`); lastProgress = progress; }
  }
  assert.equal(job.status, 'completed', JSON.stringify(job));
  const response = await fetch(new URL(job.downloadUrl, base));
  assert.equal(response.status, 200);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(join(directory, task.file)));
  manifest.outputs.push({
    file: task.file, label: task.label, expectedDuration: spec.duration, expectedFps: spec.fps,
    expectedWidth: spec.width, expectedHeight: spec.height, requestedWidth: 1080, requestedHeight: 1920,
    hasAudio: media.hasAudio, segments: task.clips, crop: spec.crop,
    bytes: (await stat(join(directory, task.file))).size, apiJobId: job.id,
  });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`${task.label}: saved ${task.file}`);
  await fetch(new URL(`/api/exports/${job.id}`, base), { method: 'DELETE' });
}
console.log(`Completed ${manifest.outputs.length} real exports. Manifest: ${manifestPath}`);
