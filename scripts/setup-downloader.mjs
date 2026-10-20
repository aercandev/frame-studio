import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const toolsDirectory = path.join(root, '.tools');
const binaries = {
  'win32-x64': 'yt-dlp.exe',
  'win32-arm64': 'yt-dlp_arm64.exe',
  'win32-ia32': 'yt-dlp_x86.exe',
  'darwin-x64': 'yt-dlp_macos',
  'darwin-arm64': 'yt-dlp_macos',
  'linux-x64': 'yt-dlp_linux',
  'linux-arm64': 'yt-dlp_linux_aarch64',
};
const binary = binaries[`${process.platform}-${process.arch}`];
let temporaryFile;

async function fetchChecked(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'insta-downloader-setup' },
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub indirmesi başarısız: HTTP ${response.status}.`);
  }
  return response;
}

try {
  if (!binary) {
    throw new Error(
      `Bu platform için otomatik kurulum yok: ${process.platform}/${process.arch}. ` +
      'yt-dlp kurup YT_DLP_PATH ile dosya yolunu belirtin.',
    );
  }

  console.log('Resmî yt-dlp sürümü kontrol ediliyor…');
  const release = await (await fetchChecked(
    'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest',
  )).json();
  const tag = release.tag_name;
  if (typeof tag !== 'string' || !/^[\w.-]+$/.test(tag)) {
    throw new Error('GitHub geçerli bir sürüm bilgisi döndürmedi.');
  }
  const releaseUrl = `https://github.com/yt-dlp/yt-dlp/releases/download/${tag}`;
  console.log(`yt-dlp ${tag} indiriliyor (${binary})…`);
  const [checksumResponse, binaryResponse] = await Promise.all([
    fetchChecked(`${releaseUrl}/SHA2-256SUMS`),
    fetchChecked(`${releaseUrl}/${binary}`),
  ]);
  const checksums = await checksumResponse.text();
  const expected = checksums.split(/\r?\n/)
    .map((line) => /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim()))
    .find((match) => match?.[2] === binary)?.[1].toLowerCase();
  if (!expected) {
    throw new Error('İndirilecek dosyanın SHA-256 özeti bulunamadı.');
  }

  const bytes = Buffer.from(await binaryResponse.arrayBuffer());
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) {
    throw new Error('SHA-256 doğrulaması başarısız; indirilen dosya kurulmadı.');
  }

  await mkdir(toolsDirectory, { recursive: true });
  temporaryFile = path.join(toolsDirectory, `${randomUUID()}.download`);
  await writeFile(temporaryFile, bytes, { flag: 'wx', mode: 0o755 });
  if (process.platform !== 'win32') await chmod(temporaryFile, 0o755);
  const destination = path.join(
    toolsDirectory,
    process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp',
  );
  await rename(temporaryFile, destination);
  temporaryFile = undefined;
  console.log(`Kuruldu ve SHA-256 doğrulandı: yt-dlp ${tag}\n${destination}`);
} catch (error) {
  console.error(`yt-dlp kurulamadı: ${error.message}`);
  console.error('Bağlantınızı kontrol edip npm run setup:downloader komutunu tekrar çalıştırın.');
  process.exitCode = 1;
} finally {
  if (temporaryFile) await rm(temporaryFile, { force: true });
}
