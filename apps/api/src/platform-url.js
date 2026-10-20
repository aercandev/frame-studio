import { DownloadError } from './errors.js';
import { parseInstagramUrl } from './instagram-url.js';

const families = {
  instagram: ['instagram.com'],
  youtube: ['youtube.com', 'youtu.be'],
  x: ['x.com', 'twitter.com'],
};
const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const shortHosts = new Set(['youtu.be', 'www.youtu.be']);
const xHosts = new Set(['x.com', 'www.x.com', 'm.x.com', 'mobile.x.com',
  'twitter.com', 'www.twitter.com', 'm.twitter.com', 'mobile.twitter.com']);
const invalid = (platform) => new DownloadError('INVALID_URL', {
  instagram: 'Geçerli bir Instagram gönderi, Reels veya video bağlantısı girin.',
  youtube: 'Geçerli bir YouTube video veya Shorts bağlantısı girin. Kanal ve oynatma listesi sayfaları desteklenmez.',
  x: 'Geçerli bir X veya Twitter video gönderisi bağlantısı girin.',
}[platform] || 'Geçerli bir Instagram, YouTube veya X video bağlantısı girin.', 400);

// Recognize unsupported subdomains too, so a platform page can never fall
// through to the direct-file importer merely because its path is invalid.
export function identifyPlatform(value) {
  if (typeof value !== 'string') return null;
  let hostname;
  try { hostname = new URL(value.trim()).hostname; } catch { return null; }
  return Object.entries(families).find(([, roots]) =>
    roots.some((root) => hostname === root || hostname.endsWith(`.${root}`)))?.[0] || null;
}

export function parsePlatformUrl(value) {
  const platform = identifyPlatform(value);
  if (platform === 'instagram') {
    const instagram = parseInstagramUrl(value);
    return { platform, ...instagram, id: instagram.shortcode };
  }
  if (typeof value !== 'string' || value.length > 2048 || !platform) throw invalid(platform);
  const raw = value.trim();
  if (/[\\\u0000-\u0020\u007f]/.test(raw)) throw invalid(platform);
  let url;
  try { url = new URL(raw); } catch { throw invalid(platform); }
  // URL.port normalizes :443 away; reject explicit port syntax as well.
  const authority = raw.match(/^https:\/\/([^/?#]+)/i)?.[1];
  if (url.protocol !== 'https:' || !authority || authority.includes(':') ||
      url.username || url.password || url.port) throw invalid(platform);

  if (platform === 'youtube') {
    let id;
    if (shortHosts.has(url.hostname)) {
      id = url.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/)?.[1];
    } else if (youtubeHosts.has(url.hostname)) {
      if (/^\/watch\/?$/.test(url.pathname) && url.searchParams.getAll('v').length === 1) {
        const candidate = url.searchParams.get('v');
        if (/^[A-Za-z0-9_-]{11}$/.test(candidate)) id = candidate;
      } else {
        id = url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})\/?$/)?.[1];
      }
    }
    if (!id) throw invalid(platform);
    return { platform, id, url: `https://www.youtube.com/watch?v=${id}` };
  }

  const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15}|i\/web)\/status\/([0-9]{1,25})(?:\/video\/[1-9][0-9]*)?\/?$/);
  if (!xHosts.has(url.hostname) || !match) throw invalid(platform);
  const account = match[1] === 'i/web' ? 'i' : match[1];
  return { platform, id: match[2], url: `https://x.com/${account}/status/${match[2]}` };
}
