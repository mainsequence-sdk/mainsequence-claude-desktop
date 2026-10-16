const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const source = path.resolve(__dirname, '../manifests/claude/hooks/register.mjs');
const load = () => import(pathToFileURL(source).href);
// WebCrypto completes on a worker thread in supported Node 22. Drain the real
// digest promises as well as microtasks; a fixed number of immediates can race them.
const pendingDigests = new Set();
const digest = crypto.subtle.digest.bind(crypto.subtle);
test.mock.method(crypto.subtle, 'digest', (...args) => {
  const promise = digest(...args); pendingDigests.add(promise);
  promise.then(() => pendingDigests.delete(promise), () => pendingDigests.delete(promise));
  return promise;
});
const flush = async () => {
  for (let i = 0; i < 8; i++) {
    await new Promise(resolve => setImmediate(resolve));
    if (pendingDigests.size) await Promise.all([...pendingDigests]);
  }
};
const success = (action, data) => ({ schemaVersion: 1, action, status: 'success', summary: `${action} completed.`, data });

function fixture(options = {}) {
  const stores = options.stores || new Map();
  const hooks = [], calls = [], tools = [], timers = [], env = new Map(Object.entries({HOME:'/fixture/home',...(options.env || {})}));
  const elements = Object.fromEntries(['Box', 'Text', 'Button', 'Input', 'Select', 'Code', 'Markdown', 'Svg'].map(type => [type, props => {
    if (type === 'Code' && props.wrap !== undefined) assert.equal(typeof props.wrap, 'string');
    if (type === 'Select') assert.ok(props.options.length);
    return { type, props };
  }]));
  let nextCalls = 0, draft = options.draft || '', hostSessionId = options.hostSessionId || 'session-1';
  const on = (event, matcher, hook) => {
    if (typeof matcher === 'function') { hook = matcher; matcher = {}; }
    const item = { event, matcher, hook }; hooks.push(item);
    return { catch(handler) { item.catch = handler; } };
  };
  const $ = {
    plugin: { root: '/plugin', name: 'mainsequence' },
    session: { cwd: async () => '/work/repo', id: async () => hostSessionId, version: async () => ({ version: options.version || '2.1.295' }) },
    store: { get: async key => stores.has(key) ? stores.get(key) : key === 'settings' ? options.saved : key === 'mcp-environments' ? options.environments : undefined, set: async (key, value) => { stores.set(key, value); calls.push({ store: key, value }); } },
    prompt: { read: async () => ({ text: draft, cursor: draft.length }), fill: async value => { calls.push({ filled: value }); if (options.refuseFill) return { isFilled: false }; draft = value.text; return { isFilled: true, text: draft, cursor: draft.length }; }, submit: async value => { calls.push({ submitted: value }); return {}; }, suggest: async value => { calls.push({ suggested: value }); } },
    command: { register: async spec => { calls.push({ command: spec }); } },
    ui: { resolve: () => elements, invalidate: () => {}, open: async spec => { calls.push({ pane: spec }); },
      toast: value => { calls.push({ toast: value }); }, ask: async () => options.ask || 'Run tool' },
    tool: { register: async spec => { tools.push(spec); return { tool: `mcp__mainsequence__${spec.name}` }; } },
    clock: { now: async () => 1000, after: (ms, callback) => { const timer = { ms, callback, cancel() {} }; timers.push(timer); return timer; }, every: (ms, callback) => { const timer = { ms, callback, cancel() {} }; timers.push(timer); return timer; } },
    env: { get: async key => env.get(key), set: async (key, value) => { value === undefined ? env.delete(key) : env.set(key, value); } },
    fs: { read: async () => JSON.stringify({ claudeAiOauth: { accessToken: 'secret-new-token', expiresAt: 1000000 } }) },
    process: {
      run: async () => ({ exitCode: 0, stdout: JSON.stringify({ claudeAiOauth: { accessToken: 'secret-new-token', expiresAt: 1000000 } }), stderr: '' }),
      spawn: input => {
        assert.ok(input.input && !Object.hasOwn(input, 'stdin'));
        assert.deepEqual(input.argv, ['node', '/plugin/dist/claudeRunner.js']);
        assert.equal(input.cwd, '/work/repo');
        const envelope = JSON.parse(input.input); calls.push(envelope);
        const result = options.respond ? options.respond(envelope.request) : success(envelope.request.request.action, {});
        const line = JSON.stringify({ type: 'result', id: envelope.id, result }) + '\n';
        const stream = (async function* () {
          yield { stream: 'stderr', text: 'private-error-token' };
          yield { stream: 'stdout', text: JSON.stringify({ type: 'progress', id: envelope.id, message: 'Working' }) + '\n' + line.slice(0, 10) };
          yield { stream: 'stdout', text: line.slice(10) };
          return { code: 0, signal: null };
        })();
        stream.result = Promise.resolve({ code: 0, signal: null });
        return stream;
      },
    },
  };
  async function emit(event, value = {}) {
    let answer;
    for (const h of hooks.filter(h => h.event === event && Object.entries(h.matcher).every(([key, wanted]) => wanted instanceof RegExp ? wanted.test(value[key]) : wanted === value[key]))) {
      const next = async () => { nextCalls++; return { type: 'engine', ref: 1 }; };
      try { answer = await h.hook($, value, next); } catch (error) { if (!h.catch) throw error; answer = await h.catch($, value, next); }
    }
    return answer;
  }
  const pane = () => emit('ui.render', { surface: 'desktop', component: 'Pane', requestId: 'mainsequence', props: {} });
  const find = (tree, key) => { if (!tree || typeof tree !== 'object') return; if (tree.props?.key === key) return tree;
    for (const child of tree.props?.children || []) { const found = find(child, key); if (found) return found; } };
  const press = async key => { const node = find(await pane(), key); assert.ok(node, `Missing ${key}`); node.props.onPress(); await flush(); };
  const field = async (key, value) => { const node = find(await pane(), `field-${key}`); assert.ok(node, `Missing field ${key}`); node.props.onInput(value); await flush(); };
  return { hooks, $, on, emit, pane, press, field, calls, tools, timers, env, stores, find, get draft() { return draft; }, set draft(value) { draft = value; }, set hostSessionId(value) { hostSessionId = value; }, get nextCalls() { return nextCalls; } };
}

test('one native pane has six coordinated sections and no above-prompt launcher', async () => {
  const { register } = await load(); const f = fixture(); register(f.on); await f.emit('session.start', {surface:'desktop'});
  assert.equal(f.calls[0].command.name, 'ms');
  assert.deepEqual(f.calls.find(c => c.pane).pane, { id: 'mainsequence', title: 'MainSequence' });
  const band = await f.emit('ui.render', { surface: 'desktop', component: 'AbovePrompt', props: {} });
  assert.equal(band, undefined);
  for (const tab of ['General', 'Projects', 'Current-Project', 'MCP', 'Agents', 'Activity', 'General']) {
    await f.press(`tab-${tab}`); const tree = await f.pane();
    for (const name of ['General', 'Projects', 'Current-Project', 'MCP', 'Agents', 'Activity']) assert.equal(f.find(tree, `tab-${name}`).props.dimColor, name !== tab);
    assert.equal(f.find(tree, 'more-tools'), undefined); assert.equal(f.find(tree, 'tab-Accounts'), undefined);
  }
  assert.deepEqual(await f.emit('ui.render', { surface: 'terminal', component: 'Pane', requestId: 'mainsequence', props: {} }), { type: 'engine', ref: 1 });
  await f.emit('command.run', { command: 'ms' }); assert.equal(f.calls.at(-1).pane.id, 'mainsequence');
});

test('Desktop footer launcher survives pane closure and preserves native controls without changing settings', async () => {
  const saved = { backend: 'https://saved.example', baseDir: '/saved/repos', legacy: { keep: true } };
  const { register } = await load(); const f = fixture({ saved }); register(f.on);
  await f.emit('session.start', { surface: 'desktop' });
  const settingsBefore = JSON.stringify(saved), callsBefore = f.calls.length;
  const footer = () => f.emit('ui.render', { surface: 'desktop', component: 'SessionMode', props: { modes: [] } });
  for (let attempt = 0; attempt < 2; attempt++) {
    const tree = await footer();
    assert.deepEqual(tree.props.children[0], { type: 'engine', ref: 1 });
    assert.match(JSON.stringify(tree), /MainSequence emblem/);
    const launcher = f.find(tree, 'mainsequence-launcher'); assert.ok(launcher);
    launcher.props.onPress(); await flush();
    assert.deepEqual(f.calls.at(-1).pane, { id: 'mainsequence', title: 'MainSequence', focus: true });
    await f.emit('ui.close', { id: 'mainsequence', origin: { kind: 'person' } });
    assert.ok(f.find(await footer(), 'mainsequence-launcher'));
  }
  assert.deepEqual(await f.emit('ui.render', { surface: 'terminal', component: 'SessionMode', props: { modes: ['focus'] } }), { type: 'engine', ref: 1 });
  assert.equal(f.calls.slice(callsBefore).every(c => c.pane), true);
  assert.equal(JSON.stringify(saved), settingsBefore);
  f.$.ui.open = async () => { throw new Error('private-host-error'); };
  f.find(await footer(), 'mainsequence-launcher').props.onPress(); await flush();
  assert.match(f.calls.at(-1).toast, /could not open/);
  assert.doesNotMatch(f.calls.at(-1).toast, /private-host-error/);
});

test('native forms run structured actions without model APIs; mutating actions require explicit confirmation', async () => {
  const { register } = await load(); const f = fixture(); register(f.on); await f.emit('session.start');
  await f.field('backend', 'https://backend.example'); await f.press('auth-status');
  assert.deepEqual(f.calls.find(c => c.request)?.request, { scope: 'devtools', request: { action: 'auth-status', backend: 'https://backend.example', check: true } });
  await f.press('tab-Current-Project'); await f.field('root', '/work/selected');
  const before = f.calls.filter(c => c.request).length;
  await f.press('sync'); assert.equal(f.calls.filter(c => c.request).length, before);
  await f.press('dismiss-confirmation'); assert.equal(f.calls.filter(c => c.request).length, before);
  await f.press('sync'); await f.press('confirm-action');
  assert.deepEqual(f.calls.find(c => c.request?.request.action === 'sync').request.request, { action: 'sync', backend: 'https://backend.example', root: '/work/selected' });
  assert.equal(f.calls.filter(c => c.request).at(-1).request.request.action, 'status');
  await f.press('tab-Activity'); const tree = JSON.stringify(await f.pane());
  assert.doesNotMatch(tree, /private-error-token/); assert.match(tree, /sync completed/);
});

test('preview binds the exact container image and digest to the later write', async () => {
  const { register } = await load(); const f = fixture({ respond: domain => domain.request.action === 'devcontainer-preview'
    ? success('devcontainer-preview', { path: '/work/repo/.devcontainer/devcontainer.json', before: '{}', after: '{"image":"my:image"}', expectedDigest: 'digest-123' }) : success(domain.request.action, {}) });
  register(f.on); await f.emit('session.start'); await f.press('tab-Current-Project'); await f.field('image', 'my:image');
  await f.press('devcontainer-preview'); await f.press('confirm-action');
  const request = f.calls.filter(c => c.request).at(-1).request;
  assert.equal(request.scope, 'projects'); assert.equal(request.request.action, 'devcontainer-write');
  assert.equal(request.request.image, 'my:image'); assert.equal(request.request.expectedDigest, 'digest-123');
});

test('MCP tools refresh from exact releases, use flattened hook arguments, and confirm each call', async () => {
  const { register } = await load();
  const f = fixture({ respond: domain => {
    if (domain.request.action === 'mcp-environments') return success('mcp-environments',[{uid:'env-1',name:'Research'}]);
    if (domain.request.action === 'mcp-list') return success('mcp-list', [{ resource_release_uid: 'release-1', name: 'Project', backend: 'https://backend.example', mcp_connection:{organization_environment_uid:'env-1'} }]);
    if (domain.request.action === 'mcp-tools') return success('mcp-tools', { tools: [{ name: 'lookup', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }] });
    return success(domain.request.action, {});
  } });
  register(f.on); await f.emit('session.start'); await f.press('tab-MCP'); f.find(await f.pane(),'mcp-environment').props.onSelect('env-1'); await flush();
  assert.equal(f.tools.length, 1);
  const full = 'mcp__mainsequence__' + f.tools[0].name;
  await f.emit('tool.call', { tool: full, tool_use_id: 'call-1', query: 'hello' });
  assert.deepEqual(f.calls.filter(c => c.request).at(-1).request.request.arguments, { query: 'hello' });
  assert.match((await f.emit('tool.call', { tool: 'mcp__mainsequence__missing' })).deny, /no longer connected/);
});

test('MCP labels and tool descriptions use the release UID when display names are missing', async () => {
  const { register } = await load();
  for (const name of [undefined, '', '   ', null, 17, 'Named project']) {
    const connection = { resource_release_uid: 'release-1', name, backend: 'https://backend.example',
      mcp_connection: { organization_environment_uid: 'env-1' } };
    const f = fixture({ respond: domain => {
      const action = domain.request.action;
      if (action === 'mcp-environments') return success(action, [{ uid: 'env-1', name: 'Research' }]);
      if (action === 'mcp-discover') return success(action, { count: 1, results: [{ ...connection, name: 'Discovered project' }] });
      if (action === 'mcp-list') return success(action, [connection]);
      if (action === 'mcp-tools') return success(action, { tools: [{ name: 'lookup', inputSchema: { type: 'object' } }] });
      return success(action, {});
    } });
    register(f.on); await f.emit('session.start'); await f.press('tab-MCP');
    f.find(await f.pane(), 'mcp-environment').props.onSelect('env-1'); await flush();
    const display = name === 'Named project' ? name : 'release-1';
    const tree = await f.pane();
    assert.equal(f.find(tree, 'mcp-connected').props.options.find(option => option.value === 'release-1').label, `${display} · Research`);
    assert.equal(f.find(tree, 'mcp-discovered').props.options.find(option => option.value === 'release-1').label, 'Discovered project · Research');
    assert.equal(f.tools.length, 1);
    assert.equal(f.tools[0].description, `MainSequence ${display} [Research]: lookup`);
    const tool = 'mcp__mainsequence__' + f.tools[0].name;
    assert.equal((await f.emit('tool.call', { tool, tool_use_id: 'call-1', query: 'value' })).isError, undefined);
    const request = f.calls.filter(call => call.request?.request.action === 'mcp-call').at(-1).request.request;
    assert.equal(request.releaseUid, 'release-1'); assert.deepEqual(request.arguments, { query: 'value' });
  }
});

test('worker protocol rejects malformed result and cancellation closes the real stream', async () => {
  const { runWorker } = await load(); let closed = 0;
  const child = (async function* () { yield { stream: 'stdout', text: '{wrong}\n' }; return { code: 0 }; })();
  const originalReturn = child.return.bind(child); child.return = async value => { closed++; return originalReturn(value); };
  child.result = Promise.resolve({ code: 0 });
  const $ = { plugin: { root: '/plugin' }, process: { spawn: () => child }, clock: { after: () => ({ cancel() {} }) } };
  const result = await runWorker($, { cwd: '/work', fields: { nodePath: 'node' } }, { protocolVersion: 1, id: 'x', request: { scope: 'devtools', request: { action: 'status' } } }, {}, () => {});
  assert.equal(result.status, 'failure'); assert.equal(result.effects.state, 'partial-or-uncertain'); assert.equal(closed, 1);
});

test('older bundled engines show a guard instead of running worker operations', async () => {
  const { register } = await load(); const f = fixture({ version: '2.1.285' }); register(f.on); await f.emit('session.start');
  assert.match(JSON.stringify(await f.pane()), /Update Claude Desktop/); assert.equal(f.calls.filter(c => c.request).length, 0);
});

test('repository selections do not display an unselected first item and branch choices come from the API', async () => {
  const { register } = await load(); const f = fixture({ respond: domain => success(domain.request.action,
    [{ uid: 'repo-1', code_repository_name: 'Real project', branches: [{ uid: 'branch-1', repository_branch: 'develop' }] }]) });
  register(f.on); await f.emit('session.start'); await f.field('baseDir', '/repos'); await f.press('tab-Projects'); await f.press('list-repositories');
  let choice = f.find(await f.pane(), 'remote-repository'); assert.equal(choice.props.value, '');
  assert.equal(choice.props.options[1].label, 'Real project'); choice.props.onSelect('repo-1'); await flush();
  choice = f.find(await f.pane(), 'repository-branch'); assert.equal(choice.props.value, 'develop');
  choice.props.onSelect('develop'); await f.press('setup'); await f.press('confirm-action');
  assert.equal(f.calls.find(c => c.request?.request.action === 'setup').request.request.branch, 'develop');
});

test('SDK update is unavailable unless fresh status explicitly supports and offers an update', async () => {
  const { register } = await load(); let supported = false;
  const f = fixture({ respond: domain => success(domain.request.action, { updateAvailable: true, updateSupported: supported }) });
  register(f.on); await f.emit('session.start'); await f.press('tab-Current-Project');
  assert.equal(f.find(await f.pane(), 'update-sdk'), undefined); await f.press('sdk-status');
  assert.equal(f.find(await f.pane(), 'update-sdk'), undefined); supported = true; await f.press('sdk-status');
  assert.ok(f.find(await f.pane(), 'update-sdk')); await f.field('root', '/different');
  assert.equal(f.find(await f.pane(), 'update-sdk'), undefined);
});


test('MainSequence login, renewal and logout remain available without touching Claude credentials or provider config', async () => {
  const { register } = await load(); let signedIn = false;
  const original = { CLAUDE_CODE_OAUTH_TOKEN: 'fixture-claude', ANTHROPIC_API_KEY: 'fixture-api', ANTHROPIC_BASE_URL: 'https://provider.example', CLAUDE_SECURESTORAGE_CONFIG_DIR: '/existing' };
  const saved = { backend: 'https://backend.example', baseDir: '/repos', provider: { url: 'https://provider.example' }, claudeExecutable: '/old/unused' };
  const f = fixture({ env: original, saved, respond: domain => {
    if (domain.request.action === 'login') signedIn = true;
    if (domain.request.action === 'logout') signedIn = false;
    return success(domain.request.action, domain.request.action === 'auth-status' ? { authenticated: signedIn, username: 'fixture@example.test' } : {});
  } });
  f.$.env.set = f.$.fs.read = f.$.process.run = async () => assert.fail('Claude credential APIs must never be used');
  register(f.on); await f.emit('session.start');
  await f.press('login'); assert.match(JSON.stringify(await f.pane()), /fixture@example.test/);
  await f.press('toggle-connection-actions'); await f.press('refresh-token');
  await f.press('logout'); await f.press('confirm-action'); assert.ok(f.find(await f.pane(), 'login'));
  await f.press('save-settings'); const stored = f.calls.find(c => c.store).value;
  assert.deepEqual(stored.provider, saved.provider); assert.equal(stored.claudeExecutable, saved.claudeExecutable);
  for (const event of ['turn.start','turn.step','turn.complete','session.measure','classic.StopFailure']) assert.equal(f.hooks.some(h => h.event === event), false, event);
  await f.emit('session.end'); assert.deepEqual(Object.fromEntries(f.env), {HOME:'/fixture/home',...original});
  assert.ok(f.calls.filter(c => c.request).every(c => c.request.scope !== 'accounts'));
  assert.deepEqual(f.calls.filter(c => c.request?.request.action === 'login').map(c => c.request.scope), ['devtools']);
});

test('Activity has useful empty state navigation, real operation results and collapsed details', async () => {
  const { register } = await load(); const f=fixture(); register(f.on); await f.emit('session.start');
  await f.press('tab-Activity'); assert.match(JSON.stringify(await f.pane()), /No activity yet/);
  await f.press('activity-mcp'); assert.ok(f.find(await f.pane(),'mcp-environments'));
  await f.press('tab-General'); await f.press('auth-status'); await f.press('tab-Activity');
  let tree=await f.pane(); assert.match(JSON.stringify(tree),/Check MainSequence connection/); assert.match(JSON.stringify(tree),/Completed/);
  assert.doesNotMatch(JSON.stringify(tree),/"type":"Code"/);
  await f.press('toggle-activity-' + f.calls.find(c=>c.request?.request.action==='auth-status').id); assert.match(JSON.stringify(await f.pane()),/"type":"Code"/);
});

test('startup reads existing MainSequence session without saving or rotating credentials', async () => {
  const {register}=await load(); const f=fixture({ respond: domain => success(domain.request.action, domain.request.action==='workspace-preferences' ? {backend:'https://saved.example',baseDir:'/existing/repos'} : {backend:'https://saved.example',authenticated:true,username:'saved@example.test'}) });
  register(f.on); await f.emit('session.start',{surface:'desktop'});
  for(const timer of f.timers.filter(t=>t.ms===0))timer.callback(); await flush();
  const tree=await f.pane(); assert.match(JSON.stringify(tree),/saved@example.test/);
  assert.equal(f.find(tree,'field-backend').props.value,'https://saved.example');
  assert.equal(f.find(tree,'field-baseDir').props.value,'/existing/repos');
  assert.equal(f.calls.some(c=>c.store),false);
  assert.deepEqual(f.calls.filter(c=>c.request).map(c=>c.request.request.action),['workspace-preferences','auth-status']);
  assert.equal(f.calls.find(c=>c.request?.request.action==='auth-status').request.request.check,false);
});

test('late repository results cannot restore a previous backend selection', async () => {
  const {register}=await load();const f=fixture();register(f.on);await f.emit('session.start');
  await f.field('backend','https://old.example');
  const originalSpawn=f.$.process.spawn;let finish;
  f.$.process.spawn=input=>{
    const envelope=JSON.parse(input.input);
    if(envelope.request.request.action!=='repositories')return originalSpawn(input);
    const gate=new Promise(resolve=>{finish=resolve});
    const stream=(async function*(){await gate;yield{stream:'stdout',text:JSON.stringify({type:'result',id:envelope.id,result:success('repositories',[{uid:'old',code_repository_name:'Old backend repository',branches:[]}])})+'\n'};})();
    stream.result=Promise.resolve({code:0});return stream;
  };
  await f.press('tab-Projects');await f.press('tab-General');await f.field('backend','https://new.example');finish();await flush();
  f.$.process.spawn=originalSpawn;await f.press('tab-Projects');
  assert.doesNotMatch(JSON.stringify(await f.pane()),/Old backend repository/);
});


test('actual defaults are editable before initialization and usable without saving even when login fails',async()=>{
 const {register}=await load();
 const f=fixture({respond:domain=>domain.request.action==='workspace-preferences'?success('workspace-preferences',{backend:'https://api.main-sequence.app',baseDir:'/fixture/home/mainsequence'}):{schemaVersion:1,action:domain.request.action,status:'failure',summary:'No saved session'}});
 register(f.on);await f.emit('session.start',{surface:'desktop'});
 let tree=await f.pane();assert.equal(f.find(tree,'field-backend').props.value,'https://api.main-sequence.app');assert.equal(f.find(tree,'field-backend').props.placeholder,'');assert.equal(f.find(tree,'field-baseDir').props.value,'/fixture/home/mainsequence');
 for(const timer of f.timers.filter(t=>t.ms===0))timer.callback();await flush();
 await f.press('auth-status');assert.equal(f.calls.filter(c=>c.request).at(-1).request.request.backend,'https://api.main-sequence.app');
 assert.equal(f.calls.some(c=>c.store),false);
});
test('saved and user-edited settings win over late defaults, with unknown saved fields retained',async()=>{
 const {register}=await load();const saved={backend:'https://existing.example',baseDir:'/existing',provider:{name:'keep'}};
 const f=fixture({saved,respond:d=>success(d.request.action,{backend:'https://discovered.example',baseDir:'/discovered'})});register(f.on);await f.emit('session.start',{surface:'desktop'});
 await f.field('baseDir','/edited');for(const timer of f.timers.filter(t=>t.ms===0))timer.callback();await flush();
 const tree=await f.pane();assert.equal(f.find(tree,'field-backend').props.value,saved.backend);assert.equal(f.find(tree,'field-baseDir').props.value,'/edited');
 assert.equal(f.calls.some(c=>c.store),false);await f.press('save-settings');assert.deepEqual(f.calls.find(c=>c.store==='settings').value.provider,saved.provider);
});
test('environment selection scopes tools and denies stale calls, including changes while awaiting confirmation',async()=>{
 const {register}=await load();let asks=0;let approve;
 const f=fixture({respond:d=>{
  const q=d.request;
  if(q.action==='mcp-environments')return success(q.action,[{uid:'research',name:'Research'},{uid:'production',name:'Production',isProduction:true}]);
  if(q.action==='mcp-list')return success(q.action,[{backend:'https://api.main-sequence.app',resource_release_uid:'release-'+q.environmentUid,name:'Same project',mcp_connection:{organization_environment_uid:q.environmentUid}}]);
  if(q.action==='mcp-tools')return success(q.action,{tools:[{name:'lookup',inputSchema:{type:'object'}}]});
  return success(q.action,{count:0,results:[]});
 }});register(f.on);await f.emit('session.start');await f.press('tab-MCP');
 assert.equal(f.tools.length,0);
 f.find(await f.pane(),'mcp-environment').props.onSelect('research');await flush();
 const old='mcp__mainsequence__'+f.tools[0].name;
 assert.match(f.tools[0].description,/Research/);
 f.$.ui.ask=()=>{asks++;return new Promise(resolve=>{approve=resolve})};
 const pending=f.emit('tool.call',{tool:old,query:'hello'});await flush();
 f.find(await f.pane(),'mcp-environment').props.onSelect('production');await flush();approve('Run tool');
 assert.match((await pending).deny,/environment changed/);assert.match((await f.emit('tool.call',{tool:old})).deny,/no longer connected/);assert.equal(asks,1);
 assert.equal(f.calls.some(c=>c.request?.request.action==='mcp-call'),false);
 assert.ok(f.calls.filter(c=>c.request&&['mcp-list','mcp-discover','mcp-tools'].includes(c.request.request.action)).every(c=>c.request.request.environmentUid));
 assert.equal(f.calls.some(c=>c.request?.request.action==='mcp-remove'),false);
 assert.equal(f.calls.filter(c=>c.store==='mcp-environments').at(-1).value['https://api.main-sequence.app'],'production');
});

test('saved MCP environment restores only its tools in a new session without changing General settings',async()=>{
 const {register}=await load();const backend='https://saved.example';
 const f=fixture({saved:{backend,baseDir:'/saved',provider:{keep:true}},environments:{[backend]:'research','https://other.example':'production'},respond:d=>{
  const q=d.request;
  if(q.action==='workspace-preferences')return success(q.action,{backend:'https://default.example',baseDir:'/default'});
  if(q.action==='mcp-environments')return success(q.action,[{uid:'research',name:'Research'}]);
  if(q.action==='mcp-list')return success(q.action,[{backend,resource_release_uid:'r',name:'Project',mcp_connection:{organization_environment_uid:'research'}}]);
  if(q.action==='mcp-tools')return success(q.action,{tools:[{name:'lookup',inputSchema:{type:'object'}}]});
  return success(q.action,{});
 }});register(f.on);await f.emit('session.start',{surface:'desktop'});for(const timer of f.timers.filter(t=>t.ms===0))timer.callback();await flush();
 assert.equal(f.tools.length,1);assert.match(f.tools[0].description,/Research/);assert.equal(f.calls.some(c=>c.store),false);
 assert.equal(f.find(await f.pane(),'field-backend').props.value,backend);
});

test('a folder chosen during startup survives preferences resolution without saving', async () => {
  const { register } = await load();
  const f = fixture({ respond: d => success(d.request.action, d.request.action === 'pick-folder'
    ? { path: '/chosen/repos' } : { backend: 'https://default.example', baseDir: '/default/repos' }) });
  register(f.on); await f.emit('session.start', { surface: 'desktop' });
  await f.press('pick-base');
  for (const timer of f.timers.filter(t => t.ms === 0)) timer.callback();
  await flush();
  assert.equal(f.find(await f.pane(), 'field-baseDir').props.value, '/chosen/repos');
  assert.equal(f.calls.some(c => c.store), false);
});

test('late tool registration cannot replace the current environment tool map', async () => {
  const { register } = await load();
  const f = fixture({ respond: d => {
    const q = d.request;
    if (q.action === 'mcp-environments') return success(q.action, [{ uid: 'a', name: 'A' }, { uid: 'b', name: 'B' }]);
    if (q.action === 'mcp-list') return success(q.action, [{ backend: 'https://api.main-sequence.app', resource_release_uid: 'r', name: 'Project', mcp_connection: { organization_environment_uid: q.environmentUid } }]);
    if (q.action === 'mcp-tools') return success(q.action, { tools: [{ name: 'lookup', inputSchema: { type: 'object' } }] });
    return success(q.action, {});
  } });
  const registerTool = f.$.tool.register;
  let finish;
  f.$.tool.register = async spec => {
    const result = await registerTool(spec);
    if (spec.description.includes('[A]')) await new Promise(resolve => { finish = resolve; });
    return result;
  };
  register(f.on); await f.emit('session.start'); await f.press('tab-MCP');
  f.find(await f.pane(), 'mcp-environment').props.onSelect('a'); await flush();
  f.find(await f.pane(), 'mcp-environment').props.onSelect('b'); await flush();
  finish(); await flush();
  assert.match((await f.emit('tool.call', { tool: 'mcp__mainsequence__' + f.tools[0].name })).deny, /no longer connected/);
  assert.equal((await f.emit('tool.call', { tool: 'mcp__mainsequence__' + f.tools[1].name })).isError, undefined);
  assert.equal(f.calls.filter(c => c.request?.request.action === 'mcp-call').at(-1).request.request.environmentUid, 'b');
});

const agentId = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const agentEnvironment=agentId(1), agentUid=agentId(2), agentSession=agentId(3), agentTask=agentId(4), secondUid=agentId(6), secondSession=agentId(7);
async function agentFixture(options={}) {
  const account='agent-user@example.test';
  const agent={uid:agentUid,name:'Research assistant',description:'Explain portfolio risk',environmentUid:agentEnvironment,environmentName:'Research',repositoryBranch:'develop',runtimeState:'current',runtimeReleaseUid:agentId(5),responseKinds:['message','task'],skills:[{name:'Risk',description:'Explain exposure',examples:['Explain exposure']}],...options.agent};
  const agents=[agent,...(options.twoAgents?[{...agent,uid:secondUid,name:'CRM assistant',description:'Private CRM description'}]:[])];
  const f=fixture({...options,ask:options.ask||'Send',respond:domain=>{
    const r=domain.request, selected=agents.find(a=>a.uid===r.agentUid)||agent;
    const override=options.respond?.(r); if(override)return override;
    if(r.action==='workspace-preferences')return success(r.action,{backend:'https://platform.example',baseDir:'/repos'});
    if(r.action==='auth-status')return success(r.action,{authenticated:true,username:account});
    if(r.action==='mcp-environments')return success(r.action,[{uid:agentEnvironment,name:'Research'},{uid:agentId(9),name:'Production'}]);
    if(r.action==='mcp-list'||r.action==='mcp-discover')return success(r.action,[]);
    if(r.action==='agents-list')return success(r.action,{account,results:r.environmentUid===agentEnvironment?agents:[],count:r.environmentUid===agentEnvironment?agents.length:0});
    if(r.action==='agent-get')return success(r.action,{account,agent:selected});
    if(r.action==='agent-session')return success(r.action,{account,agent:selected,sessionUid:r.sessionUid|| (r.agentUid===secondUid?secondSession:agentSession)});
    if(r.action==='agent-readiness')return success(r.action,{account,agentUid:r.agentUid,sessionUid:r.sessionUid,ready:true});
    if(r.action==='agent-send')return success(r.action,{account,agent:selected,sessionUid:r.sessionUid,responseKind:r.responseKind,...(r.responseKind==='task'?{taskUid:agentTask,status:'working',terminal:false}:{message:`Reply from ${selected.name}`})});
    if(r.action.startsWith('agent-task-'))return success(r.action,{account,agent:selected,sessionUid:agentSession,responseKind:'task',taskUid:agentTask,status:'working',terminal:false});
    return success(r.action,{});
  }});
  const {register}=await load();register(f.on);await f.emit('session.start',{surface:'desktop'});
  f.timers.find(t=>t.ms===0).callback();await flush();await f.press('tab-Agents');
  f.find(await f.pane(),'mcp-environment').props.onSelect(agentEnvironment);await flush();
  f.agent=agent; f.tool=kind=>'mcp__mainsequence__'+f.tools.findLast(t=>t.name.startsWith(`ms_agent_${kind}_`)).name;
  f.startTalk=async(uid=agentUid)=>{await f.press(`agent-talk-${uid}`);await flush();};
  f.send=(message='My own question',uid=agentUid)=>f.emit('command.run',{command:'ms',args:`agent ${uid} ${message}`,origin:{kind:'composer'}});
  return f;
}
function delayRequest(f,action,uid) {
 const original=f.$.process.spawn;let release;
 f.$.process.spawn=input=>{
  const envelope=JSON.parse(input.input),r=envelope.request.request;
  if(r.action!==action || (uid&&r.agentUid!==uid))return original(input);
  const gate=new Promise(resolve=>{release=resolve}), child=original(input);
  const stream=(async function*(){await gate;for await(const chunk of child)yield chunk;})();stream.result=child.result;return stream;
 };
 return ()=>{assert.ok(release,'request started');release();};
}
test('Talk resolves a session and prefills an editable draft with no auto-send or introduction',async()=>{
 const f=await agentFixture({draft:'What is the exposure?'});
 assert.doesNotMatch(JSON.stringify(await f.pane()),/Explain portfolio risk/);
 await f.press(`agent-details-${agentUid}`);assert.match(JSON.stringify(await f.pane()),/Explain portfolio risk/);await f.press('agents-back');
 await f.startTalk();assert.equal(f.draft,`/ms agent ${agentUid} What is the exposure?`);
 assert.equal(f.calls.filter(c=>c.submitted||c.suggested).length,0);
 assert.equal(f.calls.filter(c=>c.request?.request.action==='agent-send').length,0);
 const opened=f.calls.find(c=>c.request?.request.action==='agent-session').request.request;
 assert.match(opened.handleId,/^claude_[a-f0-9]+_.*_default$/);assert.equal(opened.expectedAccount,'agent-user@example.test');assert.equal(opened.parentSessionUid,undefined);
 await f.startTalk();assert.equal(f.draft,`/ms agent ${agentUid} What is the exposure?`);assert.equal(f.calls.filter(c=>c.request?.request.action==='agent-session').length,1);
 f.$.ui.ask=async()=>{throw new Error('Explicit user submission must not ask twice')};
 assert.match((await f.send('Only my message')).text,/Reply from Research/);
 const sent=f.calls.find(c=>c.request?.request.action==='agent-send').request.request;
 assert.equal(sent.message,'Only my message');assert.equal(sent.sessionUid,agentSession);assert.equal(sent.handleId,undefined);
 assert.equal(f.tools.some(t=>t.name.includes('introduce')),false);
});
test('draft retargeting keeps its text; unrelated slash commands and refused filling are preserved',async()=>{
 const f=await agentFixture({twoAgents:true,draft:'Keep\nall my text'});await f.startTalk();await f.startTalk(secondUid);
 assert.equal(f.draft,`/ms agent ${secondUid} Keep\nall my text`);
 f.draft='/review something';await f.startTalk();assert.equal(f.draft,'/review something');
 const blocked=await agentFixture({refuseFill:true,draft:'Keep this'});await blocked.startTalk();assert.equal(blocked.draft,'Keep this');assert.match(blocked.calls.at(-1).toast,/could not fill/);
 assert.equal(blocked.calls.some(c=>c.submitted),false);
});
test('preparation and waiting affect only the correct card; changing selection keeps the original request valid',async()=>{
 const f=await agentFixture({twoAgents:true});const finishOpen=delayRequest(f,'agent-session',agentUid);
 await f.startTalk();let tree=await f.pane();assert.match(JSON.stringify(f.find(tree,`agent-status-${agentUid}`)),/Opening session/);assert.equal(f.find(tree,`agent-status-${secondUid}`),undefined);assert.equal(f.find(tree,`agent-talk-${agentUid}`).props.label,'💬');assert.equal(f.find(tree,`agent-talk-${secondUid}`).props.label,'💬');
 await f.startTalk(secondUid);finishOpen();await flush();assert.equal(f.draft,`/ms agent ${secondUid} `);
 await f.startTalk(agentUid);const finish=delayRequest(f,'agent-send',agentUid);const pending=f.send('Wait for this');await flush();
 await f.startTalk(secondUid);tree=await f.pane();assert.match(JSON.stringify(f.find(tree,`agent-${agentUid}`)),/Waiting for agent/);assert.doesNotMatch(JSON.stringify(f.find(tree,`agent-${secondUid}`)),/Waiting for agent/);
 assert.match((await f.send('Other agent',secondUid)).text,/CRM assistant/);finish();assert.match((await pending).text,/Research assistant/);
 const saved=Object.values(f.stores.get('agent-conversations-session-1'));assert.equal(saved.length,2);assert.deepEqual(new Set(saved.map(x=>x.sessionUid)),new Set([agentSession,secondSession]));
});
test('model tools still require approval and keep task operations scoped to their own conversation',async()=>{
 const f=await agentFixture({twoAgents:true});await f.startTalk();const send=f.tool('send'),wait=f.tool('wait');
 f.$.ui.ask=async()=> 'Go back';assert.match((await f.emit('tool.call',{tool:send,message:'Analyze A',responseKind:'task'})).deny,/cancelled/);
 f.$.ui.ask=async()=> 'Send';await f.emit('tool.call',{tool:send,message:'Analyze A',responseKind:'task'});
 await f.startTalk(secondUid);
 assert.match((await f.emit('tool.call',{tool:wait,taskUid:agentId(99)})).deny,/this conversation/);
 await f.emit('tool.call',{tool:wait,taskUid:agentTask,afterSequence:2});assert.equal(f.calls.filter(c=>c.request).at(-1).request.request.agentUid,agentUid);
});
test('environment and host-session changes invalidate old prepared commands and tool approvals',async()=>{
 const f=await agentFixture();await f.startTalk();const tool=f.tool('send');let approve;
 f.$.ui.ask=()=>new Promise(resolve=>{approve=resolve});const pending=f.emit('tool.call',{tool,message:'Hello',responseKind:'message'});await flush();
 f.find(await f.pane(),'mcp-environment').props.onSelect(agentId(9));await flush();approve('Send');assert.match((await pending).deny,/changed/);
 assert.match((await f.send()).text,/no longer active/);assert.equal(f.calls.filter(c=>c.request?.request.action==='agent-send').length,0);
 const other=await agentFixture();await other.startTalk();other.hostSessionId='new-host-chat';assert.match((await other.send()).text,/no longer active/);
});
test('uncertain sends survive reload and never replay, but the existing session can be resolved',async()=>{
 const stores=new Map(),respond=r=>r.action==='agent-send'?{schemaVersion:1,action:r.action,status:'failure',summary:'Connection interrupted',effects:{state:'partial-or-uncertain'}}:null;
 const f=await agentFixture({stores,respond});await f.startTalk();await f.send();assert.match((await f.send('Retry')).text,/uncertain/);
 const reopened=await agentFixture({stores,respond});await reopened.startTalk();assert.match((await reopened.send('Again')).text,/uncertain/);
 assert.equal(reopened.calls.filter(c=>c.request?.request.action==='agent-send').length,0);assert.equal(reopened.calls.filter(c=>c.request?.request.action==='agent-session').length,1);
 assert.doesNotMatch(JSON.stringify([...stores]),/My own question|accessToken|refreshToken/);
});
test('reload resumes each agent session and deterministic handles recover the original default mapping',async()=>{
 const stores=new Map(),first=await agentFixture({stores,twoAgents:true,hostSessionId:agentId(80)});await first.startTalk();await first.startTalk(secondUid);
 const reopened=await agentFixture({stores,twoAgents:true,hostSessionId:agentId(80)});await reopened.startTalk();await reopened.startTalk(secondUid);
 assert.deepEqual(reopened.calls.filter(c=>c.request?.request.action==='agent-session').map(c=>c.request.request.sessionUid),[agentSession,secondSession]);
 const recovered=await agentFixture({hostSessionId:agentId(80)});await recovered.startTalk();
 const handle=f=>f.calls.find(c=>c.request?.request.action==='agent-session').request.request.handleId;
 assert.equal(handle(first),handle(recovered));assert.ok(handle(first).includes(agentId(80)));
 const another=await agentFixture({hostSessionId:agentId(81)});await another.startTalk();assert.notEqual(handle(first),handle(another));
});
test('a late response cannot overwrite an explicitly restarted agent conversation',async()=>{
 const f=await agentFixture();await f.startTalk();const finish=delayRequest(f,'agent-send',agentUid);const pending=f.send();await flush();
 await f.press(`agent-details-${agentUid}`);await f.press('agent-new-conversation');await f.press('confirm-action');
 const replacement=JSON.stringify(f.stores.get('agent-conversations-session-1'));finish();await pending;assert.equal(JSON.stringify(f.stores.get('agent-conversations-session-1')),replacement);
 const handles=f.calls.filter(c=>c.request?.request.action==='agent-session').map(c=>c.request.request.handleId);assert.notEqual(handles[0],handles[1]);
});
test('empty, invalid and non-text commands never send; direct plugin commands require confirmation',async()=>{
 const f=await agentFixture();await f.startTalk();await f.send('');await f.emit('command.run',{command:'ms',args:'agent wrong text'});
 assert.match((await f.emit('prompt.submit',{text:`/ms agent ${agentUid} question`,attachments:[{type:'image'}]})).drop,/text only/);
 f.$.ui.ask=async()=> 'Go back';assert.match((await f.emit('command.run',{command:'ms',args:`agent ${agentUid} text`,origin:{kind:'plugin',name:'other'}})).text,/cancelled/);
 assert.equal(f.calls.filter(c=>c.request?.request.action==='agent-send').length,0);
});
test('duplicate submissions to the same agent are refused while its request is pending',async()=>{
 const f=await agentFixture();await f.startTalk();const finish=delayRequest(f,'agent-send');const pending=f.send();await flush();
 assert.match((await f.send()).text,/already running/);finish();await pending;assert.equal(f.calls.filter(c=>c.request?.request.action==='agent-send').length,1);
});
test('failed resolution and tool registration can retry without any message or introduction',async()=>{
 const f=await agentFixture();const register=f.$.tool.register;f.$.tool.register=async()=>{throw new Error('host not ready')};await f.startTalk();assert.match(JSON.stringify(await f.pane()),/needs attention/);
 f.$.tool.register=register;await f.startTalk();assert.equal(f.draft,`/ms agent ${agentUid} `);assert.equal(f.calls.filter(c=>c.submitted||c.request?.request.action==='agent-send').length,0);
 const unavailable=await agentFixture({respond:r=>r.action==='agent-session'?{schemaVersion:1,action:r.action,status:'failure',summary:'Model configuration required'}:null});await unavailable.startTalk();
 assert.equal(unavailable.draft,'');assert.match(unavailable.calls.at(-1).toast,/Model configuration/);
});


test('returning to an agent that is still opening makes it the final selection without duplicate allocation', async () => {
 const f=await agentFixture({twoAgents:true}); const finish=delayRequest(f,'agent-session',agentUid);
 await f.startTalk(); await f.startTalk(secondUid); await f.startTalk(agentUid); finish(); await flush();
 assert.equal(f.draft,`/ms agent ${agentUid} `);
 assert.match(JSON.stringify(f.find(await f.pane(),`agent-status-${agentUid}`)),/Agent ready/);
 assert.equal(f.calls.filter(c=>c.request?.request.action==='agent-session'&&c.request.request.agentUid===agentUid).length,1);
 const message='  Keep leading spaces\nand a second line  '; await f.send(message);
 assert.equal(f.calls.filter(c=>c.request?.request.action==='agent-send').at(-1).request.request.message,message);
});

test('Talk preserves the current draft while readiness waits, then fills once without submission',async()=>{
 const f=await agentFixture({draft:'Keep my question',twoAgents:true});const finish=delayRequest(f,'agent-readiness',agentUid);
 await f.startTalk();assert.equal(f.draft,'Keep my question');
 assert.match(JSON.stringify(f.find(await f.pane(),`agent-status-${agentUid}`)),/Checking agent/);
 assert.equal(f.find(await f.pane(),`agent-status-${secondUid}`),undefined);
 assert.equal(f.calls.some(c=>c.filled||c.submitted||c.request?.request.action==='agent-send'),false);
 assert.match((await f.send()).text,/still being prepared|no longer active/);
 f.draft='Keep my edited question';finish();await flush();
 assert.equal(f.draft,`/ms agent ${agentUid} Keep my edited question`);
 assert.equal(f.calls.filter(c=>c.filled).length,1);assert.equal(f.calls.some(c=>c.submitted),false);
});
test('late ready cannot replace another selected agent; resumed Talk checks again',async()=>{
 const f=await agentFixture({twoAgents:true});const finish=delayRequest(f,'agent-readiness',agentUid);
 await f.startTalk();await f.startTalk(secondUid);finish();await flush();
 assert.equal(f.draft,`/ms agent ${secondUid} `);
 await f.startTalk(secondUid);
 assert.equal(f.calls.filter(c=>c.request?.request.action==='agent-readiness'&&c.request.request.agentUid===secondUid).length,2);
 await f.send('Only my text',secondUid);
 assert.equal(f.calls.findLast(c=>c.request?.request.action==='agent-send').request.request.waitForReady,true);
});
test('readiness failure and cancellation preserve drafts and never make them sendable',async()=>{
 const failure=await agentFixture({draft:'Untouched',respond:r=>r.action==='agent-readiness'?{schemaVersion:1,action:r.action,status:'failure',summary:'Agent unavailable. No message was sent.'}:null});
 await failure.startTalk();assert.equal(failure.draft,'Untouched');assert.ok(failure.find(await failure.pane(),`agent-prepare-retry-${agentUid}`));
 assert.equal(failure.calls.some(c=>c.filled||c.submitted),false);
 const f=await agentFixture({draft:'Keep cancelled draft'});const finish=delayRequest(f,'agent-readiness');await f.startTalk();
 await f.press(`agent-prepare-cancel-${agentUid}`);finish();await flush();
 assert.equal(f.draft,'Keep cancelled draft');assert.equal(f.calls.some(c=>c.filled||c.submitted),false);
 assert.match(JSON.stringify(await f.pane()),/preparation cancelled/);
});
test('environment change during readiness never fills a stale draft',async()=>{
 const f=await agentFixture({draft:'Unchanged'});const finish=delayRequest(f,'agent-readiness');await f.startTalk();
 f.find(await f.pane(),'mcp-environment').props.onSelect(agentId(9));await flush();finish();await flush();
 assert.equal(f.draft,'Unchanged');assert.equal(f.calls.some(c=>c.filled||c.submitted),false);
});

test('session renewal belongs to General and never appears in either project section',async()=>{
 const f=await agentFixture();await f.press('tab-General');
 await f.press('toggle-connection-actions');assert.ok(f.find(await f.pane(),'refresh-token'));
 for(const tab of ['Projects','Current-Project']){await f.press(`tab-${tab}`);assert.equal(f.find(await f.pane(),'refresh-token'),undefined);}
 await f.press('tab-General');assert.ok(f.find(await f.pane(),'refresh-token'));
});

test('agent defaults appear beneath the name without exposing or changing provider configuration',async()=>{
 const f=await agentFixture({agent:{defaults:{provider:'anthropic',model:'claude-sonnet-test',thinking:'high'}}});
 assert.match(JSON.stringify(f.find(await f.pane(),`agent-defaults-${agentUid}`)),/anthropic · claude-sonnet-test · high/);
 await f.press(`agent-details-${agentUid}`);
 assert.match(JSON.stringify(f.find(await f.pane(),`agent-defaults-${agentUid}`)),/claude-sonnet-test · high/);
 const missing=await agentFixture();assert.match(JSON.stringify(missing.find(await missing.pane(),`agent-defaults-${agentUid}`)),/Not configured · Not configured · Not configured/);
 assert.equal(f.calls.some(c=>c.request?.request.action==='agent-send'||c.request?.request.action==='agent-session'),false);
});
