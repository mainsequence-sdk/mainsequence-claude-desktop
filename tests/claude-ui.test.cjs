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
  const elements = Object.fromEntries(['Box', 'Text', 'Button', 'Input', 'Select', 'Code', 'Markdown'].map(type => [type, props => {
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
    store: { get: async () => undefined, set: async (key, value) => { calls.push({ store: key, value }); } },
    command: { register: async spec => { calls.push({ command: spec }); } },
    ui: { resolve: () => elements, invalidate: () => {}, open: async spec => { calls.push({ pane: spec }); },
      toast: value => { calls.push({ toast: value }); }, ask: async () => options.ask || 'Run tool' },
    tool: { register: async spec => { tools.push(spec); return { tool: `mcp__mainsequence__${spec.name}` }; } },
    clock: { now: async () => 1000, after: (ms, callback) => ({ cancel() {} }), every: (ms, callback) => { const timer = { ms, callback, cancel() {} }; timers.push(timer); return timer; } },
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
  return { $, on, emit, pane, press, field, calls, tools, timers, env, find, get nextCalls() { return nextCalls; } };
}

test('Desktop launcher and all native tabs render; terminal surface is left to the engine', async () => {
  const { register } = await load(); const f = fixture(); register(f.on); await f.emit('session.start');
  assert.equal(f.calls[0].command.name, 'ms');
  const band = await f.emit('ui.render', { surface: 'desktop', component: 'AbovePrompt', props: {} });
  assert.ok(f.find(band, 'mainsequence-open'));
  for (const tab of ['Connection', 'Projects', 'Current-Project', 'Accounts', 'MCP', 'Activity', 'Settings']) {
    await f.press(`tab-${tab}`); assert.ok(await f.pane());
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

test('account projection stays private, restores previous engine credentials, and reports identity unverified', async () => {
  const { register } = await load();
  const f = fixture({ env: { CLAUDE_CODE_OAUTH_TOKEN: 'original-secret', CLAUDE_SECURESTORAGE_CONFIG_DIR: '/original' }, respond: domain => {
    const data = { accounts: [{ id: 'a', label: 'Personal', health: 'ready' }], session: {}, config: { mode: 'manual' } };
    if (domain.request.action === 'select') data.projection = { generation: 'generation-1', accountId: 'a', slot: '/profiles/a', credential: { kind: 'keychain', service: 'service-a', user: 'person' }, expiresAt: 1000000 };
    return success(domain.request.action, data);
  } });
  register(f.on); await f.emit('session.start'); await f.press('tab-Accounts'); await f.press('account-list');
  f.find(await f.pane(), 'account-choice').props.onSelect('a');
  await f.press('account-use'); await f.press('confirm-action');
  assert.equal(f.env.get('CLAUDE_CODE_OAUTH_TOKEN'), 'secret-new-token');
  assert.equal(f.env.get('CLAUDE_SECURESTORAGE_CONFIG_DIR'), '/profiles/a');
  const tree = JSON.stringify(await f.pane()); assert.match(tree, /identity unverified/);
  assert.doesNotMatch(tree, /secret-new-token|original-secret|service-a|generation-1/);
  await f.emit('session.end'); assert.equal(f.env.get('CLAUDE_CODE_OAUTH_TOKEN'), 'original-secret');
  assert.equal(f.env.get('CLAUDE_SECURESTORAGE_CONFIG_DIR'), '/original');
  assert.equal(f.calls.filter(c => c.request).at(-1).request.request.action, 'release');
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
  register(f.on); await f.emit('session.start'); await f.press('tab-Projects'); await f.press('list-repositories');
  let choice = f.find(await f.pane(), 'remote-repository'); assert.equal(choice.props.value, '');
  assert.equal(choice.props.options[1].label, 'Real project'); choice.props.onSelect('repo-1'); await flush();
  choice = f.find(await f.pane(), 'repository-branch'); assert.equal(choice.props.value, '');
  choice.props.onSelect('develop'); await f.field('baseDir', '/repos'); await f.press('setup'); await f.press('confirm-action');
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

test('account cards, configuration and sign-in-all use structured dispatch and preserve nonsecret metadata', async () => {
  const { register } = await load();
  const data = { accounts: [{ id: 'a', label: 'Work', health: 'login-needed', organizationName: 'Example Org', plan: 'Team', expiresAt: 1000000,
    usage: { fiveHour: { percentUsed: 40, resetsAt: '2026-10-14T20:00:00Z' }, checkedAt: 1000 } }, { id: 'b', health: 'login-needed' }],
    config: { mode: 'manual', fiveHourThreshold: 90, weeklyThreshold: 95, sameOrganizationOnly: true, display: { session: 'bars', week: 'none' } }, leases: [] };
  const f = fixture({ respond: domain => success(domain.request.action, data) });
  register(f.on); await f.emit('session.start'); await f.press('tab-Accounts'); await f.press('account-list');
  let tree = await f.pane(); assert.match(JSON.stringify(tree), /Example Org|Team|40% used/);
  f.find(tree, 'account-five-hour-threshold').props.onInput('82');
  f.find(await f.pane(), 'account-session-style').props.onSelect('pie');
  await f.press('eligible-a'); await f.press('account-save-settings'); await f.press('confirm-action');
  const saved = f.calls.find(c => c.request?.request.action === 'configure').request.request.config;
  assert.equal(saved.fiveHourThreshold, 82); assert.equal(saved.display.session, 'pie'); assert.deepEqual(saved.eligibleAccountIds, ['b']);
  await f.press('account-login-all'); await f.press('confirm-action');
  assert.deepEqual(f.calls.filter(c => c.request?.request.action === 'login').map(c => c.request.request.accountId), ['a', 'b']);
});

test('host-managed Desktop sessions never automatically recover or refresh account identity', async () => {
  const { register } = await load(); const f = fixture({ respond: domain => success(domain.request.action, { accounts: [], config: { mode: 'automatic' } }) });
  register(f.on); await f.emit('session.start'); await f.press('tab-Accounts'); await f.press('account-list');
  await f.emit('session.measure', { changed: ['rateLimits'] });
  await f.emit('classic.StopFailure', { error: 'authentication_failed' });
  for (const timer of f.timers) timer.callback(); await flush();
  assert.equal(f.calls.filter(c => c.request?.request.action === 'refresh' || c.request?.request.action === 'recover').length, 0);
});
