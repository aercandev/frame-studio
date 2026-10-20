import { rm, truncate, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const scenario = args[0];
const output = args[args.indexOf('--output') + 1].replace('%(ext)s', 'mp4');

if (scenario === 'success') {
  await writeFile(output, Buffer.from('fake mp4 contents'));
} else if (scenario === 'oversize') {
  await writeFile(output, Buffer.alloc(2048));
} else if (scenario === 'large-unlimited') {
  await writeFile(output, Buffer.from('fake mp4 contents'));
  await truncate(output, 100 * 1024 * 1024 + 1);
} else if (scenario === 'oversize-running') {
  await writeFile(output, Buffer.alloc(2048));
  setInterval(() => {}, 1000);
} else if (scenario === 'private') {
  console.error('ERROR: This content is private. Secret internal details.');
  process.exitCode = 1;
} else if (scenario === 'rate-limit') {
  console.error('ERROR: HTTP Error 429: Too Many Requests');
  process.exitCode = 1;
} else if (scenario === 'auth') {
  console.error('ERROR: Sign in to confirm you are not a bot. Secret token details.');
  process.exitCode = 1;
} else if (scenario === 'filtered') {
  console.log('[download] Movie does not pass filter (!is_live), skipping');
} else if (scenario === 'merging') {
  const video = join(dirname(output), 'video.f137.mp4');
  const audio = join(dirname(output), 'video.f140.m4a');
  await writeFile(video, Buffer.alloc(600));
  await writeFile(audio, Buffer.alloc(100));
  await writeFile(output, Buffer.alloc(800));
  await new Promise((resolve) => setTimeout(resolve, 80));
  await rm(video);
  await rm(audio);
} else if (scenario === 'oversize-aggregate') {
  await writeFile(join(dirname(output), 'video.f137.mp4'), Buffer.alloc(800));
  await writeFile(join(dirname(output), 'video.f140.m4a'), Buffer.alloc(800));
  await writeFile(output, Buffer.alloc(800));
  setInterval(() => {}, 1000);
} else if (scenario === 'max-filesize') {
  console.log('[download] File is larger than max-filesize; skipping');
} else if (scenario === 'hang') {
  await writeFile(output, Buffer.from('partial'));
  setInterval(() => {}, 1000);
} else if (scenario !== 'empty') {
  throw new Error('Unknown fake-downloader scenario.');
}
