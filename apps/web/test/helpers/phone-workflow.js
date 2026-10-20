import assert from 'node:assert/strict';
import { createHarness, until } from './editor-harness.js';

export const phoneWorkflowUrl = 'https://www.youtube.com/watch?v=3pCGU3bIPEc';

// Runs application event handlers in an offline DOM. The supplied metadata may
// come from the real import API; network transport and media decoding are stubbed.
// The returned payload is captured from the real export-form submit handler.
export async function exercisePhoneWorkflow(t, media) {
  assert.ok(media.duration >= 4 && media.fps > 0, 'A video with four usable sections is required.');
  const app = createHarness(t, { media });
  const checks = [];
  const close = (actual, expected, label, tolerance = 1e-7) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} ≈ ${expected}`);
  const count = () => app.window.document.querySelectorAll('.sequence-clip').length;
  const clips = () => [...app.window.document.querySelectorAll('.sequence-clip')];
  const ids = () => clips().map((clip) => clip.dataset.clipId);
  const selected = () => app.find('.sequence-clip.selected');
  const select = (index) => app.key('Enter', {}, clips()[index]);
  const rounded = (value) => Number(value.toFixed(2));
  const check = (name, details = {}) => checks.push({ name, status: 'passed', ...details });
  const boundaries = [0, ...[1, 2, 3].map((part) =>
    Math.round(media.duration * part / 4 * media.fps) / media.fps), media.duration];
  const quarter = boundaries[2] - boundaries[1];
  const frame = 1 / media.fps;

  app.change('#video-url', phoneWorkflowUrl, 'input');
  app.submit('#download-form');
  await until(() => !app.find('#open-export').disabled);
  assert.deepEqual(app.requests[0].body, { url: phoneWorkflowUrl });
  assert.equal(app.find('#source-download').getAttribute('href'), media.url);
  check('YouTube import uses the editor API and supplied source metadata', { duration: media.duration, fps: media.fps });

  app.find('#zoom-in').click();
  assert.equal(app.find('#zoom-label').textContent, '150%');
  app.find('#zoom-out').click();
  assert.equal(app.find('#zoom-label').textContent, '100%');
  app.change('#timeline-zoom', 4, 'input');
  assert.equal(app.find('#zoom-label').textContent, '400%');
  assert.equal(app.find('#timeline').style.width, '1520px');
  app.find('#zoom-fit').click();
  assert.equal(app.find('#timeline').style.width, '380px');
  check('Zoom in, zoom out, slider and fit preserve a usable timeline');

  app.find('#follow-toggle').click();
  assert.equal(app.find('#follow-toggle').getAttribute('aria-pressed'), 'false');
  app.find('#follow-toggle').click();
  assert.equal(app.find('#follow-toggle').getAttribute('aria-pressed'), 'true');
  app.find('#frame-next').click();
  close(app.find('#video-player').currentTime, frame, 'Next frame');
  app.find('#frame-previous').click();
  close(app.find('#video-player').currentTime, 0, 'Previous frame');
  check('Automatic follow toggle and frame step controls');

  const markerTime = Math.round(media.duration * 0.1 * media.fps) / media.fps;
  app.scrub(markerTime);
  app.find('#marker-button').click();
  assert.equal(app.window.document.querySelectorAll('.timeline-marker').length, 1);
  app.scrub(markerTime + media.duration / 1000);
  close(app.find('#video-player').currentTime, markerTime, 'Snap to marker');
  app.find('#snap-toggle').click();
  app.scrub(markerTime + media.duration / 1000);
  close(app.find('#video-player').currentTime, markerTime + media.duration / 1000, 'Snapping disabled');
  app.find('.timeline-marker').click();
  close(app.find('#video-player').currentTime, markerTime, 'Marker navigation');
  app.find('.timeline-marker').dispatchEvent(new app.window.MouseEvent('dblclick', { bubbles: true }));
  assert.equal(app.window.document.querySelectorAll('.timeline-marker').length, 0);
  app.find('#snap-toggle').click();
  check('Markers can be added, snapped to, navigated and removed');

  app.scrub(boundaries[1]);
  app.find('#split-button').click();
  assert.equal(count(), 2);
  app.scrub(boundaries[2]);
  app.key('b', { ctrlKey: true });
  assert.equal(count(), 3);
  app.find('#blade-tool').click();
  assert.equal(app.find('#blade-tool').getAttribute('aria-pressed'), 'true');
  clips().at(-1).dispatchEvent(new app.window.MouseEvent('click', {
    bubbles: true, button: 0, clientX: boundaries[3] / media.duration * app.find('#timeline').clientWidth,
  }));
  assert.equal(count(), 4);
  app.find('#select-tool').click();
  assert.equal(app.find('#select-tool').getAttribute('aria-pressed'), 'true');
  const originalOrder = ids();
  check('Toolbar split, Ctrl+B and blade click create four frame-aligned quarters', { boundaries });

  app.find('#duplicate-clip').click();
  assert.equal(count(), 5);
  app.key('z', { ctrlKey: true });
  assert.equal(count(), 4);
  app.key('z', { ctrlKey: true, shiftKey: true });
  assert.equal(count(), 5);
  select(4);
  app.find('#delete-clip').click();
  assert.deepEqual(ids(), originalOrder);
  app.find('#undo-button').click();
  assert.equal(count(), 5);
  app.find('#redo-button').click();
  assert.deepEqual(ids(), originalOrder);
  check('Duplicate, delete, keyboard undo/redo and toolbar undo/redo');

  select(3);
  app.key('ArrowLeft', { altKey: true });
  assert.deepEqual(ids(), [originalOrder[0], originalOrder[1], originalOrder[3], originalOrder[2]]);
  app.find('#undo-button').click();
  assert.deepEqual(ids(), originalOrder);
  const transfer = {
    values: new Map(), setData(type, value) { this.values.set(type, value); },
    getData(type) { return this.values.get(type) || ''; },
  };
  const drag = (target, name, clientX) => {
    const event = new app.window.MouseEvent(name, { bubbles: true, cancelable: true, clientX });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    target.dispatchEvent(event);
  };
  drag(clips()[0], 'dragstart', 0);
  drag(app.find('#clip-track'), 'dragover', 379);
  drag(app.find('#clip-track'), 'drop', 379);
  drag(app.find('#clip-track'), 'dragend', 379);
  assert.deepEqual(ids(), [...originalOrder.slice(1), originalOrder[0]]);
  app.find('#undo-button').click();
  assert.deepEqual(ids(), originalOrder);
  check('Keyboard reorder and drag/drop reorder can be restored');

  select(1);
  const trimTime = boundaries[1] + quarter / 3;
  app.scrub(trimTime);
  app.find('#trim-left-button').click();
  close(Number(app.find('#trim-start').value), rounded(trimTime), 'Trim left');
  app.find('#undo-button').click();
  select(1);
  app.scrub(trimTime);
  app.find('#trim-right-button').click();
  close(Number(app.find('#trim-end').value), rounded(trimTime), 'Trim right');
  app.find('#undo-button').click();
  select(1);
  app.key('ArrowLeft', {}, app.find('#trim-handle-end'));
  close(Number(app.find('#trim-end').value), rounded(boundaries[2] - frame), 'Handle keyboard trim');
  app.find('#undo-button').click();
  assert.deepEqual(ids(), originalOrder);
  check('Trim before cursor, trim after cursor and keyboard trim handle restore correctly');

  select(1);
  app.find('#ripple-toggle').click();
  assert.equal(app.find('#ripple-toggle').getAttribute('aria-pressed'), 'false');
  app.find('#delete-clip').click();
  assert.equal(app.window.document.querySelectorAll('.gap-clip').length, 1);
  app.find('#ripple-toggle').click();
  assert.equal(app.window.document.querySelectorAll('.gap-clip').length, 0);
  assert.equal(count(), 3);
  app.find('#undo-button').click();
  assert.equal(app.window.document.querySelectorAll('.gap-clip').length, 1);
  app.find('#undo-button').click();
  assert.deepEqual(ids(), originalOrder);
  assert.equal(app.window.document.querySelectorAll('.gap-clip').length, 0);
  check('Non-ripple delete preserves a gap; main-track magnet closes it; undo restores source');

  select(1);
  app.scrub(trimTime);
  app.find('#freeze-button').click();
  assert.equal(count(), 6);
  assert.equal(app.find('#freeze-settings').hidden, false);
  assert.equal(app.find('#freeze-duration').value, '3');
  const frozenSourceTime = Math.floor(trimTime * media.fps) / media.fps;
  // Inserting freeze keeps the cursor at its insertion point.
  close(app.find('#video-player').currentTime, frozenSourceTime, 'Freeze source frame');
  app.change('#freeze-duration', 1.5);
  assert.equal(app.find('#freeze-duration').value, '1.5');
  app.find('#undo-button').click();
  assert.equal(app.find('#freeze-duration').value, '3');
  app.find('#undo-button').click();
  assert.deepEqual(ids(), originalOrder);
  check('Freeze inserts a silent source frame; duration and insertion are undoable');

  select(1);
  app.change('#clip-speed', '2');
  const fastDuration = media.duration - quarter / 2;
  const outputSample = boundaries[1] + quarter / 8;
  app.scrub(outputSample, fastDuration);
  close(app.find('#video-player').currentTime, boundaries[1] + quarter / 4, 'Speed preview mapping');
  assert.equal(app.find('#video-player').playbackRate, 2);
  app.find('#reverse-button').click();
  assert.equal(app.find('#clip-reverse').checked, true);
  close(app.find('#video-player').currentTime, boundaries[2] - quarter / 4, 'Reverse preview mapping');
  assert.equal(app.find('#video-player').muted, true);
  app.change('#clip-volume', 65);
  app.change('#clip-muted', true);
  assert.equal(app.find('#clip-muted').checked, true);
  app.find('#undo-button').click();
  app.find('#undo-button').click();
  app.find('#undo-button').click();
  app.find('#undo-button').click();
  assert.equal(app.find('#clip-speed').value, '1');
  assert.equal(app.find('#clip-volume').value, '100');
  assert.equal(app.find('#clip-muted').checked, false);
  assert.equal(app.find('#clip-reverse').checked, false);
  assert.deepEqual(ids(), originalOrder);
  check('Speed, reverse, volume and mute apply to selection and restore without changing the four quarters');

  app.find('#text-tab').click();
  app.change('#text-enabled', true);
  app.find('#text-value').focus();
  app.change('#text-value', 'Telefon testi', 'input');
  app.change('#text-start', 0.5);
  app.change('#text-end', 3);
  // A long video fitted to the viewport has a wide time range per pixel.
  // Disable magnetic seeking when inspecting this short text window.
  app.find('#snap-toggle').click();
  app.scrub(1);
  assert.equal(app.find('#text-overlay').hidden, false);
  assert.equal(app.find('#text-overlay').textContent, 'Telefon testi');
  app.scrub(3.5);
  assert.equal(app.find('#text-overlay').hidden, true);
  app.find('#snap-toggle').click();
  for (let index = 0; index < 4; index += 1) app.find('#undo-button').click();
  assert.equal(app.find('#text-enabled').checked, false);
  assert.equal(app.find('#text-clip').hidden, true);
  app.find('#video-tab').click();
  check('Timed text appears only within its range and undo removes it from final export');

  app.find('[data-ratio="9:16"]').click();
  close(Number.parseFloat(app.find('#video-frame').style.width) /
    Number.parseFloat(app.find('#video-frame').style.height), 9 / 16, 'Phone preview aspect');
  assert.equal(app.find('[data-ratio="9:16"]').getAttribute('aria-pressed'), 'true');
  app.find('#open-export').click();
  app.change('#export-resolution', '1080');
  app.change('#export-format', 'mp4');
  app.change('#export-codec', 'h264');
  app.change('#export-fps', 'source');
  app.change('#export-name', 'youtube-3pCGU3bIPEc-4-parca-telefon');
  assert.match(app.find('#export-summary').textContent, /1080 × 1920/);
  app.submit('#export-form');
  await until(() => !app.find('#export-download').hidden);
  const payload = app.requests.find((request) => request.url === '/api/exports' && request.method === 'POST').body;
  assert.equal(payload.mediaId, media.id);
  assert.equal(payload.clips.length, 4);
  for (const [index, clip] of payload.clips.entries()) {
    close(clip.start, boundaries[index], `Clip ${index + 1} source start`);
    close(clip.end, boundaries[index + 1], `Clip ${index + 1} source end`);
    assert.equal(clip.speed, 1);
    assert.equal(clip.reverse, false);
    assert.equal(clip.muted, false);
    assert.equal(clip.volume, 1);
    assert.equal(clip.gapDuration, undefined);
    assert.equal(clip.freezeDuration, undefined);
  }
  close(media.width * payload.crop.width / (media.height * payload.crop.height), 9 / 16, 'Export aspect');
  assert.deepEqual(
    [payload.output.resolution, payload.output.format, payload.output.codec, payload.output.fps],
    ['1080', 'mp4', 'h264', 'source'],
  );
  assert.equal(payload.text, null);
  assert.deepEqual(app.errors, []);
  check('Four original quarters export at 1080 × 1920, MP4/H.264, source FPS', {
    clips: payload.clips.map(({ start, end }) => ({ start, end })),
    crop: payload.crop, output: payload.output,
  });
  return { payload, checks, boundaries, sourceUrl: phoneWorkflowUrl };
}
