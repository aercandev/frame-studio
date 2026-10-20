import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const children = [];
let stopping = false;

function run(name, args, cwd, cooperative = false) {
  const child = spawn(process.execPath, args, {
    cwd,
    stdio: cooperative ? ['inherit', 'inherit', 'inherit', 'ipc'] : 'inherit',
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  children.push({ child, cooperative });
  child.on('error', (error) => {
    console.error(`${name} başlatılamadı: ${error.message}`);
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`${name} kapandı; geliştirme sunucuları durduruluyor.`);
      stop(code ?? 1);
    }
  });
}

function terminateTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already stopped. */ }
  }
}

function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  for (const { child, cooperative } of children) {
    if (!child.pid) continue;
    if (cooperative && child.connected) {
      child.send({ type: 'shutdown' }, (error) => {
        if (error) terminateTree(child);
      });
      const fallback = setTimeout(() => terminateTree(child), 10_000);
      fallback.unref();
      child.once('exit', () => clearTimeout(fallback));
    } else {
      terminateTree(child);
    }
  }
  process.exitCode = exitCode;
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

run('API', ['apps/api/src/server.js'], root, true);
run('Web', [vite, '--host', '127.0.0.1'], path.join(root, 'apps/web'));
