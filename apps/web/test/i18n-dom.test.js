import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness, metadata, importVideo, until } from './helpers/editor-harness.js';

test('English is the first-run default even with a Turkish browser, and the selected language survives reopening', (t) => {
  const app = createHarness(t, { navigatorLanguage: 'tr-TR' });
  assert.equal(app.window.document.documentElement.lang, 'en');
  assert.equal(app.find('#language-select').value, 'en');
  assert.equal(app.find('#export-language-select').value, 'en');
  assert.match(app.find('#download-button').textContent, /import video/i);
  assert.match(app.find('#split-button').getAttribute('aria-label'), /split/i);
  assert.equal(app.find('#video-url').getAttribute('placeholder'), 'Paste a video URL');

  app.change('#language-select', 'tr');
  assert.equal(app.window.document.documentElement.lang, 'tr');
  assert.equal(app.find('#export-language-select').value, 'tr');
  assert.equal(app.find('#download-button').textContent.trim(), 'Videoyu içe aktar');
  assert.equal(app.find('#split-button').getAttribute('aria-label'), 'Oynatma başlığında böl');
  assert.match(app.find('#split-button').title, /Ctrl\+B/);
  assert.match(app.find('#video-url').getAttribute('placeholder'), /bağlantı/);
  assert.equal(app.window.localStorage.getItem('frame-language'), 'tr');

  const reopened = createHarness(t, { savedLanguage: app.window.localStorage.getItem('frame-language') });
  assert.equal(reopened.window.document.documentElement.lang, 'tr');
  assert.equal(reopened.find('#language-select').value, 'tr');
  assert.equal(reopened.find('#download-button').textContent.trim(), 'Videoyu içe aktar');
  const unsupported = createHarness(t, { savedLanguage: 'not-a-configured-language', navigatorLanguage: 'tr-TR' });
  assert.equal(unsupported.window.document.documentElement.lang, 'en');
  assert.equal(unsupported.find('#language-select').value, 'en');
  assert.deepEqual([...app.errors, ...reopened.errors, ...unsupported.errors], []);
});

test('switching language preserves video identity, source edits, user text, undo history and export form values', async (t) => {
  const media = { ...metadata, filename: 'İstanbul — my own title.mp4' };
  const app = createHarness(t, { media });
  await importVideo(app);
  assert.equal(app.find('#text-value').value, 'Tell your story.');
  app.change('#trim-start', 2);
  app.change('#trim-end', 18);
  app.scrub(8, 16);
  app.find('#split-button').click();
  app.find('[data-ratio="1:1"]').click();
  app.find('#text-tab').click();
  app.change('#text-enabled', true);
  const caption = 'My title · İstanbul <b>user text</b>';
  app.change('#text-value', caption, 'input');
  app.change('#text-start', 0);
  app.change('#text-end', 16);
  app.find('#video-tab').click();
  app.change('#clip-volume', 65);

  const video = app.find('#video-player');
  const before = {
    source: video.getAttribute('src'), cursor: video.currentTime,
    start: app.find('#trim-start').value, end: app.find('#trim-end').value,
    clips: [...app.window.document.querySelectorAll('.sequence-clip')].map((clip) => clip.dataset.clipId),
    selected: app.find('.sequence-clip.selected').dataset.clipId,
    duration: app.find('#total-time').textContent,
  };
  app.change('#language-select', 'tr');
  assert.equal(app.find('#video-player'), video, 'Changing language must not replace the loaded media element.');
  assert.equal(video.getAttribute('src'), before.source);
  assert.equal(video.currentTime, before.cursor);
  assert.equal(app.find('#media-filename').textContent, media.filename);
  assert.deepEqual([app.find('#trim-start').value, app.find('#trim-end').value], [before.start, before.end]);
  assert.deepEqual([...app.window.document.querySelectorAll('.sequence-clip')].map((clip) => clip.dataset.clipId), before.clips);
  assert.equal(app.find('.sequence-clip.selected').dataset.clipId, before.selected);
  assert.equal(app.find('#total-time').textContent, before.duration);
  assert.equal(app.find('#text-value').value, caption);
  assert.equal(app.find('#text-overlay').textContent, caption);
  assert.equal(app.find('#text-overlay b'), null);
  assert.equal(app.find('#text-enabled').checked, true);
  assert.match(app.find('.sequence-clip').getAttribute('aria-label'), /^Klip /);
  assert.match(app.find('#timeline-duration').textContent, /2 klip/);
  assert.equal(app.find('#clip-volume').value, '65');
  app.find('#undo-button').click();
  assert.equal(app.find('#clip-volume').value, '100', 'Language changes must not create an edit-history entry.');
  assert.equal(app.find('#text-value').value, caption);
  app.find('#redo-button').click();
  assert.equal(app.find('#clip-volume').value, '65');

  app.find('#open-export').click();
  app.change('#export-name', 'Kullanıcının dosyası');
  app.change('#export-format', 'mov');
  app.change('#export-codec', 'hevc');
  app.change('#export-resolution', '720');
  app.change('#export-fps', '24');
  assert.equal(app.find('#export-language-select').value, 'tr');
  app.change('#export-language-select', 'en');
  assert.equal(app.find('#language-select').value, 'en');
  assert.equal(app.find('#export-language-select').value, 'en');
  assert.equal(app.find('#export-dialog').open, true);
  assert.equal(app.find('#export-name').value, 'Kullanıcının dosyası');
  assert.deepEqual(['format', 'codec', 'resolution', 'fps'].map((key) => app.find(`#export-${key}`).value), ['mov', 'hevc', '720', '24']);
  assert.match(app.find('#export-title').textContent, /export/i);
  assert.match(app.find('.sequence-clip').getAttribute('aria-label'), /^Clip /);
  assert.equal(app.find('#text-value').value, caption);
  app.submit('#export-form');
  await until(() => !app.find('#export-download').hidden);
  const payload = app.requests.find((call) => call.url === '/api/exports' && call.method === 'POST').body;
  assert.equal(payload.mediaId, media.id);
  assert.equal(payload.clips.length, 2);
  assert.equal(payload.text.value, caption);
  assert.deepEqual([payload.output.format, payload.output.codec, payload.output.resolution, payload.output.fps], ['mov', 'hevc', '720', 24]);
  assert.match(app.find('#export-progress-title').textContent, /ready/i);
  assert.deepEqual(app.errors, []);
});

test('language changes translate a pending import and its result without restarting the request', async (t) => {
  let finishImport;
  const app = createHarness(t, { importResponse: () => new Promise((resolve) => { finishImport = resolve; }) });
  app.change('#video-url', 'https://www.youtube.com/watch?v=3pCGU3bIPEc', 'input');
  app.submit('#download-form');
  assert.equal(app.requests.length, 1);
  assert.equal(app.find('#download-button').disabled, true);
  app.change('#language-select', 'tr');
  assert.equal(app.find('#status-title').textContent, 'Video içe aktarılıyor');
  assert.match(app.find('#button-text').textContent, /hazırlanıyor/);
  assert.equal(app.find('#download-button').disabled, true);
  assert.equal(app.requests.length, 1);
  finishImport({ ok: true, json: async () => ({ ...metadata }) });
  await until(() => !app.find('#open-export').disabled);
  assert.equal(app.find('#status-title').textContent, 'Düzenlemeye hazır');
  app.change('#language-select', 'en');
  assert.match(app.find('#status-title').textContent, /ready/i);
  assert.equal(app.requests.length, 1);
  assert.deepEqual(app.errors, []);
});

test('backend error codes localize immediately and on language changes without exposing server-language text', async (t) => {
  const serverText = 'Server-only Turkish detail: gizli teknik metin';
  const app = createHarness(t, { importResponse: async () => ({
    ok: false, status: 422, json: async () => ({ error: { code: 'INVALID_VIDEO', message: serverText } }),
  }) });
  app.chooseFile(new app.window.File(['bad video'], 'bad.mp4'));
  await until(() => app.find('#download-status').dataset.state === 'error');
  const english = app.find('#status-detail').textContent;
  assert.match(english, /video/i);
  assert.notEqual(english, serverText);
  app.change('#language-select', 'tr');
  const turkish = app.find('#status-detail').textContent;
  assert.notEqual(turkish, english);
  assert.notEqual(turkish, serverText);
  assert.equal(app.find('#status-title').textContent, 'Video içe aktarılamadı');
  app.change('#language-select', 'en');
  assert.equal(app.find('#status-detail').textContent, english);
  assert.equal(app.requests.length, 1);
  assert.deepEqual(app.errors, []);
});

test('running export progress, cancellation and download controls keep their state when the language changes', async (t) => {
  const app = createHarness(t, { exportStatus: 'processing' });
  await importVideo(app);
  app.find('#open-export').click();
  app.submit('#export-form');
  await until(() => app.find('#export-percent').textContent === '37%');
  assert.equal(app.find('#export-language-select').disabled, false);
  app.change('#export-language-select', 'tr');
  assert.equal(app.find('#language-select').value, 'tr');
  assert.equal(app.find('#export-language-select').value, 'tr');
  assert.equal(app.find('#export-progress-title').textContent, 'Video dışa aktarılıyor');
  assert.equal(app.find('#export-cancel').textContent, 'İşlemi iptal et');
  assert.equal(app.find('#export-percent').textContent, '37%');
  assert.equal(app.find('#export-download').hidden, true);
  assert.equal(app.find('#download-button').disabled, true);
  assert.equal(app.requests.filter((call) => call.url === '/api/exports' && call.method === 'POST').length, 1);
  app.find('#export-cancel').click();
  await until(() => app.find('#export-progress-title').textContent === 'Dışa aktarma iptal edildi');
  app.change('#export-language-select', 'en');
  assert.equal(app.find('#language-select').value, 'en');
  assert.equal(app.find('#export-language-select').value, 'en');
  assert.match(app.find('#export-progress-title').textContent, /export cancel/i);
  assert.equal(app.find('#download-button').disabled, false);
  assert.deepEqual(app.errors, []);
});
