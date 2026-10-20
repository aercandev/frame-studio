// A small, DOM-safe translator. Catalog loading stays separate so the same
// behavior can be exercised without a browser bundler.
export const LANGUAGE_STORAGE_KEY = 'frame-language';
let i18nCatalogs = {};
let i18nLanguages = [];
let i18nLanguage = 'en';
let i18nDefault = 'en';
let i18nStorage;
let i18nDocument;
const i18nListeners = new Set();

function storedLanguage() {
  try { return i18nStorage?.getItem(LANGUAGE_STORAGE_KEY); } catch { return null; }
}
function messageAt(locale, key) {
  let value = i18nCatalogs[locale];
  for (const part of key.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return typeof value === 'string' ? value : undefined;
}
function resolveMessage(key) {
  return messageAt(i18nLanguage, key) ?? messageAt('en', key) ?? messageAt(i18nDefault, key);
}
function syncDocumentLanguage() {
  if (!i18nDocument?.documentElement) return;
  i18nDocument.documentElement.lang = i18nLanguage;
  i18nDocument.documentElement.dir = i18nLanguages.find((entry) => entry.code === i18nLanguage)?.dir === 'rtl' ? 'rtl' : 'ltr';
}

export function configureI18n(options = {}) {
  const config = options.config || {};
  i18nCatalogs = options.catalogs || {};
  i18nLanguages = (config.languages || []).filter((entry, index, entries) =>
    typeof entry?.code === 'string' && typeof entry.label === 'string' &&
    Object.hasOwn(i18nCatalogs, entry.code) && entries.findIndex((other) => other.code === entry.code) === index
  ).map((entry) => ({ ...entry }));
  if (!i18nLanguages.length && Object.hasOwn(i18nCatalogs, 'en')) i18nLanguages = [{ code: 'en', label: 'English' }];
  i18nDefault = i18nLanguages.some((entry) => entry.code === config.defaultLanguage)
    ? config.defaultLanguage : i18nLanguages.find((entry) => entry.code === 'en')?.code || i18nLanguages[0]?.code || 'en';
  i18nDocument = Object.hasOwn(options, 'document') ? options.document : globalThis.document;
  try { i18nStorage = Object.hasOwn(options, 'storage') ? options.storage : globalThis.localStorage; } catch { i18nStorage = undefined; }
  const remembered = storedLanguage();
  i18nLanguage = i18nLanguages.some((entry) => entry.code === remembered) ? remembered : i18nDefault;
  syncDocumentLanguage();
  return i18nLanguage;
}

export function t(key, params = {}) {
  const message = resolveMessage(key) ?? key;
  return message.replace(/\{([A-Za-z0-9_]+)\}/g, (token, name) =>
    Object.hasOwn(params, name) ? String(params[name]) : token);
}
export function getLanguage() { return i18nLanguage; }
export function getLanguages() { return i18nLanguages.map((entry) => ({ ...entry })); }
export function subscribe(callback) {
  i18nListeners.add(callback);
  return () => i18nListeners.delete(callback);
}
export function setLanguage(code) {
  if (!i18nLanguages.some((entry) => entry.code === code)) return false;
  const changed = i18nLanguage !== code;
  i18nLanguage = code;
  try { i18nStorage?.setItem(LANGUAGE_STORAGE_KEY, code); } catch { /* In-memory switching still works. */ }
  syncDocumentLanguage();
  translatePage();
  if (changed) for (const callback of i18nListeners) callback(code);
  return true;
}

export function translatePage(root = i18nDocument) {
  if (!root?.querySelectorAll) return;
  const attributes = ['aria-label', 'title', 'placeholder', 'alt', 'content'];
  const selector = ['[data-i18n]', ...attributes.map((name) => `[data-i18n-${name}]`)].join(',');
  const nodes = [...root.querySelectorAll(selector)];
  if (root.matches?.(selector)) nodes.unshift(root);
  for (const element of nodes) {
    let params = {};
    try {
      const parsed = JSON.parse(element.getAttribute('data-i18n-params') || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) params = parsed;
    } catch { /* An invalid parameter binding must not break the page. */ }
    const textKey = element.getAttribute('data-i18n');
    if (textKey) element.textContent = t(textKey, params);
    for (const attribute of attributes) {
      const key = element.getAttribute(`data-i18n-${attribute}`);
      if (key) element.setAttribute(attribute, t(key, params));
    }
  }
  for (const select of root.querySelectorAll('[data-language-select]')) {
    if (select.options.length !== i18nLanguages.length || i18nLanguages.some((entry, index) => select.options[index]?.value !== entry.code || select.options[index]?.textContent !== entry.label)) {
      select.replaceChildren(...i18nLanguages.map((entry) => {
        const option = select.ownerDocument.createElement('option');
        option.value = entry.code; option.textContent = entry.label;
        return option;
      }));
    }
    select.value = i18nLanguage;
  }
  syncDocumentLanguage();
}

export function localizeError(error, fallbackKey = 'errors.UNKNOWN') {
  if (error?.i18nKey && resolveMessage(error.i18nKey) !== undefined) return t(error.i18nKey, error.i18nParams || {});
  if (error?.code && resolveMessage(`errors.${error.code}`) !== undefined) return t(`errors.${error.code}`, error.i18nParams || {});
  return t(fallbackKey);
}
