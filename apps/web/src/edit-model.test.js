import assert from 'node:assert/strict';
import test from 'node:test';
import { cropForRatio, normalizeCrop, normalizeTrim, normalizeTextTiming, outputDimensions, formatTime } from './edit-model.js';

test('portrait crop of landscape source is centered with chosen ratio', () => {
  const crop = cropForRatio(1920, 1080, 9 / 16);
  assert.equal(crop.height, 1);
  assert.equal(crop.x, (1 - crop.width) / 2);
  assert.equal(1920 * crop.width / (1080 * crop.height), 9 / 16);
});
test('landscape crop of portrait source remains within original frame', () => {
  const crop = cropForRatio(1080, 1920, 16 / 9);
  assert.equal(crop.width, 1);
  assert.equal(crop.y, (1 - crop.height) / 2);
  assert.equal(1080 * crop.width / (1920 * crop.height), 16 / 9);
});
test('dragging beyond source edges clamps position without changing size', () => {
  assert.deepEqual(normalizeCrop({ x: 0.9, y: -0.2, width: 0.4, height: 0.6 }), { x: 0.6, y: 0, width: 0.4, height: 0.6 });
});
test('trim keeps a positive interval within source, including explicit zero', () => {
  assert.deepEqual(normalizeTrim({ start: 9.9, end: 1 }, 10), { start: 9.9, end: 10 });
  assert.deepEqual(normalizeTrim({ start: -3, end: 20 }, 10), { start: 0, end: 10 });
  assert.deepEqual(normalizeTrim({ start: 0, end: 0 }, 10), { start: 0, end: 0.1 });
});
test('text timing follows shortened clip and treats zero as zero', () => {
  assert.deepEqual(normalizeTextTiming({ start: 7, end: 10 }, 3), { start: 2.9, end: 3 });
  assert.deepEqual(normalizeTextTiming({ start: 0, end: 0 }, 3), { start: 0, end: 0.1 });
});
test('output preset handles portrait, square, native crop and upscaling', () => {
  const full = { x: 0, y: 0, width: 1, height: 1 };
  assert.deepEqual(outputDimensions({ width: 720, height: 1280 }, full, '1080'), { width: 1080, height: 1920 });
  assert.deepEqual(outputDimensions({ width: 800, height: 800 }, full, '1080'), { width: 1080, height: 1080 });
  assert.deepEqual(outputDimensions({ width: 1000, height: 750 }, full, '1080'), { width: 1440, height: 1080 });
  assert.deepEqual(outputDimensions({ width: 720, height: 1280 }, { ...full, width: 0.8, height: 0.8 }, 'source'), { width: 576, height: 1024 });
});
test('ratio presets retain exact phone and landscape output despite fractional source crop pixels', () => {
  for (const [resolution, short, long] of [['720', 720, 1280], ['1080', 1080, 1920], ['2160', 2160, 3840]]) {
    for (const media of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }, { width: 639, height: 359 }]) {
      assert.deepEqual(outputDimensions(media, cropForRatio(media.width, media.height, 9 / 16), resolution), {
        width: short, height: long,
      });
      assert.deepEqual(outputDimensions(media, cropForRatio(media.width, media.height, 16 / 9), resolution), {
        width: long, height: short,
      });
    }
  }
  const media = { width: 1920, height: 1080 };
  assert.deepEqual(outputDimensions(media, cropForRatio(media.width, media.height, 9 / 16), 'source'), {
    width: 606, height: 1080,
  });
});
test('timecode renders minutes and tenths', () => {
  assert.equal(formatTime(65.25, true), '01:05.2');
  assert.equal(formatTime(-1), '00:00');
});
