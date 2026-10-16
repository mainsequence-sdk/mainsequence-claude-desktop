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

test('Agents opens a bound session and fills the native draft without submitting', async ($, on) => {
  const clock=mock.clock(on,{now:1000});mock.store(on);mock.env(on,{HOME:'/fixture/user'});
  const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
  const env=id(1),uid=id(2),requests=[],prompts=[],toasts=[],tools=[]; let draft='My question'; let releaseReadiness; let preparationPending=true;
  const agent={uid,name:'Research assistant',description:'Explain risk',environmentUid:env,environmentName:'Research',repositoryBranch:'develop',runtimeState:'current',runtimeReleaseUid:id(5),responseKinds:['message'],skills:[]};
  on('session.cwd',()=>({value:'/fixture/project'}));on('session.id',()=>({value:'native-agent-test'}));
  on('session.version',()=>({value:{version:'2.1.295'}}));on('session.start',($,e)=>({cwd:e.cwd}));
  on('ui.open',()=>({value:undefined}));on('ui.toast',($,e)=>{toasts.push(e);return {value:undefined};});
  on('command.register',()=>({value:{command:'ms'}}));
  on('prompt.read',()=>({value:{text:draft,cursor:draft.length}}));
  on('prompt.fill',($,e)=>{draft=e.text;return {isFilled:true,text:draft,cursor:draft.length};});
  on('tool.call',{tool:'AskUserQuestion'},($,e)=>({result:{answers:{[e.questions[0].question]:'Send'}}}));
  on('tool.register',($,e)=>{tools.push(e);return {value:{tool:`mcp__mainsequence__${e.name}`}};});
  // Capture the submitted prompt before inference: this test never contacts a model or real agent.
  on('prompt.submit',($,e)=>{prompts.push(e);return {drop:'Captured by the isolated test; no inference runs.'};});
  on('process.spawn',async function*($,e){
    const envelope=JSON.parse(e.input),r=envelope.request.request;requests.push(r);let data={};
    if(r.action==='workspace-preferences')data={backend:'https://fixture.example',baseDir:'/fixture/user/mainsequence'};
    if(r.action==='auth-status')data={authenticated:true,username:'fixture@example.test'};
    if(r.action==='mcp-environments')data=[{uid:env,name:'Research'}];
    if(r.action==='agents-list')data={account:'fixture@example.test',results:[agent],count:1};
    if(r.action==='agent-get')data={account:'fixture@example.test',agent};
    if(r.action==='agent-session')data={account:'fixture@example.test',agent,sessionUid:id(3)};
    if(r.action==='agent-readiness'&&preparationPending){
      yield {stream:'stdout',text:JSON.stringify({type:'progress',id:envelope.id,message:'Starting agent…'})+'\n'};
      await new Promise(resolve=>{releaseReadiness=resolve;});
    }
    if(r.action==='agent-readiness')data={account:'fixture@example.test',agentUid:r.agentUid,sessionUid:r.sessionUid,ready:true};
    if(r.action==='agent-send')data={account:'fixture@example.test',agent,sessionUid:id(3),responseKind:'message',message:'I explain portfolio risk. Provide a portfolio identifier.'};
    yield {stream:'stdout',text:JSON.stringify({type:'result',id:envelope.id,result:{schemaVersion:1,action:r.action,status:'success',summary:'Fixture complete',data}})+'\n'};
    return {value:{code:0,signal:null}};
  });
  await $.session.start({cwd:'/fixture/project',surface:'desktop',isInteractive:true});await clock.settle();
  const ui=await $.ui.mount({plugin:'mainsequence',surface:'desktop',component:'Pane',requestId:'mainsequence',props:{}});
  await ui.press({key:'tab-Agents'});await clock.settle();
  await ui.select({key:'mcp-environment',value:env});await clock.settle();
  expect(await ui.find({key:`agent-${uid}`})).toBeDefined();
  await ui.press({key:`agent-talk-${uid}`});await clock.settle();
  expect(draft).toBe('My question');
  expect(requests.filter(r=>r.action==='agent-readiness')).toHaveLength(1);
  expect(await ui.find({type:'Text',text:'Starting agent…'})).toBeDefined();
  expect(prompts).toHaveLength(0);
  preparationPending=false;releaseReadiness();await clock.settle();
  expect(prompts,JSON.stringify({requests,toasts,tools})).toHaveLength(0);
  expect(draft,JSON.stringify({requests,toasts,tools})).toBe(`/ms agent ${uid} My question`);
  expect(requests.filter(r=>r.action==='agent-session')).toHaveLength(1);
  expect(requests.filter(r=>r.action==='agent-send')).toHaveLength(0);
  expect(tools.filter(t=>t.name.includes('introduce'))).toHaveLength(0);
  const reply=await $.command.run({command:'ms',args:`agent ${uid} Explain my portfolio risk`});
  expect(JSON.stringify(reply)).toContain('I explain portfolio risk');
  expect(requests.filter(r=>r.action==='agent-send')).toHaveLength(1);
  expect(requests.find(r=>r.action==='agent-send').waitForReady).toBe(true);
  expect(requests.find(r=>r.action==='agent-send').sessionUid).toBe(id(3));
  expect(requests.find(r=>r.action==='agent-send').message).toBe('Explain my portfolio risk');
  await ui.unmount();
});


test('Desktop footer survives pane unmount and reopens MainSequence while retaining the native footer', async ($, on) => {
  const opened = [];
  on('ui.open', ($, e) => { opened.push(e); return { value: undefined }; });
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e); return Text({ children: ['Existing session controls'] });
  });
  const footer = await $.ui.mount({ plugin: 'mainsequence', surface: 'desktop', component: 'SessionMode', props: { modes: [] } });
  expect(await footer.find({ type: 'Text', text: 'Existing session controls' })).toBeDefined();
  expect(await footer.find({ key: 'mainsequence-launcher' })).toBeDefined();
  await footer.press({ key: 'mainsequence-launcher' });
  expect(opened[0].id).toBe('mainsequence'); expect(opened[0].focus).toBe(true);
  const pane = await $.ui.mount({ plugin: 'mainsequence', surface: 'desktop', component: 'Pane', requestId: 'mainsequence', props: {} });
  // Desktop drops this render site when the user closes the pane.
  await pane.unmount();
  await footer.redraw({ modes: ['focus'] });
  expect(await footer.find({ key: 'mainsequence-launcher' })).toBeDefined();
  await footer.press({ key: 'mainsequence-launcher' });
  expect(opened).toHaveLength(2); expect(opened[1].id).toBe('mainsequence');
  await footer.unmount();
});
