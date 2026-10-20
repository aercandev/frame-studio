import { spawn } from 'node:child_process';
import { join } from 'node:path';

// The standalone Windows yt-dlp build has a PyInstaller worker process.
// Killing only its parent leaves that worker and its open pipes running.
export function terminateProcessTree(child, {
  platform = process.platform,
  spawnTerminator = spawn,
  killProcess = process.kill,
} = {}) {
  if (!child.pid) return Promise.resolve();
  if (platform !== 'win32') {
    try {
      // The downloader starts as a dedicated process group on POSIX, so its
      // standalone executable's worker is stopped along with the parent.
      killProcess(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') child.kill('SIGKILL');
    }
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const taskkill = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
    let terminator;
    try {
      terminator = spawnTerminator(taskkill, ['/PID', String(child.pid), '/T', '/F'], {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch {
      child.kill('SIGKILL');
      resolve();
      return;
    }
    terminator.once('error', () => {
      child.kill('SIGKILL');
      resolve();
    });
    terminator.once('close', (code) => {
      if (code !== 0) child.kill('SIGKILL');
      resolve();
    });
  });
}
