import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createHarness, metadata, until, importVideo, messages } from './helpers/editor-harness.js';

test('invalid URLs do not reach API and import errors restore usable controls', async (t) => {
  const app = createHarness(t, { importError: true });
  app.change('#video-url', 'file:///example/video.mp4', 'input');
  app.submit('#download-form');
  assert.equal(app.requests.length, 0);
  assert.equal(app.find('#video-url').getAttribute('aria-invalid'), 'true');
  app.change('#video-url', 'https://www.instagram.com/reel/EXAMPLE/', 'input');
  app.submit('#download-form');
  await until(() => app.find('#status-detail').textContent === messages.en.errors.VIDEO_UNAVAILABLE);
  assert.equal(app.find('#download-button').disabled, false);
  assert.equal(app.find('#local-import-button').disabled, false);
  assert.equal(app.find('#video-file').disabled, false);
  assert.equal(app.find('#video-url').readOnly, false);
  assert.equal(app.find('#open-export').disabled, true);
  assert.deepEqual(app.errors, []);
});

test('import, crop, trim, timed text and export controls send the correct edit request', async (t) => {
  const app = createHarness(t);
  await importVideo(app);
  assert.deepEqual(app.requests[0].body, { url: 'https://www.instagram.com/reel/EXAMPLE/' });
  assert.equal(app.find('#media-card').hidden, false);
  app.find('[data-ratio="1:1"]').click();
  app.change('#trim-start', 2);
  app.change('#trim-end', 5);
  app.find('#text-tab').click();
  app.change('#text-enabled', true);
  app.change('#text-value', 'Merhaba İstanbul', 'input');
  app.change('#text-start', 0.5);
  app.change('#text-end', 2.5);
  app.change('#text-x', 40);
  app.change('#text-y', 70);
  app.find('#open-export').click();
  assert.equal(app.find('#export-dialog').open, true);
  app.change('#export-resolution', '1080');
  assert.match(app.find('#export-summary').textContent, /1080 × 1080/);
  app.change('#export-format', 'mov');
  app.change('#export-codec', 'hevc');
  app.change('#export-fps', '29.97');
  app.submit('#export-form');
  await until(() => !app.find('#export-download').hidden);
  const exported = app.requests.find((request) => request.url === '/api/exports' && request.method === 'POST').body;
  assert.deepEqual(exported.trim, { start: 2, end: 5 });
  assert.equal(exported.crop.width, 1);
  assert.equal(exported.crop.height, 720 / 1280);
  assert.equal(exported.text.value, 'Merhaba İstanbul');
  assert.deepEqual([exported.text.x, exported.text.y, exported.text.start, exported.text.end], [0.4, 0.7, 0.5, 2.5]);
  assert.deepEqual([exported.output.format, exported.output.codec, exported.output.fps], ['mov', 'hevc', 29.97]);
  assert.equal(app.find('#export-download').getAttribute('href'), '/api/exports/test-export/file');
  assert.equal(app.find('#export-percent').textContent, '100%');
  assert.equal(app.find('#download-button').disabled, false);
  assert.deepEqual(app.errors, []);
});

test('active export can be cancelled and retains current editing controls', async (t) => {
  const app = createHarness(t, { exportStatus: 'processing' });
  await importVideo(app);
  app.find('#open-export').click();
  app.submit('#export-form');
  await until(() => app.find('#export-percent').textContent === '37%');
  assert.equal(app.find('#download-button').disabled, true);
  assert.equal(app.find('#local-import-button').disabled, true);
  assert.equal(app.find('#video-file').disabled, true);
  app.find('#export-cancel').click();
  await until(() => app.find('#export-progress-title').textContent === 'Export cancelled');
  assert.ok(app.requests.some((request) => request.url === '/api/exports/test-export' && request.method === 'DELETE'));
  assert.equal(app.find('#download-button').disabled, false);
  assert.equal(app.find('#local-import-button').disabled, false);
  assert.equal(app.find('#media-card').hidden, false);
  assert.deepEqual(app.errors, []);
});

test('expired previous output is released once when reopening and immediately exporting again', async (t) => {
  let finishDelete;
  const deletion = new Promise((resolve) => { finishDelete = resolve; });
  const app = createHarness(t, { deleteExport: () => deletion });
  await importVideo(app);
  app.find('#open-export').click();
  app.submit('#export-form');
  await until(() => !app.find('#export-download').hidden);
  app.find('#close-export').click();
  app.find('#open-export').click();
  app.submit('#export-form');
  assert.equal(app.requests.filter((request) => request.method === 'DELETE').length, 1);
  finishDelete({ ok: false, status: 404, json: async () => ({ error: { message: 'Oturumun süresi doldu' } }) });
  await until(() => !app.find('#export-download').hidden);
  assert.equal(app.requests.filter((request) => request.url === '/api/exports' && request.method === 'POST').length, 2);
  assert.equal(app.find('#export-error').hidden, true);
  assert.deepEqual(app.errors, []);
});

test('a temporary progress request failure keeps the running export cancellable', async (t) => {
  const app = createHarness(t, { pollError: true });
  await importVideo(app);
  app.find('#open-export').click();
  app.submit('#export-form');
  await until(() => !app.find('#export-error').hidden);
  assert.match(app.find('#export-error').textContent, /checking.*again|rechecking|retrying/i);
  assert.equal(app.find('#download-button').disabled, true);
  assert.equal(app.find('#export-cancel').disabled, false);
  app.find('#export-cancel').click();
  await until(() => app.find('#export-progress-title').textContent === 'Export cancelled');
  assert.ok(app.requests.some((request) => request.url === '/api/exports/test-export' && request.method === 'DELETE'));
  assert.equal(app.find('#download-button').disabled, false);
  assert.deepEqual(app.errors, []);
});

test('direct video links retain signed query parameters and reject embedded credentials', async (t) => {
  const app = createHarness(t);
  for (const invalid of ['javascript:alert(1)', 'https://user:password@example.com/video.mp4']) {
    app.change('#video-url', invalid, 'input');
    app.submit('#download-form');
    assert.equal(app.requests.length, 0);
    assert.equal(app.find('#video-url').getAttribute('aria-invalid'), 'true');
  }
  const signedUrl = 'https://media.example.com/download?id=42&token=a%2Fb%2Bc%3D&expires=123&signature=a+b';
  app.change('#video-url', signedUrl, 'input');
  app.submit('#download-form');
  await until(() => !app.find('#open-export').disabled);
  assert.deepEqual(app.requests[0].body, { url: signedUrl });
  assert.equal(app.find('#video-url').hasAttribute('aria-invalid'), false);
  assert.equal(app.find('#media-card').hidden, false);
  assert.deepEqual(app.errors, []);
});

test('the supplied YouTube, Shorts and X links enter the existing editor and export flow', async (t) => {
  const app = createHarness(t);
  const cases = [
    ['https://www.youtube.com/watch?v=0rW7Fbm4S7g', 'https://www.youtube.com/watch?v=0rW7Fbm4S7g'],
    ['https://youtube.com/shorts/q_WdpYiXXaQ?si=Iqc0wdj2_prU_e6F', 'https://www.youtube.com/watch?v=q_WdpYiXXaQ'],
    ['https://x.com/RealFedeURU/status/2112511582714347954', 'https://x.com/RealFedeURU/status/2112511582714347954'],
  ];
  for (const [input, canonical] of cases) {
    app.change('#video-url', input, 'input');
    app.submit('#download-form');
    await until(() => !app.find('#open-export').disabled);
    assert.deepEqual(app.requests.at(-1).body, { url: canonical });
    assert.equal(app.find('#video-url').hasAttribute('aria-invalid'), false);
    assert.equal(app.find('#video-frame').hidden, false);
    assert.equal(app.find('#source-download').getAttribute('href'), metadata.url);
  }
  app.change('#trim-start', 1);
  app.change('#trim-end', 4);
  app.find('#open-export').click();
  app.submit('#export-form');
  await until(() => !app.find('#export-download').hidden);
  const exported = app.requests.find((call) => call.url === '/api/exports' && call.method === 'POST').body;
  assert.equal(exported.mediaId, metadata.id);
  assert.deepEqual(exported.trim, { start: 1, end: 4 });
  assert.match(app.find('#import-help').textContent, /YouTube \/ Shorts.*X \(Twitter\)/);
  assert.deepEqual(app.errors, []);
});

test('supported YouTube and Twitter aliases normalize one video and discard platform tracking', async (t) => {
  const app = createHarness(t);
  const youtube = 'https://www.youtube.com/watch?v=0rW7Fbm4S7g';
  const x = 'https://x.com/RealFedeURU/status/2112511582714347954';
  const cases = [
    ['https://youtu.be/0rW7Fbm4S7g?si=tracking&t=42', youtube],
    ['https://www.youtu.be/0rW7Fbm4S7g/', youtube],
    ['https://m.youtube.com/watch?v=0rW7Fbm4S7g&list=PLexample&index=3', youtube],
    ['https://music.youtube.com/watch?v=0rW7Fbm4S7g#details', youtube],
    ['https://www.youtube.com/watch/?v=0rW7Fbm4S7g', youtube],
    ['https://www.youtube.com/shorts/0rW7Fbm4S7g/?feature=share', youtube],
    ['https://twitter.com/RealFedeURU/status/2112511582714347954?s=20', x],
    ['https://www.twitter.com/RealFedeURU/status/2112511582714347954/video/1', x],
    ['https://mobile.twitter.com/RealFedeURU/status/2112511582714347954/', x],
    ['https://m.twitter.com/RealFedeURU/status/2112511582714347954/video/2/', x],
    ['https://www.x.com/RealFedeURU/status/2112511582714347954', x],
    ['https://mobile.x.com/RealFedeURU/status/2112511582714347954', x],
    ['https://m.x.com/RealFedeURU/status/2112511582714347954', x],
    ['https://x.com/i/status/2112511582714347954', 'https://x.com/i/status/2112511582714347954'],
    ['https://twitter.com/i/web/status/2112511582714347954/video/1', 'https://x.com/i/status/2112511582714347954'],
  ];
  for (const [input, canonical] of cases) {
    app.change('#video-url', input, 'input');
    app.submit('#download-form');
    await until(() => !app.find('#open-export').disabled);
    assert.deepEqual(app.requests.at(-1).body, { url: canonical }, input);
  }
  assert.equal(app.requests.length, cases.length);
  assert.deepEqual(app.errors, []);
});

test('unsupported or malformed platform links are rejected before an API request', (t) => {
  const app = createHarness(t);
  const invalidUrls = [
    'https://youtube.com/',
    'https://www.youtube.com/playlist?list=PLexample',
    'https://youtube.com/@channel',
    'https://www.youtube.com/watch?list=PLexample',
    'https://www.youtube.com/watch?v=0rW7Fbm4S7',
    'https://www.youtube.com/watch?v=0rW7Fbm4S7gg',
    'https://www.youtube.com/watch?v=0rW7Fbm4S7g&v=q_WdpYiXXaQ',
    'https://youtu.be/0rW7Fbm4S7g/extra',
    'https://www.youtube.com/shorts/invalid',
    'https://www.youtube.com/embed/0rW7Fbm4S7g',
    'https://www.youtube.com/live/0rW7Fbm4S7g',
    'https://studio.youtube.com/watch?v=0rW7Fbm4S7g',
    'https://other.youtu.be/0rW7Fbm4S7g',
    'http://www.youtube.com/watch?v=0rW7Fbm4S7g',
    'https://youtube.com:443/watch?v=0rW7Fbm4S7g',
    'https://user:password@youtube.com/watch?v=0rW7Fbm4S7g',
    'https://x.com/RealFedeURU',
    'https://x.com/home',
    'https://x.com/RealFedeURU/status/not-a-number',
    'https://x.com/RealFedeURU/status/2112511582714347954/extra',
    'https://x.com/RealFedeURU/status/2112511582714347954/video/0',
    'https://x.com/accountnamewaytoolong/status/2112511582714347954',
    'https://x.com/RealFedeURU/status/12345678901234567890123456',
    'https://x.com/i/web/status/',
    'https://help.twitter.com/RealFedeURU/status/2112511582714347954',
    'http://twitter.com/RealFedeURU/status/2112511582714347954',
    'https://x.com:443/RealFedeURU/status/2112511582714347954',
    'https://x.com:8443/RealFedeURU/status/2112511582714347954',
    'https://user:password@x.com/RealFedeURU/status/2112511582714347954',
    'https://www.youtube.com\\watch?v=0rW7Fbm4S7g',
    'https:/www.youtube.com/watch?v=0rW7Fbm4S7g',
    'https://www.youtube.com/watch?v=0rW7Fbm4S7g extra',
  ];
  for (const input of invalidUrls) {
    app.change('#video-url', input, 'input');
    app.submit('#download-form');
    assert.equal(app.requests.length, 0, input);
    assert.equal(app.find('#video-url').getAttribute('aria-invalid'), 'true', input);
    assert.equal(app.find('#download-status').dataset.state, 'error', input);
    assert.equal(app.find('#download-button').disabled, false, input);
  }
  assert.deepEqual(app.errors, []);
});

test('a local file uses a raw upload with an encoded filename and the common editing workflow', async (t) => {
  const app = createHarness(t, { importResponse: async () => ({
    ok: true, json: async () => ({ ...metadata, id: 'local-media', filename: 'İstanbul tatili.mp4', url: '/api/media/local-media/file' }),
  }) });
  const file = new app.window.File(['example video bytes'], 'İstanbul tatili.webm', { type: 'video/webm' });
  app.chooseFile(file);
  await until(() => !app.find('#open-export').disabled);
  const upload = app.requests[0];
  assert.equal(upload.url, '/api/media/upload');
  assert.equal(upload.method, 'POST');
  assert.equal(upload.body, file);
  assert.equal(upload.headers['Content-Type'], 'application/octet-stream');
  assert.equal(upload.headers['X-File-Name'], encodeURIComponent(file.name));
  assert.equal(app.find('#video-file').value, '');
  assert.equal(app.find('#media-filename').textContent, 'İstanbul tatili.mp4');
  assert.equal(app.find('#source-download').getAttribute('href'), '/api/media/local-media/file');
  assert.match(app.find('#source-download').textContent, /Download video/);
  app.change('#trim-start', 2);
  app.change('#trim-end', 6);
  app.find('#open-export').click();
  app.submit('#export-form');
  await until(() => !app.find('#export-download').hidden);
  const exported = app.requests.find((call) => call.url === '/api/exports').body;
  assert.equal(exported.mediaId, 'local-media');
  assert.deepEqual(exported.trim, { start: 2, end: 6 });
  assert.deepEqual(app.errors, []);
});

test('empty files are rejected and a failed file can be selected again', async (t) => {
  let attempts = 0;
  const app = createHarness(t, { importResponse: async () => ++attempts === 1
    ? { ok: false, status: 422, json: async () => ({ error: { code: 'INVALID_VIDEO', message: 'Dosyada video bulunamadı.' } }) }
    : { ok: true, json: async () => ({ ...metadata }) },
  });
  app.chooseFile(new app.window.File([], 'empty.mp4'));
  assert.match(app.find('#status-detail').textContent, /empty/);
  assert.equal(app.requests.length, 0);
  const file = new app.window.File(['video'], 'same.mp4');
  app.chooseFile(file);
  await until(() => app.find('#status-detail').textContent === messages.en.errors.INVALID_VIDEO);
  assert.equal(app.find('#download-button').disabled, false);
  assert.equal(app.find('#local-import-button').disabled, false);
  assert.equal(app.find('#video-file').disabled, false);
  assert.equal(app.find('#video-file').value, '');
  assert.equal(app.find('#open-export').disabled, true);
  app.chooseFile(file);
  await until(() => !app.find('#open-export').disabled);
  assert.equal(attempts, 2);
  assert.equal(app.find('#download-status').dataset.state, 'success');
  assert.deepEqual(app.errors, []);
});

test('cancelling an import prevents duplicate requests and preserves the existing project and edits', async (t) => {
  let attempts = 0;
  const app = createHarness(t, { importResponse: async (call) => {
    if (++attempts === 1) return { ok: true, json: async () => ({ ...metadata }) };
    return new Promise((resolve, reject) => {
      call.signal.addEventListener('abort', () => reject(new app.window.DOMException('Cancelled', 'AbortError')), { once: true });
    });
  } });
  await importVideo(app);
  app.change('#trim-start', 3);
  app.change('#trim-end', 7);
  const file = new app.window.File(['video'], 'replacement.mp4');
  app.chooseFile(file);
  assert.equal(app.find('#download-button').disabled, true);
  assert.equal(app.find('#local-import-button').disabled, true);
  assert.equal(app.find('#video-file').disabled, true);
  assert.equal(app.find('#video-url').readOnly, true);
  assert.equal(app.find('#open-export').disabled, true);
  assert.equal(app.find('#import-cancel').hidden, false);
  app.chooseFile(file);
  app.submit('#download-form');
  assert.equal(attempts, 2);
  app.find('#import-cancel').click();
  await until(() => app.find('#import-cancel').hidden);
  assert.equal(app.requests[1].signal.aborted, true);
  assert.equal(app.find('#status-title').textContent, 'Import cancelled');
  assert.equal(app.find('#video-file').value, '');
  assert.equal(app.find('#local-import-button').disabled, false);
  assert.equal(app.find('#open-export').disabled, false);
  assert.equal(app.find('#media-filename').textContent, metadata.filename);
  assert.deepEqual([app.find('#trim-start').value, app.find('#trim-end').value], ['3', '7']);
  assert.equal(app.requests.some((call) => call.method === 'DELETE'), false);
  assert.deepEqual(app.errors, []);
});

test('a failed replacement keeps the old project until a new local video is prepared', async (t) => {
  let attempts = 0;
  const app = createHarness(t, { importResponse: async () => {
    attempts += 1;
    if (attempts === 2) return { ok: false, status: 422, json: async () => ({ error: { code: 'UNSUPPORTED_VIDEO', message: 'Desteklenmeyen video.' } }) };
    return { ok: true, json: async () => attempts === 1 ? { ...metadata } : {
      ...metadata, id: 'replacement-media', filename: 'yerel-video.mp4', url: '/api/media/replacement-media/file',
    } };
  } });
  await importVideo(app);
  app.change('#trim-start', 3);
  app.change('#trim-end', 7);
  const file = new app.window.File(['video'], 'yerel-video.mkv');
  app.chooseFile(file);
  await until(() => app.find('#status-detail').textContent === messages.en.errors.UNSUPPORTED_VIDEO);
  assert.equal(app.find('#media-filename').textContent, metadata.filename);
  assert.deepEqual([app.find('#trim-start').value, app.find('#trim-end').value], ['3', '7']);
  assert.equal(app.find('#open-export').disabled, false);
  assert.equal(app.requests.some((call) => call.method === 'DELETE'), false);
  app.chooseFile(file);
  await until(() => app.find('#media-filename').textContent === 'yerel-video.mp4');
  assert.deepEqual([app.find('#trim-start').value, app.find('#trim-end').value], ['0', '20']);
  assert.ok(app.requests.some((call) => call.method === 'DELETE' && call.url === '/api/media/test-media'));
  assert.equal(app.find('#source-download').getAttribute('href'), '/api/media/replacement-media/file');
  assert.deepEqual(app.errors, []);
});

test('large files have no client size cutoff and remain manually cancellable', async (t) => {
  const app = createHarness(t, { importResponse: (call) => new Promise((resolve, reject) => {
    call.signal.addEventListener('abort', () => reject(new app.window.DOMException('Cancelled', 'AbortError')), { once: true });
  }) });
  const large = new app.window.File(['video'], 'large.mp4');
  Object.defineProperty(large, 'size', { value: 20 * 1024 ** 3 });
  app.chooseFile(large);
  assert.equal(app.requests[0].body, large);
  assert.equal(app.find('#import-cancel').hidden, false);
  app.find('#import-cancel').click();
  await until(() => app.find('#import-cancel').hidden);
  assert.equal(app.requests[0].signal.aborted, true);
  assert.doesNotMatch(app.find('#import-help').textContent, /100 MiB/);
  assert.deepEqual(app.errors, []);
});

test('split, duplicate, reorder, undo and redo produce a real sequence export', async (t) => {
  const app = createHarness(t);
  await importVideo(app);
  app.scrub(5);
  app.find('#split-button').click();
  assert.equal(app.window.document.querySelectorAll('.sequence-clip').length, 2);
  app.find('#duplicate-clip').click();
  assert.equal(app.window.document.querySelectorAll('.sequence-clip').length, 3);
  app.key('ArrowLeft', { altKey: true });
  app.change('#clip-speed', '2');
  app.change('#clip-volume', 150);
  app.change('#clip-reverse', true);
  app.find('#undo-button').click();
  assert.equal(app.find('#clip-reverse').checked, false);
  app.find('#redo-button').click();
  assert.equal(app.find('#clip-reverse').checked, true);
  app.find('#open-export').click();
  app.submit('#export-form');
  await until(() => !app.find('#export-download').hidden);
  const payload = app.requests.find((call) => call.url === '/api/exports').body;
  assert.deepEqual(payload.clips.map(({ start, end, speed }) => [start, end, speed]), [[0, 5, 1], [5, 20, 2], [5, 20, 1]]);
  assert.equal(payload.clips[1].volume, 1.5);
  assert.equal(payload.clips[1].reverse, true);
  assert.deepEqual(app.errors, []);
});

test('ripple toggle preserves deleted clip as a gap and closing gaps is undoable', async (t) => {
  const app = createHarness(t);
  await importVideo(app);
  app.scrub(5);
  app.find('#split-button').click();
  app.find('#ripple-toggle').click();
  app.find('#delete-clip').click();
  assert.equal(app.window.document.querySelectorAll('.gap-clip').length, 1);
  assert.equal(app.find('#total-time').textContent, '00:20.0');
  app.find('#ripple-toggle').click();
  assert.equal(app.window.document.querySelectorAll('.gap-clip').length, 0);
  assert.equal(app.find('#total-time').textContent, '00:05.0');
  app.find('#undo-button').click();
  assert.equal(app.window.document.querySelectorAll('.gap-clip').length, 1);
  assert.equal(app.find('#total-time').textContent, '00:20.0');
  assert.deepEqual(app.errors, []);
});

test('freeze insertion, frame stepping and deleting all clips keep recovery available', async (t) => {
  const app = createHarness(t);
  await importVideo(app);
  app.scrub(5);
  app.find('#freeze-button').click();
  assert.equal(app.find('#total-time').textContent, '00:23.0');
  assert.equal(app.find('#freeze-settings').hidden, false);
  assert.equal(app.find('#video-player').currentTime, 5);
  app.change('#freeze-duration', 2);
  assert.equal(app.find('#total-time').textContent, '00:22.0');
  app.find('#frame-next').click();
  assert.equal(app.find('#video-player').currentTime, 5);
  app.find('#delete-clip').click();
  app.find('#delete-clip').click();
  app.find('#delete-clip').click();
  assert.equal(app.find('#open-export').disabled, true);
  assert.equal(app.find('#timeline-empty').hidden, false);
  app.find('#append-source').click();
  assert.equal(app.find('#open-export').disabled, false);
  assert.equal(app.find('#total-time').textContent, '00:20.0');
  assert.deepEqual(app.errors, []);
});

test('markers, snapping, zoom and full-frame portrait thumbnails work together', async (t) => {
  const app = createHarness(t);
  await importVideo(app);
  app.scrub(5);
  app.find('#marker-button').click();
  assert.equal(app.window.document.querySelectorAll('.timeline-marker').length, 1);
  app.scrub(5.1);
  assert.equal(app.find('#video-player').currentTime, 5);
  app.find('#snap-toggle').click();
  app.scrub(5.1);
  assert.ok(Math.abs(app.find('#video-player').currentTime - 5.1) < 0.0001);
  app.change('#timeline-zoom', '4', 'input');
  assert.equal(app.find('#zoom-label').textContent, '400%');
  assert.equal(app.find('#timeline').style.width, '1520px');
  app.find('#zoom-fit').click();
  assert.equal(app.find('#timeline').style.width, '380px');
  await until(() => !!app.find('.clip-thumbnails img'));
  assert.equal(app.find('.clip-thumbnails img').style.aspectRatio, '720 / 1280');
  const styles = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(styles, /\.sequence-clip \.clip-thumbnails img\{[^}]*height:100%[^}]*flex:1 1 0[^}]*object-fit:contain/);
  assert.deepEqual(app.errors, []);
});

test('preview maps output time through clip speed and reverse and freezes on a valid final frame', async (t) => {
  const app = createHarness(t);
  await importVideo(app);
  app.scrub(5);
  app.find('#split-button').click();
  app.change('#clip-speed', '2');
  app.scrub(7, 12.5);
  assert.ok(Math.abs(app.find('#video-player').currentTime - 9) < 1e-8);
  app.change('#clip-reverse', true);
  assert.ok(Math.abs(app.find('#video-player').currentTime - 16) < 1e-8);
  app.find('#reset-button').click();
  app.scrub(20);
  app.find('#freeze-button').click();
  assert.ok(app.find('#video-player').currentTime <= 20 - 1 / 30 + 1e-9);
  app.find('#open-export').click();
  app.submit('#export-form');
  await until(() => !app.find('#export-download').hidden);
  const payload = app.requests.find((call) => call.url === '/api/exports').body;
  const frozen = payload.clips.at(-1);
  assert.equal(frozen.freezeDuration, 3);
  assert.ok(frozen.start <= 20 - 1 / 30 + 1e-9);
  assert.equal(frozen.start, frozen.end);
  assert.deepEqual(app.errors, []);
});

test('dragging a selected trim handle changes source bounds and is undoable', async (t) => {
  const app = createHarness(t);
  await importVideo(app);
  app.find('#trim-handle-end').dispatchEvent(new app.window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 380 }));
  app.find('#clip-track').dispatchEvent(new app.window.MouseEvent('pointermove', { bubbles: true, clientX: 190 }));
  app.find('#clip-track').dispatchEvent(new app.window.MouseEvent('pointerup', { bubbles: true, clientX: 190 }));
  assert.equal(app.find('#trim-end').value, '10');
  assert.equal(app.find('#total-time').textContent, '00:10.0');
  app.find('#undo-button').click();
  assert.equal(app.find('#trim-end').value, '20');
  assert.equal(app.find('#total-time').textContent, '00:20.0');
  assert.deepEqual(app.errors, []);
});
