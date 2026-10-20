import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

// Exercise the actual application handlers in an isolated DOM. No browser or
// live service is accessed; decoding and layout are explicitly outside this test.
const localeRoot = new URL('../../src/locales/', import.meta.url);
const config = JSON.parse(await readFile(new URL('config.json', localeRoot), 'utf8'));
const catalogs = {};
for (const language of config.languages) {
  const directory = new URL(`${language.code}/`, localeRoot);
  catalogs[language.code] = {};
  for (const filename of (await readdir(directory)).filter((name) => name.endsWith('.json'))) {
    catalogs[language.code][filename.slice(0, -5)] = JSON.parse(await readFile(new URL(filename, directory), 'utf8'));
  }
}
export const messages = catalogs;
const sources = await Promise.all(['i18n.js', 'edit-model.js', 'timeline-model.js', 'voiceover.js', 'editor-template.js', 'main.js']
  .map((file) => readFile(new URL(`../../src/${file}`, import.meta.url), 'utf8')));
const application = `const config = ${JSON.stringify(config)}; const catalogs = ${JSON.stringify(catalogs)};\n` + sources.map((source) => source
  .replace(/^import .+;\r?$/gm, '')
  .replace(/^export /gm, '')).join('\n');

export const metadata = {
  id: 'test-media', url: '/api/media/test-media/file',
  filename: 'instagram-example.mp4', duration: 20, width: 720, height: 1280,
  fps: 30, hasAudio: true,
};

export function createHarness(t, { media = metadata, importError = false, importResponse, exportStatus = 'completed', deleteExport, pollError = false, savedLanguage, navigatorLanguage = 'en-US' } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: 'http://editor.test/', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  if (savedLanguage !== undefined) window.localStorage.setItem('frame-language', savedLanguage);
  Object.defineProperty(window.navigator, 'language', { configurable: true, value: navigatorLanguage });
  const requests = [];
  const errors = [];
  window.addEventListener('error', (event) => errors.push(event.error));
  window.structuredClone = structuredClone;
  window.ResizeObserver = class { observe() {} disconnect() {} };
  Object.defineProperty(window.document, 'fonts', { value: { ready: Promise.resolve() } });
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  window.HTMLElement.prototype.setPointerCapture = function () {};
  window.HTMLElement.prototype.hasPointerCapture = function () { return false; };
  window.HTMLElement.prototype.releasePointerCapture = function () {};
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: this.clientHeight };
  };
  const nativeTimeout = window.setTimeout.bind(window);
  window.setTimeout = (fn, delay, ...args) => nativeTimeout(fn, delay === 700 ? 5 : delay, ...args);
  Object.defineProperties(window.HTMLElement.prototype, {
    clientWidth: { get() { return this.id === 'preview-stage' ? 800 : Number.parseFloat(this.style.width) || 320; } },
    clientHeight: { get() { return this.id === 'preview-stage' ? 500 : Number.parseFloat(this.style.height) || 180; } },
    offsetWidth: { get() { return this.id === 'text-overlay' ? this.textContent.length * 5 : this.clientWidth; } },
    offsetHeight: { get() { return this.id === 'text-overlay' ? 20 : this.clientHeight; } },
  });
  const playback = new WeakMap();
  Object.defineProperties(window.HTMLMediaElement.prototype, {
    paused: { get() { return playback.get(this)?.paused ?? true; } },
    readyState: { get() { return 2; } },
    currentTime: {
      get() { return playback.get(this)?.time ?? 0; },
      set(time) {
        playback.set(this, { ...playback.get(this), time });
        queueMicrotask(() => {
          this.dispatchEvent(new window.Event('timeupdate'));
          this.dispatchEvent(new window.Event('seeked'));
        });
      },
    },
    src: {
      get() { return this.getAttribute('src') || ''; },
      set(value) {
        this.setAttribute('src', value);
        queueMicrotask(() => {
          this.dispatchEvent(new window.Event('loadedmetadata'));
          this.dispatchEvent(new window.Event('loadeddata'));
        });
      },
    },
  });
  window.HTMLMediaElement.prototype.load = function () {};
  window.HTMLMediaElement.prototype.pause = function () {
    playback.set(this, { ...playback.get(this), paused: true });
    this.dispatchEvent(new window.Event('pause'));
  };
  window.HTMLMediaElement.prototype.play = async function () {
    playback.set(this, { ...playback.get(this), paused: false });
    this.dispatchEvent(new window.Event('play'));
  };
  window.HTMLCanvasElement.prototype.getContext = () => ({
    drawImage() {}, strokeText() {}, fillText() {},
    measureText: (value) => ({ width: value.length * 8 }),
  });
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,AA==';
  window.fetch = async (url, options = {}) => {
    const call = {
      url, method: options.method || 'GET',
      body: typeof options.body === 'string' ? JSON.parse(options.body) : options.body || null,
      headers: options.headers, signal: options.signal,
    };
    requests.push(call);
    if (call.method === 'DELETE') {
      if (deleteExport && url.startsWith('/api/exports/')) return deleteExport(call);
      return { ok: true, json: async () => undefined };
    }
    if (url === '/api/media' || url === '/api/media/upload') return importResponse ? importResponse(call) : importError
      ? { ok: false, json: async () => ({ error: { code: 'VIDEO_UNAVAILABLE', message: 'Örnek erişim hatası' } }) }
      : { ok: true, json: async () => ({ ...media }) };
    if (url === '/api/exports') return { ok: true, json: async () => ({ id: 'test-export', status: 'queued' }) };
    if (url === '/api/exports/test-export') return pollError
      ? { ok: false, status: 503, json: async () => ({ error: { code: 'INTERNAL_ERROR', message: 'Geçici bağlantı hatası' } }) }
      : { ok: true, json: async () => ({
        id: 'test-export', status: exportStatus, progress: exportStatus === 'completed' ? 100 : 37,
        filename: 'sonuc.mov', downloadUrl: '/api/exports/test-export/file',
      }) };
    throw new Error(`Unexpected request: ${url}`);
  };
  window.eval(application);
  const find = (selector) => window.document.querySelector(selector);
  const change = (selector, value, type = 'change') => {
    const element = find(selector);
    if (element.type === 'checkbox') element.checked = value;
    else element.value = value;
    element.dispatchEvent(new window.Event(type, { bubbles: true }));
  };
  const submit = (selector) => find(selector).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  const chooseFile = (file) => {
    Object.defineProperty(find('#video-file'), 'files', { configurable: true, value: file ? [file] : [] });
    find('#video-file').dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const scrub = (time, total = media.duration) => {
    const x = time / total * find('#timeline').clientWidth;
    find('#ruler').dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: x }));
    find('#timeline').dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: x }));
  };
  const key = (key, extras = {}, target = window.document.body) => {
    target.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...extras }));
  };
  return { window, requests, errors, find, change, submit, chooseFile, scrub, key };
}

export async function until(predicate) {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(predicate(), 'Expected application state was not reached.');
}

export async function importVideo(app) {
  app.change('#video-url', 'https://www.instagram.com/reel/EXAMPLE/?tracking=removed', 'input');
  app.submit('#download-form');
  await until(() => !app.find('#open-export').disabled);
}
