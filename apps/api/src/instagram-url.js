import { DownloadError } from './errors.js';

const hosts = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com']);

export function parseInstagramUrl(value) {
  const invalid = () => new DownloadError(
    'INVALID_URL',
    'Geçerli bir Instagram gönderi, Reels veya video bağlantısı girin.',
    400,
  );

  if (typeof value !== 'string' || value.length > 2048 || value.includes('\\')) {
    throw invalid();
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw invalid();
  }

  const match = url.pathname.match(/^\/(p|reel|tv)\/([A-Za-z0-9_-]{1,80})\/?$/);
  if (
    url.protocol !== 'https:'
    || !hosts.has(url.hostname)
    || url.username
    || url.password
    || url.port
    || !match
  ) {
    throw invalid();
  }

  return {
    url: `https://www.instagram.com/${match[1]}/${match[2]}/`,
    shortcode: match[2],
  };
}
