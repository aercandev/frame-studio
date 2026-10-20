import assert from 'node:assert/strict';
import test from 'node:test';
import { exercisePhoneWorkflow } from './helpers/phone-workflow.js';

test('YouTube phone workflow exercises timeline tools and exports four frame-aligned source quarters', async (t) => {
  const media = {
    id: 'landscape-phone-fixture',
    url: '/api/media/landscape-phone-fixture/file',
    filename: 'youtube-3pCGU3bIPEc.mp4',
    duration: 40.04, width: 1920, height: 1080, fps: 30000 / 1001, hasAudio: true,
  };
  const result = await exercisePhoneWorkflow(t, media);
  assert.equal(result.checks.length, 13);
  assert.ok(result.checks.every((check) => check.status === 'passed'));
  for (const boundary of result.boundaries.slice(1, -1)) {
    assert.ok(Math.abs(boundary * media.fps - Math.round(boundary * media.fps)) < 1e-8);
  }
  assert.ok(Math.abs(result.payload.clips.reduce((sum, clip) => sum + clip.end - clip.start, 0) - media.duration) < 1e-8);
  assert.deepEqual(result.payload.voiceovers, []);
});

test('the supplied 992-second YouTube video supports the same phone workflow at fit zoom', async (t) => {
  // Metadata measured from the user's downloaded video. This regression remains
  // deterministic and offline; the live API smoke run verifies the actual file.
  const result = await exercisePhoneWorkflow(t, {
    id: 'youtube-3pCGU3bIPEc',
    url: '/api/media/youtube-3pCGU3bIPEc/file',
    filename: 'youtube-3pCGU3bIPEc.mp4',
    duration: 992, width: 1920, height: 1080, fps: 25, hasAudio: true,
  });
  assert.deepEqual(result.boundaries, [0, 248, 496, 744, 992]);
  assert.equal(result.payload.clips.length, 4);
  assert.equal(result.payload.text, null);
  assert.equal(result.checks.length, 13);
});
