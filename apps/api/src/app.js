import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDownloader } from './downloader.js';
import { DownloadError } from './errors.js';
import { createEditor } from './editor.js';

export function createApp({
  downloader = createDownloader(),
  webDist = fileURLToPath(new URL('../../web/dist/', import.meta.url)),
  logger = console,
  editor = createEditor({ downloader, logger }),
} = {}) {
  const app = express();
  app.locals.editor = editor;
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  // Timeline exports contain a sequence of edit decisions, while import
  // requests only contain a URL. Keep their JSON budgets separate from video
  // uploads, whose bytes stream directly to disk.
  app.post('/api/exports', express.json({ limit: '1mb' }), (req, res) => {
    res.status(202).json(editor.createExport(req.body));
  });
  app.use(express.json({ limit: '4kb' }));

  app.get('/api/health', async (_req, res) => {
    res.json({ status: 'ok', downloader: await downloader.health() });
  });

  app.post('/api/download', async (req, res) => {
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableFinished) controller.abort();
    };
    res.once('close', onClose);
    let artifact;
    try {
      artifact = await downloader.download(req.body?.url, { signal: controller.signal });
      if (controller.signal.aborted) return;
      res.type('video/mp4');
      await new Promise((resolve, reject) => {
        res.download(artifact.filePath, artifact.filename, {
          acceptRanges: false,
          cacheControl: false,
          lastModified: false,
        }, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    } finally {
      res.off('close', onClose);
      await artifact?.cleanup();
    }
  });

  app.post('/api/media', async (req, res) => {
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableFinished) controller.abort();
    };
    res.once('close', onClose);
    try {
      const media = await editor.importMedia(req.body?.url, { signal: controller.signal });
      if (controller.signal.aborted) {
        await editor.deleteMedia(media.id);
        return;
      }
      res.status(201).json(media);
    } finally {
      res.off('close', onClose);
    }
  });

  app.post('/api/media/upload', async (req, res) => {
    const contentType = (req.get('Content-Type') || '').split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'application/octet-stream' && !/^video\/[a-z0-9.+-]+$/.test(contentType)) {
      throw new DownloadError('INVALID_UPLOAD_TYPE', 'Video dosyasını doğrudan dosya gövdesi olarak gönderin.', 415);
    }
    if (req.get('Content-Encoding') && req.get('Content-Encoding').toLowerCase() !== 'identity') {
      throw new DownloadError('INVALID_UPLOAD_TYPE', 'Sıkıştırılmış istek gövdesi desteklenmiyor.', 415);
    }
    let filename;
    try {
      filename = decodeURIComponent(req.get('X-File-Name') || 'video.mp4');
    } catch {
      throw new DownloadError('INVALID_FILENAME', 'Dosya adı okunamadı. Dosyayı yeniden seçin.', 400);
    }
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableFinished) controller.abort();
    };
    res.once('close', onClose);
    // IncomingMessage can emit its error after a disconnected upload's stream
    // consumer has detached. Keep a one-shot listener for that late error.
    req.once('error', () => controller.abort());
    try {
      const media = await editor.uploadMedia(req, {
        signal: controller.signal, filename, contentLength: req.get('Content-Length'),
      });
      if (controller.signal.aborted) {
        await editor.deleteMedia(media.id);
        return;
      }
      res.status(201).json(media);
    } finally {
      res.off('close', onClose);
    }
  });

  app.post('/api/media/:mediaId/voiceovers', async (req, res) => {
    const contentType = (req.get('Content-Type') || '').split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'application/octet-stream' && !/^(audio|video)\/[a-z0-9.+-]+$/.test(contentType)) {
      throw new DownloadError('INVALID_UPLOAD_TYPE', 'Ses kaydını doğrudan dosya gövdesi olarak gönderin.', 415);
    }
    if (req.get('Content-Encoding') && req.get('Content-Encoding').toLowerCase() !== 'identity') {
      throw new DownloadError('INVALID_UPLOAD_TYPE', 'Sıkıştırılmış istek gövdesi desteklenmiyor.', 415);
    }
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableFinished) controller.abort();
    };
    res.once('close', onClose);
    req.once('error', () => controller.abort());
    try {
      const voice = await editor.uploadVoiceover(req.params.mediaId, req, {
        signal: controller.signal, contentLength: req.get('Content-Length'),
      });
      if (controller.signal.aborted) {
        await editor.deleteVoiceover(req.params.mediaId, voice.id);
        return;
      }
      res.status(201).json(voice);
    } finally {
      res.off('close', onClose);
    }
  });

  app.get('/api/media/:mediaId/voiceovers/:id/file', async (req, res) => {
    const voice = editor.voiceoverFile(req.params.mediaId, req.params.id);
    try {
      res.type('audio/mp4');
      await new Promise((resolve, reject) => {
        res.sendFile(voice.filePath, {
          acceptRanges: true, cacheControl: false, lastModified: false,
        }, (error) => error ? reject(error) : resolve());
      });
    } finally {
      await voice.release();
    }
  });

  app.delete('/api/media/:mediaId/voiceovers/:id', async (req, res) => {
    await editor.deleteVoiceover(req.params.mediaId, req.params.id);
    res.status(204).end();
  });

  app.get('/api/media/:id/file', async (req, res) => {
    const media = editor.mediaFile(req.params.id);
    try {
      res.type('video/mp4');
      await new Promise((resolve, reject) => {
        res.sendFile(media.filePath, {
          acceptRanges: true, cacheControl: false, lastModified: false,
        }, (error) => error ? reject(error) : resolve());
      });
    } finally {
      await media.release();
    }
  });

  app.delete('/api/media/:id', async (req, res) => {
    await editor.deleteMedia(req.params.id);
    res.status(204).end();
  });

  app.get('/api/exports/:id', (req, res) => {
    res.json(editor.exportStatus(req.params.id));
  });

  app.get('/api/exports/:id/file', async (req, res) => {
    const artifact = editor.exportFile(req.params.id);
    try {
      res.type(artifact.contentType);
      await new Promise((resolve, reject) => {
        res.download(artifact.filePath, artifact.filename, {
          acceptRanges: true, cacheControl: false, lastModified: false,
        }, (error) => error ? reject(error) : resolve());
      });
    } finally {
      await artifact.release();
    }
  });

  app.delete('/api/exports/:id', async (req, res) => {
    await editor.deleteExport(req.params.id);
    res.status(204).end();
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API adresi bulunamadı.' } });
  });

  if (webDist && existsSync(webDist)) {
    app.use(express.static(webDist));
  }

  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (res.destroyed) return;
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Geçerli bir JSON isteği gönderin.' } });
    }
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'REQUEST_TOO_LARGE', message: 'İstek boyutu çok büyük.' } });
    }
    if (error instanceof DownloadError) {
      if (error.code === 'SERVER_BUSY') res.set('Retry-After', '10');
      return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    logger.error('Download request failed:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.' },
    });
  });

  return app;
}
