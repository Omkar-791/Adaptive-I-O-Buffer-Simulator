'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {STATES,TERMINAL,ALLOWED,canTransition,transition,publicStatus}=require('../src/run-lifecycle');
// Independent oracle from the Phase 3 specification, not the implementation table.
const expectedGraph={
  queued:['running','cancelled','failed'],
  running:['cancelling','completed','timed_out','failed'],
  cancelling:['cancelled','timed_out','failed'],
  completed:[],cancelled:[],timed_out:[],failed:[],
};
const expectedStates=Object.keys(expectedGraph);
const expectedTerminal=['completed','cancelled','timed_out','failed'];

for(const from of expectedStates)for(const to of expectedStates) {
  test(`lifecycle ${from} -> ${to} is ${expectedGraph[from].includes(to)?'allowed':'forbidden'}`,()=>{
    const run={status:from};
    const allowed=expectedGraph[from].includes(to);
    assert.equal(canTransition(from,to),allowed);
    assert.equal(transition(run,to),allowed);
    assert.equal(run.status,allowed?to:from);
    assert.equal(transition(run,run.status),false,'repeat must not change state');
    if(expectedTerminal.includes(run.status)) {
      const final=run.status;
      for(const state of expectedStates)assert.equal(transition(run,state),false);
      assert.equal(run.status,final);
    }
  });
}
test('unknown states cannot enter the lifecycle and public statuses remain compatible',()=>{
  assert.deepEqual(STATES,expectedStates);
  assert.deepEqual(ALLOWED,expectedGraph);
  assert.deepEqual([...TERMINAL],expectedTerminal);
  assert.equal(canTransition('unknown','running'),false);
  assert.equal(canTransition('constructor','running'),false);
  assert.equal(canTransition('__proto__','running'),false);
  assert.equal(canTransition('queued','unknown'),false);
  assert.equal(publicStatus('queued'),'starting');
  assert.equal(publicStatus('cancelling'),'running');
  for(const status of ['running',...TERMINAL])assert.equal(publicStatus(status),status);
});
