'use strict';
const { spawn } = require('node:child_process');
if (process.argv[2] === 'descendant') {
  process.on('SIGTERM', () => {});
  process.send?.({ ready: true, pid: process.pid });
  setInterval(() => {}, 1000);
} else {
  process.on('SIGTERM', () => {});
  const descendant = spawn(process.execPath, [__filename, 'descendant'], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  descendant.once('message', () => {
    process.stdout.write(JSON.stringify({ parent: process.pid, descendant: descendant.pid }) + '\n');
  });
  descendant.on('error', error => { process.stderr.write(error.message); process.exitCode = 1; });
  setInterval(() => {}, 1000);
}
