import { test, expect, mock } from 'claude-code/testing';

test('large MCP catalogs remain usable within the native Select limit', async ($, on) => {
  const clock = mock.clock(on, {now:1000}); mock.store(on); mock.env(on, {HOME:'/fixture/user'});
  on('session.cwd', () => ({value:'/fixture/project'}));
  on('session.id', () => ({value:'large-mcp-catalog'}));
  on('session.version', () => ({value:{version:'2.1.299'}}));
  on('session.start', ($, e) => ({cwd:e.cwd}));
  on('command.register', () => ({value:{command:'ms'}}));
  on('tool.register', ($, e) => ({value:{tool:`mcp__mainsequence__${e.name}`}}));
  on('process.spawn', async function* ($, e) {
    const envelope = JSON.parse(e.input), q = envelope.request.request;
    const data = q.action === 'mcp-environments' ? [{uid:'env',name:'Production'}]
      : ['mcp-list','mcp-discover'].includes(q.action) ? [{resource_release_uid:'release',name:'CRM',mcp_connection:{organization_environment_uid:'env'}}]
      : q.action === 'mcp-tools' ? {tools:Array.from({length:130}, (_, i) => ({name:`crm_tool_${i}`,description:`Tool ${i}`,inputSchema:{type:'object'}}))} : {};
    yield {stream:'stdout',text:JSON.stringify({type:'result',id:envelope.id,result:{schemaVersion:1,action:q.action,status:'success',summary:'Ready',data}})+'\n'};
    return {value:{code:0,signal:null}};
  });
  await $.session.start({cwd:'/fixture/project',surface:'desktop',isInteractive:true});
  let ui = await $.ui.mount({plugin:'mainsequence',surface:'desktop',component:'Pane',requestId:'mainsequence',props:{}});
  await clock.settle(); await ui.press({key:'tab-Tools'}); await clock.settle();
  await ui.select({key:'mcp-environment',value:'env'}); await clock.settle();
  await ui.press({key:'mcp-open-release'}); await clock.settle();
  expect(await ui.find({key:'tool-crm_tool_129'})).toBeDefined();
  await ui.press({key:'toggle-tools-advanced'});
  expect(await ui.find({key:'mcp-tool'})).toBeDefined();
  await ui.press({key:'mcp-tool-next'}); await ui.press({key:'mcp-tool-next'});
  await ui.select({key:'mcp-tool',value:'crm_tool_129'});
  await ui.press({key:'mcp-tool-previous'});
  expect(await ui.find({key:'mcp-tool'})).toBeDefined();
  await ui.unmount();
  ui = await $.ui.mount({plugin:'mainsequence',surface:'desktop',component:'Pane',requestId:'mainsequence',props:{}});
  expect(await ui.find({key:'mcp-tool'})).toBeDefined();
  await ui.press({key:'tab-Home'}); await ui.press({key:'tab-Tools'});
  expect(await ui.find({key:'mcp-tool'})).toBeDefined();
  await ui.unmount();
});

test('setup keeps progress beside disabled controls across native pane remounts', async ($, on) => {
  const clock = mock.clock(on, {now:1000}); mock.store(on); mock.env(on, {HOME:'/fixture/user'});
  on('session.cwd', () => ({value:'/fixture/project'}));
  on('session.id', () => ({value:'setup-progress'}));
  on('session.version', () => ({value:{version:'2.1.299'}}));
  on('session.start', ($, e) => ({cwd:e.cwd}));
  on('command.register', () => ({value:{command:'ms'}}));
  let setups = 0;
  on('process.spawn', async function* ($, e, next) {
    const envelope = JSON.parse(e.input), q = envelope.request.request;
    if (q.action === 'setup') {
      setups++;
      yield {stream:'stdout',text:JSON.stringify({type:'progress',id:envelope.id,message:'Cloning the registered repository branch…'})+'\n'};
      await new Promise(resolve => next.signal.addEventListener('abort', resolve, {once:true}));
      return {value:{code:0,signal:null}};
    }
    const data = q.action === 'repositories' ? [{uid:'repo-1',code_repository_name:'Research',branches:[{repository_branch:'main'}]}]
      : q.action === 'local-repositories' ? [] : q.action === 'workspace-preferences' ? {backend:'https://fixture.example',baseDir:'/fixture/repos'} : {};
    yield {stream:'stdout',text:JSON.stringify({type:'result',id:envelope.id,result:{schemaVersion:1,action:q.action,status:'success',summary:'Ready',data}})+'\n'};
    return {value:{code:0,signal:null}};
  });
  await $.session.start({cwd:'/fixture/project',surface:'desktop',isInteractive:true});
  let ui = await $.ui.mount({plugin:'mainsequence',surface:'desktop',component:'Pane',requestId:'mainsequence',props:{}});
  await clock.settle(); await ui.press({key:'tab-Code'}); await clock.settle();
  await ui.press({key:'setup-repository-repo-1'}); await clock.settle();
  await ui.press({key:'setup'}); await ui.press({key:'confirm-action'}); await clock.settle();
  expect(await ui.find({type:'Text',text:'Cloning the registered repository branch…'})).toBeDefined();
  expect(await ui.find({key:'setup'})).toBeDefined();
  await ui.unmount();
  ui = await $.ui.mount({plugin:'mainsequence',surface:'desktop',component:'Pane',requestId:'mainsequence',props:{}});
  expect(await ui.find({type:'Text',text:'Cloning the registered repository branch…'})).toBeDefined();
  await ui.press({key:'tab-Settings'});
  expect(await ui.find({type:'Button',text:'View progress'})).toBeDefined();
  await ui.press({key:'tab-Code'}); await ui.press({key:'cancel-setup'}); await clock.settle();
  expect(await ui.find({type:'Text',text:'Setup cancelled'})).toBeDefined();
  expect(setups).toBe(1);
  await ui.unmount();
});

test('Projects renders native branch links and confirms local setup before opening Claude', async ($, on) => {
  const clock = mock.clock(on, {now:1000}); mock.store(on); mock.env(on, {HOME:'/fixture/user'});
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`, requests=[];
  const project={uid:id(1),name:'Rates project',description:'Research',organization_environment_uid:id(2),code_repository_branch_uids:[id(4)]};
  on('session.cwd',()=>({value:'/fixture/repository'}));on('session.id',()=>({value:'native-project-test'}));
  on('session.version',()=>({value:{version:'2.1.295'}}));on('session.start',($,e)=>({cwd:e.cwd}));
  on('ui.open',()=>({value:undefined}));on('command.register',()=>({value:{command:'ms'}}));
  // Selecting an environment registers the read-only deployment status tool.
  on('tool.register',($,e)=>({value:{tool:`mcp__mainsequence__${e.name}`}}));
  on('process.spawn',async function*($,e){
    const envelope=JSON.parse(e.input),q=envelope.request.request;requests.push(q);let data={};
    if(q.action==='workspace-preferences')data={backend:'https://fixture.example',baseDir:'/fixture/repos'};
    if(q.action==='mcp-environments')data=[{uid:id(2),name:'Research'}];
    if(q.action==='mcp-list'||q.action==='mcp-discover')data=[];
    if(q.action==='organization-projects')data={results:[project],count:1,limit:25,offset:0};
    if(q.action==='organization-project')data={project,branches:[{uid:id(4),code_repository_uid:id(3),code_repository_name:'Pricing',repository_branch:'develop',is_initialized:true}]};
    if(['organization-project-setup','read-project-workspace'].includes(q.action))data={root:'/fixture/repos/project',backend:'https://fixture.example',name:'Rates project',projectUid:id(1),environmentUid:id(2),repositories:[{repositoryUid:id(3),branchUid:id(4),name:'Pricing',path:'/fixture/repos/repositories/Pricing',branch:'develop'}]};
    yield {stream:'stdout',text:JSON.stringify({type:'result',id:envelope.id,result:{schemaVersion:1,action:q.action,status:'success',summary:'Fixture complete',data}})+'\n'};
    return {value:{code:0,signal:null}};
  });
  await $.session.start({cwd:'/fixture/repository',surface:'desktop',isInteractive:true});await clock.settle();
  const ui=await $.ui.mount({plugin:'mainsequence',surface:'desktop',component:'Pane',requestId:'mainsequence',props:{}});
  await ui.press({key:'tab-Projects'});await clock.settle();await ui.select({key:'mcp-environment',value:id(2)});await clock.settle();
  await ui.press({key:`project-${id(1)}`});await clock.settle();expect(await ui.find({key:`project-repository-${id(3)}`})).toBeDefined();
  expect(await ui.find({key:'projects-back'})).toBeDefined();
  await ui.press({key:`project-branch-${id(4)}`});await clock.settle();expect(requests.find(q=>q.action==='organization-project-link').branchUid).toBe(id(4));
  await ui.press({key:'project-setup'});expect(requests.filter(q=>q.action==='organization-project-setup')).toHaveLength(0);
  await ui.press({key:'confirm-action'});await clock.settle();expect(requests.find(q=>q.action==='open-project-workspace').root).toBe('/fixture/repos/project');
  expect(await ui.find({key:'project-open-local'})).toBeDefined();await ui.unmount();
});

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
  expect(await ui.find({ key: 'tab-Home' })).toBeDefined();
  expect(await ui.find({ key: 'tab-Settings' })).toBeDefined();
  await ui.press({ key: 'tab-Settings' });
  await ui.input({ key: 'field-backend', text: 'https://fixture.example' });
  await clock.settle();
  await ui.press({ key: 'auth-status' });
  await clock.settle();
  expect(requests).toContainEqual({ scope: 'devtools', request: { action: 'auth-status', backend: 'https://fixture.example', check: true } });
  expect(await ui.find({ type: 'Text', text: 'fixture@example.test' })).toBeDefined();
  await ui.press({ key: 'tab-Code' });
  await clock.settle();
  await ui.press({ key: 'code-open-session' });
  await clock.settle();
  await ui.press({ key: 'sync' });
  expect(requests.filter(value => value.request.action === 'sync')).toHaveLength(0);
  expect(await ui.find({ key: 'tab-Code' }), 'navigation stays visible while confirming').toBeDefined();
  await ui.press({ key: 'confirm-action' });
  await clock.settle();
  expect(requests).toContainEqual({ scope: 'devtools', request: { action: 'sync', root: '/fixture/project', backend: 'https://fixture.example' } });
  for (const tab of ['Projects', 'Tools', 'Activity', 'Home']) await ui.press({ key: `tab-${tab}` });
  for (const tab of ['General', 'Repositories', 'Current-Repository', 'MCP', 'Accounts']) expect(await ui.find({ key: `tab-${tab}` })).toBeUndefined();
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
  await ui.press({ key: 'tab-Settings' });
  await ui.press({ key: 'auth-status' });
  await clock.settle();
  expect(await ui.find({ type: 'Button', text: '1 running' }), 'the header counts the running operation').toBeDefined();
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
  await ui.press({key:'tab-Settings'}); await ui.press({key:'toggle-connection-actions'}); await ui.press({key:'refresh-token'}); await clock.settle();
  expect(requests.filter(r=>r.scope==='accounts')).toHaveLength(0);
  expect(requests.filter(r=>r.scope==='devtools'&&r.request.action==='login')).toHaveLength(1);
  await ui.unmount();
  expect(credentialAccesses).toBe(0);
});

test('Agents opens a bound session and fills the native draft without submitting', async ($, on) => {
  on('ui.render',{component:'SessionMode'},($,e)=>$.ui.resolve(e).Text({children:['Existing footer']}));
  on('ui.render',{component:'AbovePrompt'},($,e)=>$.ui.resolve(e).Text({children:['Existing composer content']}));
  on('ui.render',{component:'CommandOutput'},($,e)=>$.ui.resolve(e).Text({children:[e.props.text]}));
  for(const component of ['ToolUse','ToolResult']) on('ui.render',{component},($,e)=>$.ui.resolve(e).Text({children:['Existing tool content']}));
  const nativeIcon={"source":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><style>image{image-rendering:pixelated}.still{display:none}@media(prefers-reduced-motion:reduce){.moving{display:none}.still{display:inline}}</style><image class=\"moving\" width=\"32\" height=\"32\" href=\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAAgAAAAIAAAAAAAAAAAAAEABQAAkXtk1wAAACtJREFUeJztziEBAAAMBKHrX3qL8QaBp6tbSkBAQEBAQEBAQEBAQEBAYB14VA34akRQ3d4AAAAaZmNUTAAAAAEAAAAgAAAAIAAAAAAAAAAAAAEABQAACgiOAwAAAC5mZEFUAAAAAnic7c4xDQAAAAIg+5fWGD6MAiQ9ExAQEBAQEBAQEBAQEBAQeAcGV9H4atnNfE4AAAAASUVORK5CYII=\"/><image class=\"still\" width=\"32\" height=\"32\" href=\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAK0lEQVR4nO3OIQEAAAwEoetfeovxBoGnq1tKQEBAQEBAQEBAQEBAQEBgHXhUDfhqRFDd3gAAAABJRU5ErkJggg==\"/></svg>","stillSource":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><style>image{image-rendering:pixelated}</style><image class=\"\" width=\"32\" height=\"32\" href=\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAK0lEQVR4nO3OIQEAAAwEoetfeovxBoGnq1tKQEBAQEBAQEBAQEBAQEBgHXhUDfhqRFDd3gAAAABJRU5ErkJggg==\"/></svg>","animated":true};
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
    if(r.action==='agent-icons')data={account:'fixture@example.test',environmentUid:env,icons:{[uid]:{images:{idle:nativeIcon,thinking:nativeIcon},toolPoses:{},posesLoaded:r.includePoses}}};
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
  expect(await ui.find({key:`agent-icon-${uid}-20`})).toBeDefined();
  await ui.press({key:`agent-details-${uid}`});await clock.settle();
  expect(await ui.find({key:`agent-icon-${uid}-32`})).toBeDefined();
  await ui.press({key:'agents-back'});
  await ui.press({key:`agent-talk-${uid}`});await clock.settle();
  expect(draft).toBe('My question');
  expect(requests.filter(r=>r.action==='agent-readiness')).toHaveLength(1);
  expect(await ui.find({type:'Text',text:'Starting agent…'})).toBeDefined();
  expect(prompts).toHaveLength(0);
  preparationPending=false;releaseReadiness();await clock.settle();
  expect(prompts,JSON.stringify({requests,toasts,tools})).toHaveLength(0);
  expect(draft,JSON.stringify({requests,toasts,tools})).toBe('/ms @research-assistant My question');
  expect(requests.filter(r=>r.action==='agent-session')).toHaveLength(1);
  expect(requests.filter(r=>r.action==='agent-send')).toHaveLength(0);
  expect(tools.filter(t=>t.name.includes('introduce'))).toHaveLength(0);
  const reply=await $.command.run({command:'ms',args:'@research-assistant Explain my portfolio risk'});
  expect(JSON.stringify(reply)).toContain('I explain portfolio risk');
  expect(JSON.stringify(await $.command.run({command:'ms',args:`agent ${uid} Explain my portfolio risk`}))).toContain('I explain portfolio risk');
  const footer=await $.ui.mount({plugin:'mainsequence',surface:'desktop',component:'AbovePrompt',props:{}});
  expect(await footer.find({type:'Text',text:'Existing composer content'})).toBeDefined();
  expect(await footer.find({key:'agent-chat-activity'})).toBeDefined();
  expect(await footer.find({key:'agent-switch'})).toBeDefined();
  expect(await footer.find({key:`agent-icon-${uid}-24`})).toBeDefined();
  const output=await $.ui.mount({plugin:'mainsequence',surface:'desktop',component:'CommandOutput',props:{command:'ms',text:`mainsequence: ${reply.text}`}});
  expect(await output.find({key:`agent-icon-${uid}-20`})).toBeDefined();
  const tool=`mcp__mainsequence__${tools.find(t=>t.name.startsWith('ms_agent_send_')).name}`;
  for(const component of ['ToolUse','ToolResult']) {
    const row=await $.ui.mount({plugin:'mainsequence',surface:'desktop',component,props:{tool,tool_use_id:'fixture-call',isRunning:component==='ToolUse'}});
    expect(await row.find({key:`agent-icon-${uid}-20`})).toBeDefined();await row.unmount();
  }
  await output.unmount();await footer.unmount();
  expect(requests.filter(r=>r.action==='agent-send')).toHaveLength(2);
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

test('Ontology native startup adds both distinct repositories with exact saved paths', async ($, on) => {
  const clock=mock.clock(on,{now:1000});mock.env(on,{HOME:'/fixture/user'});
  const root='/fixture/project/Ontology',id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const workspace={root,backend:'https://fixture.example',name:'Ontology',projectUid:id(1),environmentUid:id(2),repositories:[
    {repositoryUid:id(3),branchUid:id(4),name:'Ontology',branch:'main',path:'/fixture/project/repositories/Ontology'},
    {repositoryUid:id(7),branchUid:id(8),name:'OntologyBackend',branch:'main',path:'/fixture/project/repositories/OntologyBackend'}]};
  const saved={root,backend:workspace.backend,projectUid:id(1),environmentUid:id(2),repositories:workspace.repositories.map(({repositoryUid,branchUid,branch,path})=>({repositoryUid,branchUid,branch,path}))};
  on('store.get',($,e)=>({value:e.key===`project-workspace:${root}`?saved:undefined}));
  on('session.cwd',()=>({value:root}));on('session.id',()=>({value:'ontology-membership-test'}));
  on('session.version',()=>({value:{version:'2.1.295'}}));on('session.start',($,e)=>({cwd:e.cwd}));
  on('ui.open',()=>({value:undefined}));on('command.register',()=>({value:{command:'ms'}}));
  const added=[];
  on('command.run',{command:'add-dir'},($,e)=>{added.push(e.args);return {text:`Added ${e.args} as a working directory for this session`};});
  on('process.spawn',async function*($,e){
    const envelope=JSON.parse(e.input),q=envelope.request.request;
    yield {stream:'stdout',text:JSON.stringify({type:'result',id:envelope.id,result:{schemaVersion:1,action:q.action,status:'success',summary:'Fixture complete',data:q.action==='read-project-workspace'?workspace:{}}})+'\n'};
    return {value:{code:0,signal:null}};
  });
  await $.session.start({cwd:root,surface:'desktop',isInteractive:true});await clock.settle();
  const ui=await $.ui.mount({plugin:'mainsequence',surface:'desktop',component:'Pane',requestId:'mainsequence',props:{}});
  expect(added).toEqual(workspace.repositories.map(r=>r.path));
  expect(await ui.find({type:'Text',text:'Ontology: 2 repository checkouts attached to this Claude session.'})).toBeDefined();await ui.unmount();
});

test('Deployments: the Code detail opens a recorded workflow run with its timeline, step rows and logs', async ($, on) => {
  const clock = mock.clock(on, {now:1000}); mock.store(on); mock.env(on, {HOME:'/fixture/user'});
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`, repo=id(30), branch=id(31), run=id(40), owned=id(41), requests=[];
  const step=(key,operation,state,startedAt,finishedAt,extra={})=>({id:key,key,operation,resourceKey:'crm',state,reason:'',needs:[],deploymentRunUid:null,startedAt,finishedAt,durationMs:startedAt&&finishedAt?Date.parse(finishedAt)-Date.parse(startedAt):null,error:'',...extra});
  const entry={kind:'workflow_run',uid:run,state:'failed',reason:'',workflowPath:'.mainsequence/workflows/crm-api.yaml',repositoryUid:repo,repositoryName:'MainSequenceCRMAPI',branchUid:branch,branchName:'main',commit:'3e3f54b',
    createdAt:'2026-10-21T07:59:51.000Z',startedAt:'2026-10-21T07:59:51.000Z',finishedAt:'2026-10-21T08:06:00.000Z',durationMs:369000,error:'',
    steps:[step('image','prepare_image','succeeded','2026-10-21T08:02:39.000Z','2026-10-21T08:05:08.000Z',{deploymentRunUid:owned}),
      step('deploy_api','deploy','failed','2026-10-21T08:05:09.000Z','2026-10-21T08:06:00.000Z',{needs:['image'],deploymentRunUid:owned,error:'rollout refused'})],
    deploymentRuns:[{uid:owned,targetLabel:'FastAPI',targetType:'resource_release',state:'failed',workflowStepKeys:['image','deploy_api'],createdAt:'2026-10-21T08:02:08.000Z',startedAt:'2026-10-21T08:02:08.000Z',finishedAt:'2026-10-21T08:06:00.000Z'}]};
  on('session.cwd',()=>({value:'/fixture/repos/acme/projects/MainSequenceCRMAPI-'+repo}));on('session.id',()=>({value:'native-deployments-test'}));
  on('session.version',()=>({value:{version:'2.1.299'}}));on('session.start',($,e)=>({cwd:e.cwd}));
  on('ui.open',()=>({value:undefined}));on('command.register',()=>({value:{command:'ms'}}));
  on('tool.register',($,e)=>({value:{tool:`mcp__mainsequence__${e.name}`}}));
  on('process.spawn',async function*($,e){
    const envelope=JSON.parse(e.input),q=envelope.request.request;requests.push(q);let data:any={};
    if(q.action==='workspace-preferences')data={backend:'https://fixture.example',baseDir:'/fixture/repos'};
    if(q.action==='auth-status')data={authenticated:true,username:'fixture@example.test'};
    if(q.action==='mcp-environments')data=[{uid:id(2),name:'Research'}];
    if(q.action==='mcp-list'||q.action==='mcp-discover')data=[];
    if(q.action==='repositories')data=[{uid:repo,code_repository_name:'MainSequenceCRMAPI',branches:[{uid:branch,repository_branch:'main'}]}];
    if(q.action==='workspace-profile')data={organization:'acme'};
    if(q.action==='local-repositories')data=[{name:'MainSequenceCRMAPI',path:'/fixture/repos/acme/projects/MainSequenceCRMAPI-'+repo,repositoryUid:repo,isGitRepository:true}];
    if(q.action==='status')data={project:{root:'/fixture/repos/acme/projects/MainSequenceCRMAPI-'+repo,branch:'main',commit:'3e3f54ba7c3e',projectType:'python'},capabilities:[]};
    if(q.action==='deployment-history')data={environmentUid:q.environmentUid,branchUid:q.codeRepositoryBranchUid||null,count:1,limit:q.limit,offset:q.offset,now:'2026-10-21T08:10:00.000Z',results:[entry]};
    if(q.action==='deployment-run')data={hidden:false,uid:q.runUid,kind:q.kind,run:entry,now:'2026-10-21T08:10:00.000Z'};
    if(q.action==='deployment-logs')data={hidden:false,runUid:q.runUid,stepUid:q.stepUid||null,cursor:q.cursor||null,nextCursor:null,complete:true,now:'2026-10-21T08:10:00.000Z',
      entries:[{sequence:0,timestamp:'2026-10-21T08:05:10.250Z',stepUid:null,source:'orchestrator',stream:'stdout',level:'info',text:'Rolling out FastAPI'},{sequence:1,timestamp:'2026-10-21T08:05:59.000Z',stepUid:null,source:'orchestrator',stream:'stderr',level:'error',text:'rollout refused'}]};
    yield {stream:'stdout',text:JSON.stringify({type:'result',id:envelope.id,result:{schemaVersion:1,action:q.action,status:'success',summary:'Fixture complete',data}})+'\n'};
    return {value:{code:0,signal:null}};
  });
  await $.session.start({cwd:'/fixture/repos/acme/projects/MainSequenceCRMAPI-'+repo,surface:'desktop',isInteractive:true});await clock.settle();
  const ui=await $.ui.mount({plugin:'mainsequence',surface:'desktop',component:'Pane',requestId:'mainsequence',props:{}});
  await ui.press({key:'tab-Tools'});await clock.settle();await ui.select({key:'mcp-environment',value:id(2)});await clock.settle();
  await ui.press({key:'tab-Code'});await clock.settle();await ui.press({key:'code-open-session'});await clock.settle();
  expect(await ui.find({key:`deploy-open-${run}`}),'the Deploys card shows the branch’s latest run').toBeDefined();
  expect(await ui.find({key:`deploy-rail-${run}`})).toBeDefined();
  expect(requests.find(q=>q.action==='deployment-history')?.codeRepositoryBranchUid).toBe(branch);
  await ui.press({key:`deploy-open-${run}`});await clock.settle();
  expect(await ui.find({key:'deploy-timeline'}),'the Svg timeline is drawn').toBeDefined();
  expect(await ui.find({key:'deploy-step-image'})).toBeDefined();
  expect(await ui.find({key:'deploy-step-deploy_api'})).toBeDefined();
  expect(await ui.find({type:'Text',text:'rollout refused'}),'the failed step record shows its error').toBeDefined();
  expect(await ui.find({key:'deploy-logs'}),'the selected step’s logs draw in a Code block').toBeDefined();
  expect(requests.find(q=>q.action==='deployment-logs')?.runUid).toBe(owned);
  expect(await ui.find({key:`deploy-open-${owned}`})).toBeDefined();
  await ui.press({key:'deploy-back'});await clock.settle();
  expect(await ui.find({key:'sync'}),'Back returns to the Code detail').toBeDefined();
  await ui.unmount();
});

test('a native pane opens on what another session left and shares its own section change', async ($, on) => {
  const backend = 'https://api.main-sequence.app', clock = mock.clock(on, {now:1000});
  const store: Record<string, unknown> = {
    settings: {backend, baseDir:'/shared/repos', commandCenterUrl:'https://cc.example'},
    'mcp-environments': {[backend]:'prod'},
    'pane-view': {tab:'Tools', context:`${backend}\nprod`, search:{project:'',agent:'',code:'',mcp:''}, codeFilter:'all', code:null, deploy:null,
      project:{uid:'',list:false,offset:0}, tools:{view:'list',uid:''}, agent:{uid:'',offset:0}},
    'activity:other-session': {at:1000, session:'other-project', operations:[{id:'other-1', title:'Install dependencies', context:'/work/other',
      label:'devtools · install', status:'running', progress:'Installing…', startedAt:900}]},
  };
  // What another session left in the plugin store, and what this one writes.
  const writes: string[] = [];
  on('store.get', ($, e) => ({value:store[e.key]}));
  on('store.keys', () => ({value:Object.keys(store)}));
  on('store.set', ($, e) => { store[e.key] = e.value; writes.push(e.key); return {value:undefined}; });
  on('store.delete', ($, e) => { delete store[e.key]; return {value:undefined}; });
  mock.env(on, {HOME:'/fixture/user'});
  on('session.cwd', () => ({value:'/fixture/project'}));
  on('session.id', () => ({value:'shared-native'}));
  on('session.version', () => ({value:{version:'2.1.299'}}));
  on('session.start', ($, e) => ({cwd:e.cwd}));
  on('command.register', () => ({value:{command:'ms'}}));
  on('tool.register', ($, e) => ({value:{tool:`mcp__mainsequence__${e.name}`}}));
  on('process.spawn', async function* ($, e) {
    const envelope = JSON.parse(e.input), q = envelope.request.request;
    const data = q.action === 'auth-status' ? {authenticated:true, username:'native@example.test'}
      : q.action === 'mcp-environments' ? [{uid:'research',name:'Research'},{uid:'prod',name:'Production'}]
      : q.action === 'mcp-catalog' ? {definitions:[], bindings:{}, unavailable:[], retained:0} : q.action === 'mcp-list' || q.action === 'mcp-discover' ? [] : {};
    yield {stream:'stdout',text:JSON.stringify({type:'result',id:envelope.id,result:{schemaVersion:1,action:q.action,status:'success',summary:'Ready',data}})+'\n'};
    return {value:{code:0,signal:null}};
  });
  await $.session.start({cwd:'/fixture/project',surface:'desktop',isInteractive:true});
  const ui = await $.ui.mount({plugin:'mainsequence',surface:'desktop',component:'Pane',requestId:'mainsequence',props:{}});
  await clock.settle(); await clock.advance(5000); await clock.settle();
  expect((await ui.find({key:'tab-Tools'}))?.props.variant).toBe('primary');
  expect((await ui.find({key:'mcp-environment'}))?.props.value).toBe('prod');
  expect((await ui.find({key:'tab-Activity'}))?.props.label).toBe('1 running');
  await ui.press({key:'tab-Activity'}); await clock.settle();
  expect((await ui.find({key:'activity-row-other-1'}))?.text).toContain('Session other-project');
  expect(await ui.find({key:'cancel-other-1'})).toBeUndefined();
  await ui.press({key:'tab-Settings'}); await clock.settle();
  expect((await ui.find({key:'field-baseDir'}))?.props.value).toBe('/shared/repos');
  expect((await ui.find({key:'field-commandCenterUrl'}))?.props.value).toBe('https://cc.example');
  await clock.advance(300); await clock.settle();
  expect(writes).toContain('pane-view');
  expect(writes).not.toContain('settings');
  await ui.unmount();
});
