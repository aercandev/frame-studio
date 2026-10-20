export class DownloadError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.name = 'DownloadError';
    this.code = code;
    this.status = status;
  }
}

export function cancelledError() {
  return new DownloadError('CANCELLED', 'İndirme iptal edildi.', 499);
}

export function tooLargeError() {
  return new DownloadError('FILE_TOO_LARGE', 'Video yapılandırılmış indirme boyutu sınırını aşıyor.', 413);
}

export function unavailableError() {
  return new DownloadError(
    'DOWNLOADER_UNAVAILABLE',
    'İndirme aracı hazır değil. Sunucuda npm run setup:downloader komutunu çalıştırın.',
    503,
  );
}
