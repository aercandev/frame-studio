import { lookup as dnsLookup } from 'node:dns/promises';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cancelledError, DownloadError } from './errors.js';

const DEFAULT_MAX_BYTES = Infinity;
const redirects = new Set([301, 302, 303, 307, 308]);
const blockedV4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blockedV4.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const blockedV6 = new BlockList();
for (const [address, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
]) blockedV6.addSubnet(address, prefix, 'ipv6');

const invalidUrl = () => new DownloadError(
  'INVALID_URL', 'Herkese açık bir HTTP veya HTTPS video dosyası bağlantısı girin.', 400,
);
const blockedUrl = () => new DownloadError(
  'URL_NOT_ALLOWED', 'Yerel, özel veya ayrılmış ağ adreslerinden video alınamaz.', 400,
);
const invalidMedia = () => new DownloadError(
  'INVALID_VIDEO', 'Bağlantı doğrudan bir video dosyası döndürmelidir. Web sayfası ve oynatma listeleri desteklenmiyor.', 422,
);
const networkError = () => new DownloadError(
  'SOURCE_UNAVAILABLE', 'Video bağlantısına ulaşılamadı. Bağlantının herkese açık ve geçerli olduğunu kontrol edin.', 422,
);

export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, 'ipv4');
  // Accept global unicast only. This also excludes IPv4-mapped/translated
  // addresses, NAT64, loopback, link-local, multicast and unique-local IPv6.
  return family === 6 && globalV6.check(address, 'ipv6') && !blockedV6.check(address, 'ipv6');
}

export function parsePublicVideoUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) throw invalidUrl();
  let url;
  try { url = new URL(value.trim()); } catch { throw invalidUrl(); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw invalidUrl();
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname) && !isPublicAddress(hostname)) throw blockedUrl();
  url.hash = '';
  return url;
}

function safeFilename(value) {
  let filename = String(value || 'video.bin').split(/[\\/]/).pop();
  filename = filename.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/[. ]+$/g, '').trim();
  if (!filename || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) filename = 'video.bin';
  return filename.slice(0, 180) || 'video.bin';
}

function filenameFromUrl(url) {
  let filename = url.pathname.split('/').pop();
  try { filename = decodeURIComponent(filename); } catch { /* Keep malformed escapes as a harmless display name. */ }
  return safeFilename(filename);
}

function abortScope(signal, timeoutMs) {
  const controller = new AbortController();
  const cancel = () => controller.abort(cancelledError());
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = Number.isFinite(timeoutMs) && timeoutMs > 0 ? setTimeout(() => controller.abort(new DownloadError(
    'IMPORT_TIMEOUT', 'Video içe aktarma zaman aşımına uğradı. Lütfen tekrar deneyin.', 504,
  )), timeoutMs) : undefined;
  return {
    signal: controller.signal,
    close() { clearTimeout(timer); signal?.removeEventListener('abort', cancel); },
  };
}

function waitForAbortable(promise, signal) {
  if (signal.aborted) {
    // The resolver may already have started; observe its eventual rejection
    // even when cancellation wins before listeners are installed.
    promise.catch(() => {});
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function contentIsDocument(headers) {
  const type = String(headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  return type.startsWith('text/') || /(?:json|xml|mpegurl)/.test(type);
}

function prefixIsDocument(prefix) {
  const text = prefix.toString('utf8').replace(/^\uFEFF/, '').trimStart();
  return /^(?:<!doctype|<html\b|<head\b|<body\b|<\?xml|<mpd\b|#extm3u\b|\{\s*"|\[\s*\{)/i.test(text);
}

/**
 * Reads with backpressure but intentionally never destroys the input on error.
 * An upload's IncomingMessage must stay usable so its HTTP response can carry
 * a JSON error instead of becoming an abruptly closed socket.
 */
function saveStream(readable, filePath, { signal, maxBytes, sniff = false }) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(filePath, { flags: 'wx' });
    let size = 0;
    let failure;
    let finished = false;
    let prefix = Buffer.alloc(0);
    const detach = () => {
      readable.pause();
      readable.removeListener('data', onData);
      readable.removeListener('end', onEnd);
      readable.removeListener('error', onError);
      readable.removeListener('aborted', onAborted);
      readable.removeListener('close', onClose);
      signal.removeEventListener('abort', onAbort);
      output.removeListener('drain', onDrain);
    };
    const fail = (error) => {
      if (failure || finished) return;
      failure = error;
      detach();
      output.destroy();
    };
    const onDrain = () => { if (!failure) readable.resume(); };
    const onData = (value) => {
      readable.pause();
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      size += chunk.length;
      if (size > maxBytes) {
        fail(new DownloadError('FILE_TOO_LARGE', 'Video yapılandırılmış içe aktarma boyutu sınırını aşıyor.', 413));
        return;
      }
      if (sniff && prefix.length < 512) {
        prefix = Buffer.concat([prefix, chunk.subarray(0, 512 - prefix.length)]);
        if (prefixIsDocument(prefix)) { fail(invalidMedia()); return; }
      }
      if (output.write(chunk)) readable.resume();
    };
    const onEnd = () => {
      if (size === 0) { fail(new DownloadError('EMPTY_VIDEO', 'Video dosyası boş.', 422)); return; }
      output.end();
    };
    const onError = () => fail(networkError());
    const onAborted = () => fail(cancelledError());
    const onClose = () => { if (!readable.readableEnded) onError(); };
    const onAbort = () => fail(signal.reason);
    output.on('error', () => {
      failure ??= new DownloadError('IMPORT_FAILED', 'Video dosyası kaydedilemedi.', 500);
      detach();
    });
    output.on('drain', onDrain);
    output.on('finish', () => { finished = true; });
    output.once('close', () => {
      detach();
      if (failure) reject(failure);
      else if (!finished) reject(networkError());
      else resolve(size);
    });
    readable.on('data', onData);
    readable.once('end', onEnd);
    readable.once('error', onError);
    readable.once('aborted', onAborted);
    readable.once('close', onClose);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    else if (readable.readableEnded || readable.destroyed) onEnd();
  });
}

export function createSourceImporter({
  tempRoot = tmpdir(), maxBytes = DEFAULT_MAX_BYTES, timeoutMs = 0,
  lookup = dnsLookup,
  request = (url, options, callback) => (url.protocol === 'https:' ? https : http).request(url, options, callback),
} = {}) {
  function checkLength(length) {
    if (length != null && /^\d+$/.test(String(length)) && Number(length) > maxBytes) {
      throw new DownloadError('FILE_TOO_LARGE', 'Video yapılandırılmış içe aktarma boyutu sınırını aşıyor.', 413);
    }
  }

  async function resolveAddress(url, signal) {
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const literalFamily = isIP(hostname);
    const addresses = literalFamily
      ? [{ address: hostname, family: literalFamily }]
      : await waitForAbortable(Promise.resolve().then(() => lookup(hostname, { all: true, verbatim: true })), signal);
    if (!Array.isArray(addresses) || !addresses.length) throw networkError();
    if (addresses.some(({ address }) => !isPublicAddress(address))) throw blockedUrl();
    return { address: addresses[0].address, family: isIP(addresses[0].address) };
  }

  function responseFor(url, address, signal) {
    return new Promise((resolve, reject) => {
      const req = request(url, {
        method: 'GET', agent: false, signal, autoSelectFamily: false,
        family: address.family, maxHeaderSize: 16 * 1024,
        // Retain the URL's hostname for HTTP Host, TLS SNI and certificate
        // verification. No second DNS lookup is allowed at socket creation.
        lookup(_hostname, options, callback) {
          if (typeof options === 'function') { callback = options; options = {}; }
          if (options?.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
        headers: { Accept: 'video/*, application/octet-stream;q=0.8', 'Accept-Encoding': 'identity' },
      }, resolve);
      req.on('error', reject);
      req.end();
    });
  }

  async function artifact(operation, externalSignal) {
    const scope = abortScope(externalSignal, timeoutMs);
    let directory;
    let cleanupPromise;
    const cleanup = () => {
      cleanupPromise ??= directory
        ? rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
        : Promise.resolve();
      return cleanupPromise;
    };
    try {
      if (scope.signal.aborted) throw scope.signal.reason;
      await mkdir(tempRoot, { recursive: true });
      directory = await mkdtemp(join(tempRoot, 'video-import-'));
      const filePath = join(directory, 'source.bin');
      const result = await operation(filePath, scope.signal);
      if (scope.signal.aborted) throw scope.signal.reason;
      return { filePath, ...result, cleanup };
    } catch (error) {
      await cleanup();
      if (scope.signal.aborted) throw scope.signal.reason;
      throw error instanceof DownloadError ? error : networkError();
    } finally {
      scope.close();
    }
  }

  function download(value, { signal } = {}) {
    return artifact(async (filePath, operationSignal) => {
      let url = parsePublicVideoUrl(value);
      for (let hop = 0; hop <= 5; hop += 1) {
        const address = await resolveAddress(url, operationSignal);
        if (operationSignal.aborted) throw operationSignal.reason;
        const response = await responseFor(url, address, operationSignal);
        try {
          if (redirects.has(response.statusCode)) {
            if (!response.headers.location || hop === 5) {
              throw new DownloadError('TOO_MANY_REDIRECTS', 'Video bağlantısı çok fazla veya geçersiz yönlendirme içeriyor.', 422);
            }
            url = parsePublicVideoUrl(new URL(response.headers.location, url).href);
            continue;
          }
          if (response.statusCode !== 200) throw networkError();
          if (contentIsDocument(response.headers)) throw invalidMedia();
          if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') throw invalidMedia();
          checkLength(response.headers['content-length']);
          const size = await saveStream(response, filePath, { signal: operationSignal, maxBytes, sniff: true });
          return { filename: filenameFromUrl(url), size };
        } finally {
          // Unlike uploads, this is an owned upstream stream; close it on
          // redirects, rejected metadata, size limits and cancellation.
          response.destroy();
        }
      }
      throw networkError();
    }, signal);
  }

  function upload(readable, { signal, filename, contentLength } = {}) {
    return artifact(async (filePath, operationSignal) => {
      try { checkLength(contentLength); } catch (error) { readable.pause(); throw error; }
      const size = await saveStream(readable, filePath, { signal: operationSignal, maxBytes, sniff: true });
      return { filename: safeFilename(filename), size };
    }, signal);
  }

  return { download, upload };
}
