const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const source = path.resolve(__dirname, '../manifests/claude/hooks/register.mjs');
const load = () => import(pathToFileURL(source).href);
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const success = (action, data) => ({ schemaVersion: 1, action, status: 'success', summary: `${action} completed.`, data });

function fixture(options = {}) {
  const hooks = [], calls = [], tools = [], timers = [], env = new Map(Object.entries(options.env || {}));
  const elements = Object.fromEntries(['Box', 'Text', 'Button', 'Input', 'Select', 'Code', 'Markdown', 'Svg'].map(type => [type, props => {
    if (type === 'Code' && props.wrap !== undefined) assert.equal(typeof props.wrap, 'string');
    if (type === 'Select') assert.ok(props.options.length);
    return { type, props };
  }]));
  let nextCalls = 0;
  const on = (event, matcher, hook) => {
    if (typeof matcher === 'function') { hook = matcher; matcher = {}; }
    const item = { event, matcher, hook }; hooks.push(item);
    return { catch(handler) { item.catch = handler; } };
  };
  const $ = {
    plugin: { root: '/plugin', name: 'mainsequence' },
    session: { cwd: async () => '/work/repo', id: async () => 'session-1', version: async () => ({ version: options.version || '2.1.295' }) },
    store: { get: async () => options.saved, set: async (key, value) => { calls.push({ store: key, value }); } },
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
  return { hooks, $, on, emit, pane, press, field, calls, tools, timers, env, find, get nextCalls() { return nextCalls; } };
}

test('one native pane has five coordinated sections and no above-prompt launcher', async () => {
  const { register } = await load(); const f = fixture(); register(f.on); await f.emit('session.start', {surface:'desktop'});
  assert.equal(f.calls[0].command.name, 'ms');
  assert.deepEqual(f.calls.find(c => c.pane).pane, { id: 'mainsequence', title: 'MainSequence' });
  const band = await f.emit('ui.render', { surface: 'desktop', component: 'AbovePrompt', props: {} });
  assert.equal(band, undefined);
  for (const tab of ['General', 'Projects', 'Current-Project', 'MCP', 'Activity', 'General']) {
    await f.press(`tab-${tab}`); const tree = await f.pane();
    for (const name of ['General', 'Projects', 'Current-Project', 'MCP', 'Activity']) assert.equal(f.find(tree, `tab-${name}`).props.dimColor, name !== tab);
    assert.equal(f.find(tree, 'more-tools'), undefined); assert.equal(f.find(tree, 'tab-Accounts'), undefined);
  }
  assert.deepEqual(await f.emit('ui.render', { surface: 'terminal', component: 'Pane', requestId: 'mainsequence', props: {} }), { type: 'engine', ref: 1 });
  await f.emit('command.run', { command: 'ms' }); assert.equal(f.calls.at(-1).pane.id, 'mainsequence');
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
    if (domain.request.action === 'mcp-list') return success('mcp-list', [{ resource_release_uid: 'release-1', name: 'Project', backend: 'https://backend.example' }]);
    if (domain.request.action === 'mcp-tools') return success('mcp-tools', { tools: [{ name: 'lookup', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }] });
    return success(domain.request.action, {});
  } });
  register(f.on); await f.emit('session.start'); await f.press('tab-MCP'); await f.press('mcp-register');
  assert.equal(f.tools.length, 1);
  const full = 'mcp__mainsequence__' + f.tools[0].name;
  await f.emit('tool.call', { tool: full, tool_use_id: 'call-1', query: 'hello' });
  assert.deepEqual(f.calls.filter(c => c.request).at(-1).request.request.arguments, { query: 'hello' });
  assert.match((await f.emit('tool.call', { tool: 'mcp__mainsequence__missing' })).deny, /no longer connected/);
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
  f.$.env.get = f.$.env.set = f.$.fs.read = f.$.process.run = async () => assert.fail('Claude credential APIs must never be used');
  register(f.on); await f.emit('session.start');
  await f.press('login'); assert.match(JSON.stringify(await f.pane()), /fixture@example.test/);
  await f.press('toggle-connection-actions'); await f.press('refresh-token');
  await f.press('logout'); await f.press('confirm-action'); assert.ok(f.find(await f.pane(), 'login'));
  await f.press('save-settings'); const stored = f.calls.find(c => c.store).value;
  assert.deepEqual(stored.provider, saved.provider); assert.equal(stored.claudeExecutable, saved.claudeExecutable);
  for (const event of ['prompt.submit','turn.start','turn.step','turn.complete','session.measure','classic.StopFailure']) assert.equal(f.hooks.some(h => h.event === event), false, event);
  await f.emit('session.end'); assert.deepEqual(Object.fromEntries(f.env), original);
  assert.ok(f.calls.filter(c => c.request).every(c => c.request.scope !== 'accounts'));
  assert.deepEqual(f.calls.filter(c => c.request?.request.action === 'login').map(c => c.request.scope), ['devtools']);
});

test('Activity has useful empty state navigation, real operation results and collapsed details', async () => {
  const { register } = await load(); const f=fixture(); register(f.on); await f.emit('session.start');
  await f.press('tab-Activity'); assert.match(JSON.stringify(await f.pane()), /No activity yet/);
  await f.press('activity-mcp'); assert.ok(f.find(await f.pane(),'mcp-discover'));
  await f.press('tab-General'); await f.press('auth-status'); await f.press('tab-Activity');
  let tree=await f.pane(); assert.match(JSON.stringify(tree),/Check MainSequence connection/); assert.match(JSON.stringify(tree),/Completed/);
  assert.doesNotMatch(JSON.stringify(tree),/"type":"Code"/);
  await f.press('toggle-activity-session-1-1'); assert.match(JSON.stringify(await f.pane()),/"type":"Code"/);
});

test('startup reads existing MainSequence session without saving or rotating credentials', async () => {
  const {register}=await load(); const f=fixture({ respond: domain => success(domain.request.action, domain.request.action==='workspace-preferences' ? {baseDir:'/existing/repos'} : {backend:'https://saved.example',authenticated:true,username:'saved@example.test'}) });
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
