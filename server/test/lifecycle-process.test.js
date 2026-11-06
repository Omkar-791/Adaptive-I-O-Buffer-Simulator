'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { once } = require('node:events');
const { createTermination } = require('../src/process-termination');

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

test('real owned process tree terminates on the current platform, not merely the direct child', { timeout: 15000 }, async t => {
  const child = spawn(process.execPath, [path.join(__dirname, 'fixtures/phase3-process-tree.js')], {
    detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const operation = createTermination(child, { graceMs: 100, forceWaitMs: 3000, tree: true });
  let ids;
  const lines = createInterface({ input: child.stdout });
  const cleanup = async () => {
    lines.close();
    if (isAlive(child.pid)) await operation.stop();
    // Only PIDs produced by this fixture are touched; no process-name matching.
    if (ids?.descendant && isAlive(ids.descendant)) try { process.kill(ids.descendant, 'SIGKILL'); } catch {}
    if (isAlive(child.pid)) child.kill('SIGKILL');
    operation.dispose();
  };
  t.after(cleanup);
  const ready = once(lines, 'line');
  const failed = once(child, 'error').then(([error]) => Promise.reject(error));
  let deadline;
  try {
    const [line] = await Promise.race([ready, failed, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Owned process tree did not signal readiness')), 5000); })]);
    ids = JSON.parse(line);
  } finally { clearTimeout(deadline); }
  assert.equal(ids.parent, child.pid);
  assert.ok(Number.isSafeInteger(ids.descendant));
  assert.equal(isAlive(ids.parent), true); assert.equal(isAlive(ids.descendant), true);
  const first = operation.stop();
  assert.equal(operation.stop(), first, 'Repeated stop shares the operation');
  const outcome = await first;
  assert.equal(outcome.confirmed, true, JSON.stringify(outcome));
  assert.equal(outcome.treeRequested, true);
  assert.equal(isAlive(ids.parent), false, 'Direct process survived a confirmed close');
  assert.equal(isAlive(ids.descendant), false, 'Descendant survived the tree termination');
  operation.dispose(); operation.dispose();
});
