'use strict';

const STATES = Object.freeze(['queued', 'running', 'cancelling', 'completed', 'cancelled', 'timed_out', 'failed']);
const TERMINAL = new Set(['completed', 'cancelled', 'timed_out', 'failed']);
const ALLOWED = Object.freeze({
  queued: Object.freeze(['running', 'cancelled', 'failed']),
  running: Object.freeze(['cancelling', 'completed', 'timed_out', 'failed']),
  cancelling: Object.freeze(['cancelled', 'timed_out', 'failed']),
  completed: Object.freeze([]), cancelled: Object.freeze([]), timed_out: Object.freeze([]), failed: Object.freeze([]),
});
function canTransition(from, to) { return Object.hasOwn(ALLOWED,from) && ALLOWED[from].includes(to); }
/** Invalid and repeated transitions are non-mutating; a terminal outcome is immutable. */
function transition(run, to) {
  if (!canTransition(run.status, to)) return false;
  run.status = to;
  return true;
}
function publicStatus(status) { return status === 'queued' ? 'starting' : status === 'cancelling' ? 'running' : status; }
module.exports = { STATES, TERMINAL, ALLOWED, canTransition, transition, publicStatus };
