import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { terminateProcessTree } from '../src/process-tree.js';

test('Windows cancellation terminates the worker tree without a shell or visible window', async () => {
  const calls = [];
  const child = { pid: 12345, kill() { assert.fail('Should use taskkill for the full Windows process tree.'); } };
  await terminateProcessTree(child, {
    platform: 'win32',
    spawnTerminator(command, args, options) {
      calls.push({ command, args, options });
      const terminator = new EventEmitter();
      queueMicrotask(() => terminator.emit('close', 0));
      return terminator;
    },
  });
  assert.match(calls[0].command, /taskkill\.exe$/);
  assert.deepEqual(calls[0].args, ['/PID', '12345', '/T', '/F']);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
});

test('non-Windows cancellation kills the owned downloader process group', async () => {
  const calls = [];
  await terminateProcessTree({
    pid: 123,
    kill() { assert.fail('Should terminate the full POSIX process group.'); },
  }, {
    platform: 'linux',
    killProcess(pid, signal) { calls.push({ pid, signal }); },
  });
  assert.deepEqual(calls, [{ pid: -123, signal: 'SIGKILL' }]);
});
