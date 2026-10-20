import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { initVoiceover, resolvedVoiceovers } from './voiceover.js';
import { configureI18n, setLanguage } from './i18n.js';
import enVoiceover from './locales/en/voiceover.json' with { type: 'json' };
import trVoiceover from './locales/tr/voiceover.json' with { type: 'json' };
import enErrors from './locales/en/errors.json' with { type: 'json' };
import trErrors from './locales/tr/errors.json' with { type: 'json' };

const clips = () => [
  { id: 'a', start: 0, end: 4, speed: 1 },
  { id: 'b', start: 4, end: 10, speed: 1 },
];
const voice = (overrides = {}) => ({
  id: 'voice', url: '/voice.m4a', start: 2, offset: 0, duration: 5,
  sourceDuration: 5, volume: 1, muted: false, ...overrides,
});

test('linked voiceover follows clip reordering, disappears with its anchor and returns on undo', () => {
  const edits = { clips: clips(), voiceovers: [voice({ start: 5, linkedClipId: 'b', linkedOffset: 1 })] };
  assert.equal(resolvedVoiceovers(edits, 10)[0].start, 5);
  edits.clips.reverse();
  assert.equal(resolvedVoiceovers(edits, 10)[0].start, 1);
  edits.clips = edits.clips.filter((item) => item.id !== 'b');
  assert.equal(resolvedVoiceovers(edits, 4).length, 0);
  edits.clips = clips();
  assert.equal(resolvedVoiceovers(edits, 10)[0].start, 5);
});

test('voiceover trims correctly to timeline, source length and negative linked start', () => {
  const edits = { clips: clips(), voiceovers: [
    voice({ id: 'tail', start: 8, duration: 5 }),
    voice({ id: 'offset', start: 0, offset: 3, duration: 5 }),
    voice({ id: 'linked', linkedClipId: 'a', linkedOffset: -2 }),
  ] };
  const output = resolvedVoiceovers(edits, 10);
  assert.equal(output[0].duration, 2);
  assert.equal(output[1].duration, 2);
  assert.deepEqual([output[2].start, output[2].offset, output[2].duration], [0, 2, 3]);
});

function harness(t, { getUserMedia, fetchResponse } = {}) {
  const dom = new JSDOM(`
    <button id="voiceover-record"></button><button id="voiceover-link"></button><span id="voiceover-status"></span>
    <div id="voiceover-track"></div><div id="voiceover-controls"></div>
  `, { url: 'http://editor.test/' });
  const { window } = dom;
  configureI18n({
    config: { defaultLanguage: 'en', languages: [{ code: 'en', label: 'English' }, { code: 'tr', label: 'Türkçe' }] },
    catalogs: { en: { voiceover: enVoiceover, errors: enErrors }, tr: { voiceover: trVoiceover, errors: trErrors } },
    document: window.document, storage: window.localStorage,
  });
  const requests = [], players = [], snapshots = [];
  let microphoneRequests = 0, stoppedTracks = 0, recorderCount = 0;
  const stream = { getTracks: () => [{ stop() { stoppedTracks += 1; } }] };
  Object.defineProperty(window.navigator, 'mediaDevices', { value: {
    getUserMedia: (...args) => { microphoneRequests += 1; return getUserMedia ? getUserMedia(...args) : Promise.resolve(stream); },
  } });
  window.MediaRecorder = class extends window.EventTarget {
    static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
    constructor(_stream, options) { super(); recorderCount += 1; this.mimeType = options?.mimeType; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      queueMicrotask(() => {
        const event = new window.Event('dataavailable');
        event.data = new window.Blob(['audio bytes'], { type: this.mimeType });
        this.dispatchEvent(event); this.dispatchEvent(new window.Event('stop'));
      });
    }
  };
  const playback = new WeakMap();
  Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', { get() { return playback.get(this) !== true; } });
  window.HTMLMediaElement.prototype.pause = function () { playback.set(this, false); };
  window.HTMLMediaElement.prototype.play = async function () { playback.set(this, true); };
  window.HTMLMediaElement.prototype.load = function () {};
  const createElement = window.document.createElement.bind(window.document);
  window.document.createElement = (...args) => {
    const element = createElement(...args);
    if (args[0] === 'audio') players.push(element);
    return element;
  };
  window.fetch = async (url, options) => {
    requests.push({ url, ...options });
    return fetchResponse ? fetchResponse(url, options) : {
      ok: true, json: async () => ({ id: 'recorded', duration: 12, url: '/recorded.m4a' }),
    };
  };
  const state = { media: { id: 'media' }, edits: { clips: clips(), voiceovers: [] }, cursor: 3, playing: false };
  let controller;
  controller = initVoiceover({
    state, getDuration: () => state.edits.clips.reduce((sum, clip) => sum + (clip.end - clip.start) / clip.speed, 0),
    getCursor: () => state.cursor,
    getDocument: () => window.document,
    stopPlayback: () => { state.playing = false; },
    updateEdits(change) { snapshots.push(structuredClone(state.edits)); change(state.edits); controller.render(); },
  });
  t.after(() => { controller.dispose(); window.close(); });
  controller.render();
  const click = () => window.document.getElementById('voiceover-record').click();
  const status = () => window.document.getElementById('voiceover-status').textContent;
  return {
    window, state, controller, requests, players, snapshots, click, status,
    counts: () => ({ microphoneRequests, stoppedTracks, recorderCount }),
  };
}

async function until(condition) {
  for (let n = 0; n < 100; n += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(condition(), 'Voiceover state did not settle');
}

test('microphone opens only on click; stop uploads raw audio and exports only the visible timeline range', async (t) => {
  const app = harness(t);
  assert.equal(app.counts().microphoneRequests, 0);
  app.click();
  await until(() => app.status().startsWith('Recording ·'));
  assert.equal(app.state.recordingVoiceover, true);
  app.click();
  await until(() => app.state.edits.voiceovers.length === 1 && !app.state.recordingVoiceover);
  assert.equal(app.requests[0].url, '/api/media/media/voiceovers');
  assert.equal(app.requests[0].headers['Content-Type'], 'application/octet-stream');
  assert.ok(app.requests[0].body instanceof app.window.Blob);
  assert.deepEqual(app.controller.toExport(), [{
    id: 'recorded', start: 3, offset: 0, duration: 7, volume: 1, muted: false,
  }]);
  assert.equal(app.snapshots.length, 1);
  assert.equal(app.counts().stoppedTracks, 1);
  assert.equal(app.window.document.querySelectorAll('.voiceover-clip').length, 1);
});

test('denied microphone permission is readable and leaves the project unchanged', async (t) => {
  const app = harness(t, { getUserMedia: async () => { throw Object.assign(new Error(), { name: 'NotAllowedError' }); } });
  app.click();
  await until(() => app.status().includes('Microphone permission was denied'));
  assert.equal(app.state.recordingVoiceover, false);
  assert.equal(app.requests.length, 0);
  assert.equal(app.state.edits.voiceovers.length, 0);
});

test('changing media while permission is pending releases a late microphone without starting recording', async (t) => {
  let grant, released = 0;
  const app = harness(t, { getUserMedia: () => new Promise((resolve) => { grant = resolve; }) });
  app.click();
  app.controller.dispose();
  app.state.media = { id: 'replacement' };
  grant({ getTracks: () => [{ stop() { released += 1; } }] });
  await until(() => released === 1);
  assert.equal(app.counts().recorderCount, 0);
  assert.equal(app.requests.length, 0);
});

test('disposing an active recording releases the microphone and discards its queued stop event', async (t) => {
  const app = harness(t);
  app.click();
  await until(() => app.status().startsWith('Recording ·'));
  app.controller.dispose();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(app.counts().stoppedTracks, 1);
  assert.equal(app.requests.length, 0);
  assert.equal(app.state.recordingVoiceover, false);
});

test('microphone control can cancel a pending recording upload without locking the editor', async (t) => {
  const app = harness(t, { fetchResponse: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })), { once: true });
  }) });
  app.click();
  await until(() => app.status().startsWith('Recording ·'));
  app.click();
  await until(() => app.requests.length === 1);
  assert.equal(app.window.document.getElementById('voiceover-record').disabled, false);
  app.click();
  assert.equal(app.requests[0].signal.aborted, true);
  assert.equal(app.state.recordingVoiceover, false);
  assert.equal(app.state.edits.voiceovers.length, 0);
  assert.equal(app.status(), 'Recording cancelled.');
});

test('deleting the last video clip while recording keeps the microphone stop control available', async (t) => {
  const app = harness(t);
  app.click();
  await until(() => app.status().startsWith('Recording ·'));
  app.state.edits.clips = [];
  app.controller.render();
  assert.equal(app.window.document.getElementById('voiceover-record').disabled, false);
  app.click();
  await until(() => !app.state.recordingVoiceover);
  assert.equal(app.counts().stoppedTracks, 1);
  assert.equal(app.state.edits.voiceovers.length, 1);
  assert.deepEqual(app.controller.toExport(), []);
});

test('voiceover preview seeks independently of source clips, pauses outside range and respects mute', (t) => {
  const app = harness(t);
  app.state.edits.voiceovers = [voice({ start: 2, offset: 1, duration: 4 })];
  app.controller.syncPlayback(3, true);
  assert.equal(app.players.length, 1);
  assert.equal(app.players[0].currentTime, 2);
  assert.equal(app.players[0].paused, false);
  app.controller.syncPlayback(8, true);
  assert.equal(app.players[0].paused, true);
  app.state.edits.voiceovers[0].muted = true;
  app.controller.syncPlayback(3, true);
  assert.equal(app.players[0].paused, true);
  app.state.edits.voiceovers[0].muted = false;
  app.controller.syncPlayback(4, true);
  app.controller.stop();
  assert.equal(app.players[0].paused, true);
});

test('voiceover editing and removal are undoable without deleting the stored recording', (t) => {
  const app = harness(t);
  app.state.edits.voiceovers = [voice()];
  app.controller.render();
  app.window.document.querySelector('.voiceover-clip').click();
  const volume = app.window.document.querySelector('[data-voice-field="volume"]');
  volume.value = '50';
  volume.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  assert.equal(app.controller.toExport()[0].volume, 0.5);
  app.window.document.querySelector('#voiceover-controls button').click();
  assert.equal(app.state.edits.voiceovers.length, 0);
  assert.equal(app.requests.length, 0);
  app.state.edits = app.snapshots.at(-1);
  app.controller.render();
  assert.equal(app.controller.toExport()[0].volume, 0.5);
});

test('link toolbar anchors the selected recording and deselection prevents editing the wrong track', (t) => {
  const app = harness(t);
  app.state.edits.voiceovers = [voice({ start: 5 })];
  app.controller.render();
  assert.equal(app.window.document.getElementById('voiceover-link').disabled, true);
  app.window.document.querySelector('.voiceover-clip').click();
  app.window.document.getElementById('voiceover-link').click();
  assert.equal(app.state.edits.voiceovers[0].linkedClipId, 'b');
  app.state.edits.clips.reverse();
  assert.equal(app.controller.toExport()[0].start, 1);
  app.controller.deselect();
  assert.equal(app.controller.hasSelection(), false);
  assert.equal(app.controller.deleteSelected(), false);
  assert.equal(app.window.document.getElementById('voiceover-link').disabled, true);
});

test('changing language refreshes an active recording and its controls without restarting capture or changing edits', async (t) => {
  const app = harness(t);
  assert.equal(app.window.document.getElementById('voiceover-record').title, 'Record with microphone');
  app.click();
  await until(() => app.status().startsWith('Recording ·'));
  const captureCounts = app.counts();
  setLanguage('tr');
  app.controller.render();
  assert.match(app.status(), /^Kayıt alınıyor · \d+ sn/);
  assert.equal(app.window.document.getElementById('voiceover-record').title, 'Ses kaydını bitir');
  assert.deepEqual(app.counts(), captureCounts);
  assert.equal(app.state.recordingVoiceover, true);

  app.click();
  await until(() => app.state.edits.voiceovers.length === 1 && !app.state.recordingVoiceover);
  app.window.document.querySelector('.voiceover-clip').click();
  const before = structuredClone(app.controller.toExport());
  assert.equal(app.window.document.querySelector('#voiceover-controls strong').textContent, 'Ses kaydı');
  setLanguage('en');
  app.controller.render();
  assert.equal(app.status(), 'Recording added to the timeline.');
  assert.equal(app.window.document.querySelector('#voiceover-controls strong').textContent, 'Voiceover');
  assert.equal(app.window.document.querySelector('[data-voice-field="start"]').getAttribute('aria-label'), 'Timeline start (s)');
  assert.equal(app.controller.hasSelection(), true);
  assert.deepEqual(app.controller.toExport(), before);
  assert.equal(app.requests.length, 1);
});

test('recording API errors use localized codes and redraw after a language change', async (t) => {
  const app = harness(t, { fetchResponse: async () => ({
    ok: false, json: async () => ({ error: { code: 'INVALID_VOICEOVER', message: 'Raw server message must not be displayed' } }),
  }) });
  app.click();
  await until(() => app.status().startsWith('Recording ·'));
  app.click();
  await until(() => app.status() === enErrors.INVALID_VOICEOVER);
  assert.equal(app.state.recordingVoiceover, false);
  setLanguage('tr');
  app.controller.render();
  assert.equal(app.status(), trErrors.INVALID_VOICEOVER);
  assert.equal(app.requests.length, 1);
  assert.equal(app.state.edits.voiceovers.length, 0);
});

test('unknown recording API errors use the localized recording fallback', async (t) => {
  const app = harness(t, { fetchResponse: async () => ({
    ok: false, json: async () => ({ error: { code: 'FUTURE_ERROR', message: 'Untranslated server detail' } }),
  }) });
  app.click();
  await until(() => app.status().startsWith('Recording ·'));
  app.click();
  await until(() => app.status() === enVoiceover.addFailed);
  setLanguage('tr');
  app.controller.render();
  assert.equal(app.status(), trVoiceover.addFailed);
});
