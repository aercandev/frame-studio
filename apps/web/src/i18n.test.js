import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { configureI18n, t, getLanguage, getLanguages, setLanguage, subscribe, translatePage, localizeError } from './i18n.js';
import { template } from './editor-template.js';

const config = JSON.parse(await readFile(new URL('./locales/config.json', import.meta.url), 'utf8'));
const english = JSON.parse(await readFile(new URL('./locales/en/ui.json', import.meta.url), 'utf8'));
const turkish = JSON.parse(await readFile(new URL('./locales/tr/ui.json', import.meta.url), 'utf8'));
const catalogs = { en: { ui: english, errors: { UNKNOWN: 'Please try again.', EXPIRED: 'Session expired.' } }, tr: { ui: turkish, errors: { UNKNOWN: 'Yeniden deneyin.', EXPIRED: 'Oturum süresi doldu.' } } };

test('English is the default; only supported saved preferences override JSON default', () => {
  configureI18n({ config, catalogs, storage: { getItem: () => null }, document: null });
  assert.equal(getLanguage(), 'en');
  assert.equal(t('ui.export'), 'Export');
  configureI18n({ config, catalogs, storage: { getItem: () => 'tr' }, document: null });
  assert.equal(t('ui.export'), 'Dışa aktar');
  configureI18n({ config, catalogs, storage: { getItem: () => 'unknown' }, document: null });
  assert.equal(getLanguage(), 'en');
});

test('configured defaults and additional language catalogs require only JSON data', () => {
  const jsonConfig = JSON.parse('{"defaultLanguage":"de","languages":[{"code":"en","label":"English"},{"code":"de","label":"Deutsch"}]}');
  const jsonMessages = JSON.parse('{"ui":{"export":"Exportieren","greeting":"Hallo {name}"}}');
  configureI18n({ config: jsonConfig, catalogs: { ...catalogs, de: jsonMessages }, storage: null, document: null });
  assert.equal(getLanguage(), 'de');
  assert.equal(t('ui.export'), 'Exportieren');
  assert.equal(t('ui.preview'), 'Preview');
  assert.equal(t('ui.greeting', { name: 'Ada' }), 'Hallo Ada');
  assert.deepEqual(getLanguages().map((entry) => entry.code), ['en', 'de']);
});

test('language switching persists safely and notifies subscribers without accepting unknown languages', () => {
  const writes = [];
  configureI18n({ config, catalogs, storage: { getItem: () => null, setItem: (...args) => writes.push(args) }, document: null });
  const changes = [];
  const unsubscribe = subscribe((code) => changes.push(code));
  assert.equal(setLanguage('tr'), true);
  assert.deepEqual(writes, [['frame-language', 'tr']]);
  assert.equal(setLanguage('bogus'), false);
  assert.deepEqual(changes, ['tr']);
  unsubscribe();
  setLanguage('en');
  assert.deepEqual(changes, ['tr']);
  configureI18n({ config, catalogs, storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }, document: null });
  assert.equal(getLanguage(), 'en');
  assert.doesNotThrow(() => setLanguage('tr'));
  assert.equal(getLanguage(), 'tr');
});

test('DOM translations preserve controls, values and icons and update accessibility metadata', (context) => {
  const dom = new JSDOM(`<html lang="tr"><head><meta data-i18n-content="ui.pageDescription"></head><body>${template}</body></html>`);
  context.after(() => dom.window.close());
  const doc = dom.window.document;
  configureI18n({ config, catalogs, storage: null, document: doc });
  translatePage();
  const input = doc.querySelector('#video-url');
  input.value = 'https://example.com/user-content.mp4';
  const icon = doc.querySelector('#open-export svg');
  assert.equal(doc.documentElement.lang, 'en');
  assert.equal(doc.querySelector('#open-export').textContent, 'Export');
  assert.equal(input.placeholder, 'Paste a video URL');
  assert.equal(doc.querySelector('#language-select').value, 'en');
  assert.equal(doc.querySelector('#export-language-select').value, 'en');
  assert.equal(doc.querySelector('#language-select').options.length, 2);
  assert.equal(doc.querySelector('#split-button').getAttribute('aria-label'), 'Split at playhead');
  setLanguage('tr');
  assert.equal(doc.documentElement.lang, 'tr');
  assert.equal(doc.querySelector('#open-export').textContent, 'Dışa aktar');
  assert.equal(doc.querySelector('#open-export svg'), icon);
  assert.equal(doc.querySelector('#video-url'), input);
  assert.equal(input.value, 'https://example.com/user-content.mp4');
  assert.equal(doc.querySelector('#language-select').value, 'tr');
  assert.equal(doc.querySelector('#export-language-select').value, 'tr');
  assert.equal(doc.querySelector('#split-button').title, 'Oynatma başlığında böl (Ctrl+B)');
  assert.equal(doc.querySelector('meta').content, turkish.pageDescription);
});

test('interpolation and translation values are rendered as text, never HTML', (context) => {
  const dom = new JSDOM('<p data-i18n="demo.message"></p><input data-i18n-placeholder="demo.message"><span data-i18n="ui.preview" data-i18n-params="broken"></span>');
  context.after(() => dom.window.close());
  const doc = dom.window.document;
  const data = { ...catalogs, en: { ...catalogs.en, demo: { message: 'Hello {name}' } } };
  configureI18n({ config, catalogs: data, storage: null, document: doc });
  const payload = '<img src=x onerror=alert(1)>';
  doc.querySelector('p').dataset.i18nParams = JSON.stringify({ name: payload });
  doc.querySelector('input').dataset.i18nParams = JSON.stringify({ name: payload });
  translatePage();
  assert.equal(doc.querySelector('p').textContent, `Hello ${payload}`);
  assert.equal(doc.querySelector('input').placeholder, `Hello ${payload}`);
  assert.equal(doc.querySelector('img'), null);
  assert.equal(doc.querySelector('span').textContent, 'Preview');
});

test('errors use translated codes or local metadata instead of raw backend strings', () => {
  configureI18n({ config, catalogs, storage: null, document: null });
  assert.equal(localizeError({ code: 'EXPIRED', message: 'Oturum süresi doldu.' }), 'Session expired.');
  assert.equal(localizeError({ code: 'UNRECOGNIZED', message: 'Sunucu ayrıntısı' }), 'Please try again.');
  assert.equal(localizeError({ i18nKey: 'ui.cancel', code: 'EXPIRED' }), 'Cancel');
  assert.equal(localizeError(new Error('raw detail'), 'ui.cancel'), 'Cancel');
});

test('static template keys have matching English and Turkish JSON entries', () => {
  assert.deepEqual(Object.keys(english).sort(), Object.keys(turkish).sort());
  for (const match of template.matchAll(/data-i18n(?:-[a-z-]+)?="ui\.([^" ]+)"/g)) {
    assert.equal(typeof english[match[1]], 'string', `Missing English ${match[1]}`);
    assert.equal(typeof turkish[match[1]], 'string', `Missing Turkish ${match[1]}`);
  }
});
