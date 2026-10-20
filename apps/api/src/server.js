import { createApp } from './app.js';
import { createDownloader } from './downloader.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3001);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const downloader = createDownloader();
const app = createApp({ downloader });
const server = app.listen(port, host, () => {
  console.log(`Instagram downloader: http://${host}:${port}`);
});

server.requestTimeout = 0;
server.headersTimeout = 15_000;

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const closed = new Promise((resolve) => server.close(resolve));
  server.closeAllConnections();
  await app.locals.editor.shutdown();
  await downloader.shutdown();
  await closed;
  if (process.connected) process.disconnect();
}

function requestShutdown() {
  void shutdown().catch((error) => {
    console.error('Shutdown cleanup failed:', error);
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, requestShutdown);
process.on('message', (message) => {
  if (message?.type === 'shutdown') requestShutdown();
});
