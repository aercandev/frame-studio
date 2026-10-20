import languageConfig from './locales/config.json';

// Vite discovers every locale/namespace JSON file in development and at build
// time. Adding a language requires JSON files and a config entry, not JS edits.
const localeModules = import.meta.glob('./locales/*/*.json', { eager: true, import: 'default' });
export const config = languageConfig;
export const catalogs = {};
for (const [path, messages] of Object.entries(localeModules)) {
  const [, locale, namespace] = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/);
  catalogs[locale] ||= {};
  catalogs[locale][namespace] = messages;
}
