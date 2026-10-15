import { test, expect, mock } from 'claude-code/testing';

test('Desktop pane renders native controls and dispatches a confirmed structured action', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 });
  mock.store(on);
  mock.env(on, {HOME:'/fixture/user'});
  const requests = [];
  on('session.cwd', () => ({ value: '/fixture/project' }));
  on('session.id', () => ({ value: 'desktop-test-session' }));
  on('session.version', () => ({ value: { version: '2.1.295' } }));
  on('session.start', ($, e) => ({ cwd: e.cwd }));
  on('ui.open', () => ({ value: undefined }));
  on('command.register', () => ({ value: { command: 'ms' } }));
  on('process.spawn', async function* ($, e, next) {
    const envelope = JSON.parse(e.input);
    requests.push(envelope.request);
    yield { stream: 'stdout', text: JSON.stringify({ type: 'result', id: envelope.id,
      result: { schemaVersion: 1, action: envelope.request.request.action, status: 'success', summary: 'Fixture operation completed', data: envelope.request.request.action === 'workspace-preferences' ? {backend:'https://fixture.example',baseDir:'/fixture/user/mainsequence'} : envelope.request.request.action === 'auth-status' ? { backend: 'https://fixture.example', authenticated: true, username: 'fixture@example.test' } : {} } }) + '\n' };
    return { value: { code: 0, signal: null } };
  });
  await $.session.start({ cwd: '/fixture/project', surface: 'desktop', isInteractive: true });
  const ui = await $.ui.mount({ plugin: 'mainsequence', surface: 'desktop', component: 'Pane', requestId: 'mainsequence', props: {} });
  await clock.settle();
  expect(await ui.find({ key: 'tab-General' })).toBeDefined();
  await ui.input({ key: 'field-backend', text: 'https://fixture.example' });
  await clock.settle();
  await ui.press({ key: 'auth-status' });
  await clock.settle();
  expect(requests).toContainEqual({ scope: 'devtools', request: { action: 'auth-status', backend: 'https://fixture.example', check: true } });
  expect(await ui.find({ type: 'Text', text: 'fixture@example.test' })).toBeDefined();
  await ui.press({ key: 'tab-Current-Project' });
  await ui.press({ key: 'sync' });
  expect(requests.filter(value => value.request.action === 'sync')).toHaveLength(0);
  await ui.press({ key: 'confirm-action' });
  await clock.settle();
  expect(requests).toContainEqual({ scope: 'devtools', request: { action: 'sync', root: '/fixture/project', backend: 'https://fixture.example' } });
  for (const tab of ['Projects', 'MCP', 'Activity', 'General']) await ui.press({ key: `tab-${tab}` });
  expect(await ui.find({ key: 'tab-Accounts' })).toBeUndefined();
  expect(await ui.find({ key: 'more-tools' })).toBeUndefined();
  await ui.unmount();
});

test('Desktop cancellation closes a waiting native process stream without waiting for its next chunk', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 });
  mock.store(on); mock.env(on, {HOME:'/fixture/user'});
  let closed = false;
  on('session.cwd', () => ({ value: '/fixture/project' }));
  on('session.id', () => ({ value: 'cancel-test' }));
  on('session.version', () => ({ value: { version: '2.1.295' } }));
  on('session.start', ($, e) => ({ cwd: e.cwd }));
  on('ui.open', () => ({ value: undefined }));
  on('command.register', () => ({ value: { command: 'ms' } }));
  on('process.spawn', async function* ($, e, next) {
    if(JSON.parse(e.input).request.request.action==='workspace-preferences'){yield {stream:'stdout',text:JSON.stringify({type:'result',id:JSON.parse(e.input).id,result:{schemaVersion:1,status:'success',summary:'Defaults',data:{backend:'https://api.main-sequence.app',baseDir:'/fixture/user/mainsequence'}}})+'\n'};return {value:{code:0,signal:null}};}
    try {
      yield { stream: 'stdout', text: JSON.stringify({ type: 'progress', message: 'Fixture waiting' }) + '\n' };
      await new Promise(resolve => next.signal.addEventListener('abort', resolve, { once: true }));
      return { value: { code: 0, signal: null } };
    } finally { closed = true; }
  });
  await $.session.start({ cwd: '/fixture/project', surface: 'desktop', isInteractive: true });
  const ui = await $.ui.mount({ plugin: 'mainsequence', surface: 'desktop', component: 'Pane', requestId: 'mainsequence', props: {} });
  await clock.settle();
  await ui.press({ key: 'auth-status' });
  await clock.settle();
  await ui.press({ key: 'tab-Activity' });
  const cancel = await ui.find({ type: 'Button', text: 'Cancel operation' });
  expect(cancel, 'Cancel operation button exists').toBeDefined();
  await ui.press({ key: cancel.key });
  await clock.settle();
  expect(await ui.find({ type: 'Text', text: 'cancelled' }), 'Cancellation finishes before another process chunk arrives').toBeDefined();
  expect(closed).toBe(true);
  await ui.unmount();
});


test('MainSequence login uses shared auth while native Claude credentials remain untouched', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 }); mock.store(on);
  let credentialAccesses = 0; let signedIn = false; const requests = [];
  on('env.set', () => { credentialAccesses++; return { value: undefined }; });
  on('env.get', ($, e) => { if(e.name==='HOME' || e.key==='HOME') return {value:'/fixture/user'}; if(e.name==='USERPROFILE'||e.key==='USERPROFILE')return {value:undefined}; credentialAccesses++; return { value: undefined }; });
  on('fs.read', () => { credentialAccesses++; return { value: '' }; });
  on('process.run', () => { credentialAccesses++; return { value: { exitCode: 1, stdout: '', stderr: '' } }; });
  on('session.cwd', () => ({ value: '/fixture/project' }));
  on('session.id', () => ({ value: 'isolation-test' }));
  on('session.version', () => ({ value: { version: '2.1.295' } }));
  on('session.start', ($, e) => ({ cwd: e.cwd }));
  on('session.end', () => ({}));
  on('ui.open', () => ({ value: undefined }));
  on('command.register', () => ({ value: { command: 'ms' } }));
  on('process.spawn', async function* ($, e) {
    const envelope=JSON.parse(e.input); requests.push(envelope.request);
    if(envelope.request.request.action==='login')signedIn=true;
    yield {stream:'stdout',text:JSON.stringify({type:'result',id:envelope.id,result:{schemaVersion:1,action:envelope.request.request.action,status:'success',summary:'Fixture complete',data:{authenticated:signedIn,username:'fixture@example.test'}}})+'\n'};
    return {value:{code:0,signal:null}};
  });
  await $.session.start({cwd:'/fixture/project',surface:'desktop',isInteractive:true});
  await clock.settle();
  const ui=await $.ui.mount({plugin:'mainsequence',surface:'desktop',component:'Pane',requestId:'mainsequence',props:{}});
  await ui.press({key:'login'}); await clock.settle();
  expect(await ui.find({type:'Text',text:'fixture@example.test'})).toBeDefined();
  await ui.press({key:'toggle-connection-actions'}); await ui.press({key:'refresh-token'}); await clock.settle();
  expect(requests.filter(r=>r.scope==='accounts')).toHaveLength(0);
  expect(requests.filter(r=>r.scope==='devtools'&&r.request.action==='login')).toHaveLength(1);
  await ui.unmount();
  expect(credentialAccesses).toBe(0);
});
