'use strict';
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { nativeText } = require('../helpers');

// Every lifecycle boundary is driven by the test rather than a wall-clock sleep.
function controlledSpawner() {
  const children = [];
  function spawn() {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.pid = 987654; child.signals = []; child.exitCode = null; child.signalCode = null;
    child.kill = signal => { child.signals.push(signal); return true; };
    child.start = () => child.emit('spawn');
    child.output = () => child.stdout.write(nativeText);
    child.finish = (code = 0, signal = null) => {
      child.exitCode = code; child.signalCode = signal;
      child.emit('exit', code, signal);
      child.stdout.end(); child.stderr.end(); child.emit('close', code, signal);
    };
    children.push(child);
    return child;
  }
  return { spawn, children };
}
module.exports = { controlledSpawner };
