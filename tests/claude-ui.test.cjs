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

const projectId = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function projectFixture() {
  const project = { uid: projectId(1), name: 'Rates research', description: 'Price curves', organization_environment_uid: projectId(2), code_repository_branch_uids: [projectId(4),projectId(5)] };
  return fixture({ respond: ({request:q}) => {
    let data = {};
    if (q.action === 'mcp-environments') data = [{uid:projectId(2),name:'Research'},{uid:projectId(9),name:'Production'}];
    if (q.action === 'mcp-list' || q.action === 'mcp-discover') data = [];
    if (q.action === 'organization-projects') data = { results:[project],count:30,limit:25,offset:q.offset };
    if (q.action === 'organization-project') data = { project,branches:['main','feature/risk'].map((branch,index)=>({uid:projectId(4+index),code_repository_uid:projectId(3),code_repository_name:'Pricing',repository_branch:branch,is_initialized:true})) };
    if (['organization-project-setup','read-project-workspace'].includes(q.action)) data = {root:'/repos/project-workspace',backend:'https://api.main-sequence.app',name:project.name,projectUid:project.uid,environmentUid:projectId(2),repositories:[{repositoryUid:projectId(3),branchUid:projectId(4),name:'Pricing',path:'/repos/repositories/Pricing',branch:'main'},{repositoryUid:projectId(7),branchUid:projectId(5),name:'Backend',path:'/repos/repositories/Backend',branch:'main'}]};
    return success(q.action,data);
  }});
}
async function selectFixtureProject(f) {
  await f.press('tab-Projects');f.find(await f.pane(),'mcp-environment').props.onSelect(projectId(2));await flush();
  await f.press(`project-${projectId(1)}`);
}

test('MainSequence Projects displays real memberships, pagination and exact resource links',async()=>{
  const {register}=await load();const f=projectFixture();register(f.on);await f.emit('session.start');await selectFixtureProject(f);
  let tree=await f.pane();assert.ok(f.find(tree,`project-repository-${projectId(3)}`));assert.ok(f.find(tree,`project-branch-${projectId(5)}`));
  assert.equal(f.calls.some(call=>call.request?.request.action==='repositories'),false);
  await f.press(`project-branch-${projectId(5)}`);
  const link=f.calls.find(call=>call.request?.request.action==='organization-project-link').request.request;
  assert.equal(link.branchUid,projectId(5));assert.equal(link.environmentUid,projectId(2));assert.equal(link.projectUid,projectId(1));
  await f.press('projects-back');await f.press('projects-next');assert.equal(f.calls.filter(call=>call.request?.request.action==='organization-projects').at(-1).request.request.offset,25);
});
test('project setup confirms the selected project and opens its prepared Claude workspace without sending a prompt',async()=>{
  const {register}=await load();const f=projectFixture();register(f.on);await f.emit('session.start');await selectFixtureProject(f);
  await f.press('project-setup');assert.equal(f.calls.some(call=>call.request?.request.action==='organization-project-setup'),false);
  await f.press('confirm-action');
  const setup=f.calls.find(call=>call.request?.request.action==='organization-project-setup').request.request;
  assert.equal(setup.projectUid,projectId(1));assert.equal(setup.environmentUid,projectId(2));assert.equal(setup.baseDir,'/fixture/home/mainsequence');
  const open=f.calls.find(call=>call.request?.request.action==='open-project-workspace').request.request;
  assert.equal(open.root,'/repos/project-workspace');assert.equal(open.projectUid,projectId(1));assert.equal(f.calls.some(call=>call.submitted),false);
  await f.press('project-open-local');assert.equal(f.calls.filter(call=>call.request?.request.action==='organization-project-setup').length,1);
});
test('changing environment dismisses project setup and clears the previous workspace',async()=>{
  const {register}=await load();const f=projectFixture();register(f.on);await f.emit('session.start');await selectFixtureProject(f);
  await f.press('project-setup');f.find(await f.pane(),'mcp-environment').props.onSelect(projectId(9));await flush();
  assert.equal(f.find(await f.pane(),'confirm-action'),undefined);assert.equal(f.find(await f.pane(),'project-open-local'),undefined);
  assert.equal(f.calls.some(call=>call.request?.request.action==='organization-project-setup'),false);
});
test('a setup finishing after an environment change never opens the old workspace',async()=>{
  const {register}=await load();const f=projectFixture();register(f.on);await f.emit('session.start');await selectFixtureProject(f);
  const finish=delayRequest(f,'organization-project-setup');await f.press('project-setup');await f.press('confirm-action');
  f.find(await f.pane(),'mcp-environment').props.onSelect(projectId(9));await flush();finish();await flush();
  assert.equal(f.calls.some(call=>call.request?.request.action==='open-project-workspace'),false);
  assert.equal(f.find(await f.pane(),'project-open-local'),undefined);
});

function fixture(options = {}) {
  const stores = options.stores || new Map();
  // `tools` lists the MCP and agent tools; the fixed deployment status tool is recorded in `registered`.
  const hooks = [], calls = [], tools = [], registered = [], timers = [], env = new Map(Object.entries({HOME:'/fixture/home',...(options.env || {})}));
  const elements = Object.fromEntries(['Box', 'Text', 'Button', 'Input', 'Select', 'Code', 'Markdown', 'Svg', 'Link'].map(type => [type, props => {
    if (type === 'Code' && props.wrap !== undefined) assert.equal(typeof props.wrap, 'string');
    if (type === 'Select') assert.ok(props.options.length > 0 && props.options.length <= 64, 'Native Select supports 1–64 options');
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
    session: { cwd: async () => options.cwd || '/work/repo', id: async () => hostSessionId, version: async () => ({ version: options.version || '2.1.295' }),
      ...(options.surfaces ? { surfaces: async () => options.surfaces } : {}) },
    store: { get: async key => stores.has(key) ? stores.get(key) : key === 'settings' ? options.saved : key === 'mcp-environments' ? options.environments : undefined, set: async (key, value) => { stores.set(key, value); calls.push({ store: key, value }); } },
    prompt: { read: async () => ({ text: draft, cursor: draft.length }), fill: async value => { calls.push({ filled: value }); if (options.refuseFill) return { isFilled: false }; draft = value.text; return { isFilled: true, text: draft, cursor: draft.length }; }, submit: async value => { calls.push({ submitted: value }); return {}; }, suggest: async value => { calls.push({ suggested: value }); } },
    command: { register: async spec => { calls.push({ command: spec }); }, run: async spec => { calls.push({runCommand:spec}); return options.commandResult ? options.commandResult(spec) : {text:`Added ${spec.args} as a working directory for this session`}; } },
    ui: { resolve: () => elements, invalidate: () => {}, open: async spec => { calls.push({ pane: spec }); },
      toast: value => { calls.push({ toast: value }); }, ask: async () => options.ask || 'Run tool', status: value => { calls.push({ status: value }); } },
    tool: { register: async spec => { registered.push(spec); if (spec.name !== 'ms_deployment_status') tools.push(spec); return { tool: `mcp__mainsequence__${spec.name}` }; } },
    clock: { now: async () => 1000, after: (ms, callback) => { const timer = { ms, callback, cancel() {} }; timers.push(timer); return timer; }, every: (ms, callback) => { const timer = { ms, callback, cancel() {} }; timers.push(timer); return timer; } },
    env: { get: async key => env.get(key), set: async (key, value) => { value === undefined ? env.delete(key) : env.set(key, value); } },
    fs: { read: async () => JSON.stringify({ claudeAiOauth: { accessToken: 'secret-new-token', expiresAt: 1000000 } }) },
    process: {
      run: async () => ({ exitCode: 0, stdout: JSON.stringify({ claudeAiOauth: { accessToken: 'secret-new-token', expiresAt: 1000000 } }), stderr: '' }),
      spawn: input => {
        assert.ok(input.input && !Object.hasOwn(input, 'stdin'));
        assert.deepEqual(input.argv, ['node', '/plugin/dist/claudeRunner.js']);
        assert.equal(input.cwd, options.cwd || '/work/repo');
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
  return { hooks, $, on, emit, pane, press, field, calls, tools, registered, timers, env, stores, find, get draft() { return draft; }, set draft(value) { draft = value; }, set hostSessionId(value) { hostSessionId = value; }, get nextCalls() { return nextCalls; } };
}

test('one native pane has five sections, a status header with Settings and Activity, and no above-prompt launcher', async () => {
  const { register } = await load(); const f = fixture(); register(f.on); await f.emit('session.start', {surface:'desktop'});
  assert.equal(f.calls[0].command.name, 'ms');
  assert.equal(f.calls.some(c => c.pane), false, 'startup must not open a pane');
  const band = await f.emit('ui.render', { surface: 'desktop', component: 'AbovePrompt', props: {} });
  assert.deepEqual(band, { type: 'engine', ref: 1 });
  for (const tab of ['Home', 'Code', 'Projects', 'Agents', 'Tools', 'Settings', 'Activity', 'Home']) {
    await f.press(`tab-${tab}`); const tree = await f.pane();
    for (const name of ['Home', 'Code', 'Projects', 'Agents', 'Tools']) {
      const button = f.find(tree, `tab-${name}`);
      assert.equal(button.props.variant === 'primary', name === tab); assert.equal(!!button.props.dimColor, name !== tab);
    }
    assert.ok(f.find(tree, 'tab-Settings')); assert.ok(f.find(tree, 'tab-Activity')); assert.ok(f.find(tree, 'login'));
    for (const name of ['General', 'Repositories', 'Current-Repository', 'MCP', 'Accounts']) assert.equal(f.find(tree, `tab-${name}`), undefined);
    assert.equal(f.find(tree, 'more-tools'), undefined);
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
    assert.deepEqual(f.calls.findLast(c => c.pane).pane, { id: 'mainsequence', title: 'MainSequence', focus: true, closeOnEscape: true });
    await f.emit('ui.close', { id: 'mainsequence', origin: { kind: 'person' } });
    assert.ok(f.find(await footer(), 'mainsequence-launcher'));
  }
  assert.deepEqual(await f.emit('ui.render', { surface: 'terminal', component: 'SessionMode', props: { modes: ['focus'] } }), { type: 'engine', ref: 1 });
  // A desktop footer draw may start the session's own startup reads; it never writes settings or opens anything else.
  assert.equal(f.calls.slice(callsBefore).every(c => c.pane || ['workspace-preferences', 'auth-status', 'mcp-environments', 'mcp-list', 'mcp-discover', 'read-project-workspace'].includes(c.request?.request.action)), true);
  assert.equal(f.calls.some(c => c.store), false);
  assert.equal(JSON.stringify(saved), settingsBefore);
  f.$.ui.open = async () => { throw new Error('private-host-error'); };
  f.find(await footer(), 'mainsequence-launcher').props.onPress(); await flush();
  assert.match(f.calls.at(-1).toast, /could not open/);
  assert.doesNotMatch(f.calls.at(-1).toast, /private-host-error/);
});

test('native forms run structured actions without model APIs; mutating actions require explicit confirmation', async () => {
  const { register } = await load(); const f = fixture(); register(f.on); await f.emit('session.start');
  await f.press('tab-Settings'); await f.field('backend', 'https://backend.example'); await f.press('auth-status');
  assert.deepEqual(f.calls.find(c => c.request?.request.action === 'auth-status' && c.request.request.check)?.request, { scope: 'devtools', request: { action: 'auth-status', backend: 'https://backend.example', check: true } });
  await f.press('tab-Code'); await f.press('code-open-session'); await f.field('root', '/work/selected');
  const before = f.calls.filter(c => c.request).length;
  await f.press('sync'); assert.equal(f.calls.filter(c => c.request).length, before);
  assert.ok(f.find(await f.pane(), 'tab-Code'), 'navigation stays visible while confirming');
  await f.press('dismiss-confirmation'); assert.equal(f.calls.filter(c => c.request).length, before);
  await f.press('sync'); await f.press('confirm-action');
  assert.deepEqual(f.calls.find(c => c.request?.request.action === 'sync').request.request, { action: 'sync', backend: 'https://backend.example', root: '/work/selected' });
  assert.equal(f.calls.filter(c => c.request).at(-1).request.request.action, 'status');
  assert.deepEqual(f.calls.filter(c => 'status' in c).map(c => c.status).slice(0, 2), ['MainSequence: 1 running', undefined]);
  await f.press('tab-Activity'); const tree = JSON.stringify(await f.pane());
  assert.doesNotMatch(tree, /private-error-token/); assert.match(tree, /sync completed/);
});

test('preview binds the exact container image and digest to the later write', async () => {
  const { register } = await load(); const f = fixture({ respond: domain => domain.request.action === 'devcontainer-preview'
    ? success('devcontainer-preview', { path: '/work/repo/.devcontainer/devcontainer.json', before: '{}', after: '{"image":"my:image"}', expectedDigest: 'digest-123' }) : success(domain.request.action, {}) });
  register(f.on); await f.emit('session.start'); await f.press('tab-Code'); await f.press('code-open-session'); await f.press('toggle-code-container'); await f.field('image', 'my:image');
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
  register(f.on); await f.emit('session.start'); await f.press('tab-Tools'); f.find(await f.pane(),'mcp-environment').props.onSelect('env-1'); await flush();
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
    register(f.on); await f.emit('session.start'); await f.press('tab-Tools');
    f.find(await f.pane(), 'mcp-environment').props.onSelect('env-1'); await flush();
    const display = name === 'Named project' ? name : 'Unnamed MCP';
    let tree = await f.pane();
    assert.equal(f.find(tree, 'mcp-open-release-1').props.label, display);
    assert.match(JSON.stringify(f.find(tree, 'mcp-connected-release-1')), /1 tools/);
    await f.press('tools-add'); tree = await f.pane();
    assert.match(JSON.stringify(f.find(tree, 'mcp-discovered-release-1')), /Discovered project/);
    assert.equal(f.find(tree, 'mcp-add-release-1'), undefined, 'an already connected release shows a badge, not Connect');
    await f.press('tools-back');
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

test('repositories list remote and local copies as rows; setup opens a detail whose branch comes from the API', async () => {
  const { register } = await load(); let cloned = false;
  const f = fixture({ respond: domain => {
    const action = domain.request.action;
    if (action === 'repositories') return success(action, [{ uid: 'repo-1', code_repository_name: 'Real project', branches: [{ uid: 'branch-1', repository_branch: 'develop' }] },
      { uid: 'repo-2', code_repository_name: 'Local project', branches: [{ uid: 'branch-2', repository_branch: 'main' }, { uid: 'branch-3', repository_branch: 'next' }] }]);
    if (action === 'workspace-profile') return success(action, { organization: 'acme' });
    if (action === 'local-repositories') return success(action, [{ name: 'Local project', path: '/repos/acme/projects/Local project-repo-2', repositoryUid: 'repo-2', isGitRepository: true },
      ...(cloned ? [{ name: 'Real project', path: '/repos/acme/projects/Real project-repo-1', repositoryUid: 'repo-1', isGitRepository: true }] : [])]);
    if (action === 'setup') cloned = true;
    return success(action, {});
  } });
  register(f.on); await f.emit('session.start'); await f.press('tab-Settings'); await f.field('baseDir', '/repos'); await f.press('tab-Code');
  let tree = await f.pane();
  assert.ok(f.find(tree, 'code-session'), 'the session folder is listed first');
  assert.ok(f.find(tree, 'setup-repository-repo-1')); assert.equal(f.find(tree, 'open-repository-repo-1'), undefined);
  assert.ok(f.find(tree, 'open-repository-repo-2')); assert.match(JSON.stringify(f.find(tree, 'repository-repo-2')), /Local/);
  await f.press('code-filter-local'); tree = await f.pane(); assert.equal(f.find(tree, 'repository-repo-1'), undefined); assert.ok(f.find(tree, 'repository-repo-2'));
  await f.press('code-filter-all'); await f.press('setup-repository-repo-1');
  const choice = f.find(await f.pane(), 'repository-branch'); assert.equal(choice.props.value, 'develop');
  assert.equal(f.find(await f.pane(), 'setup').props.variant, 'primary');
  await f.press('setup'); await f.press('confirm-action');
  assert.equal(f.calls.find(c => c.request?.request.action === 'setup').request.request.branch, 'develop');
  tree = await f.pane(); assert.ok(f.find(tree, 'sync'), 'after setup the detail shows the local repository');
  assert.equal(f.calls.filter(c => c.request?.request.action === 'status').at(-1).request.request.root, '/repos/acme/projects/Real project-repo-1');
  await f.press('code-back'); assert.ok(f.find(await f.pane(), 'open-repository-repo-1'));
});

test('SDK update is unavailable unless fresh status explicitly supports and offers an update', async () => {
  const { register } = await load(); let supported = false;
  const f = fixture({ respond: domain => success(domain.request.action, { updateAvailable: true, updateSupported: supported }) });
  register(f.on); await f.emit('session.start'); await f.press('tab-Code'); await f.press('code-open-session');
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
  register(f.on); await f.emit('session.start'); await f.pane(); await flush();
  await f.press('login'); assert.match(JSON.stringify(await f.pane()), /fixture@example.test/);
  await f.press('tab-Settings'); await f.press('toggle-connection-actions'); await f.press('refresh-token');
  await f.press('logout'); await f.press('confirm-action'); assert.ok(f.find(await f.pane(), 'login')); assert.ok(f.find(await f.pane(), 'settings-login'));
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
  await f.press('tab-Settings'); await f.press('auth-status'); await f.press('tab-Activity');
  let tree=await f.pane(); assert.match(JSON.stringify(tree),/Check MainSequence connection/); assert.match(JSON.stringify(tree),/Completed/);
  assert.doesNotMatch(JSON.stringify(tree),/"type":"Code"/);
  await f.press('toggle-activity-' + f.calls.findLast(c=>c.request?.request.action==='auth-status').id); assert.match(JSON.stringify(await f.pane()),/"type":"Code"/);
});

test('startup reads existing MainSequence session without saving or rotating credentials', async () => {
  const {register}=await load(); const f=fixture({ respond: domain => success(domain.request.action, domain.request.action==='workspace-preferences' ? {backend:'https://saved.example',baseDir:'/existing/repos'} : {backend:'https://saved.example',authenticated:true,username:'saved@example.test'}) });
  register(f.on); await f.emit('session.start',{surface:'desktop'});
  for(const timer of f.timers.filter(t=>t.ms===0))timer.callback(); await flush();
  assert.match(JSON.stringify(await f.pane()),/saved@example.test/); await f.press('tab-Settings'); const tree=await f.pane();
  assert.equal(f.find(tree,'field-backend').props.value,'https://saved.example');
  assert.equal(f.find(tree,'field-baseDir').props.value,'/existing/repos');
  assert.equal(f.calls.some(c=>c.store),false);
  assert.deepEqual(f.calls.filter(c=>c.request).map(c=>c.request.request.action),['workspace-preferences','auth-status']);
  assert.equal(f.calls.find(c=>c.request?.request.action==='auth-status').request.request.check,false);
});

test('late repository results cannot restore a previous backend selection', async () => {
  const {register}=await load();const f=fixture();register(f.on);await f.emit('session.start');
  await f.press('tab-Settings'); await f.field('backend','https://old.example');
  const originalSpawn=f.$.process.spawn;let finish;
  f.$.process.spawn=input=>{
    const envelope=JSON.parse(input.input);
    if(envelope.request.request.action!=='repositories')return originalSpawn(input);
    const gate=new Promise(resolve=>{finish=resolve});
    const stream=(async function*(){await gate;yield{stream:'stdout',text:JSON.stringify({type:'result',id:envelope.id,result:success('repositories',[{uid:'old',code_repository_name:'Old backend repository',branches:[]}])})+'\n'};})();
    stream.result=Promise.resolve({code:0});return stream;
  };
  await f.press('tab-Code');await f.press('tab-Settings');await f.field('backend','https://new.example');finish();await flush();
  f.$.process.spawn=originalSpawn;await f.press('tab-Code');
  assert.doesNotMatch(JSON.stringify(await f.pane()),/Old backend repository/);
});


test('actual defaults are editable before initialization and usable without saving even when login fails',async()=>{
 const {register}=await load();
 const f=fixture({respond:domain=>domain.request.action==='workspace-preferences'?success('workspace-preferences',{backend:'https://api.main-sequence.app',baseDir:'/fixture/home/mainsequence'}):{schemaVersion:1,action:domain.request.action,status:'failure',summary:'No saved session'}});
 register(f.on);await f.emit('session.start',{surface:'desktop'});await f.press('tab-Settings');
 let tree=await f.pane();assert.equal(f.find(tree,'field-backend').props.value,'https://api.main-sequence.app');assert.equal(f.find(tree,'field-backend').props.placeholder,'');assert.equal(f.find(tree,'field-baseDir').props.value,'/fixture/home/mainsequence');
 for(const timer of f.timers.filter(t=>t.ms===0))timer.callback();await flush();
 await f.press('auth-status');assert.equal(f.calls.filter(c=>c.request).at(-1).request.request.backend,'https://api.main-sequence.app');
 assert.equal(f.calls.some(c=>c.store),false);
});
test('saved and user-edited settings win over late defaults, with unknown saved fields retained',async()=>{
 const {register}=await load();const saved={backend:'https://existing.example',baseDir:'/existing',provider:{name:'keep'}};
 const f=fixture({saved,respond:d=>success(d.request.action,{backend:'https://discovered.example',baseDir:'/discovered'})});register(f.on);await f.emit('session.start',{surface:'desktop'});await f.press('tab-Settings');
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
 }});register(f.on);await f.emit('session.start');await f.press('tab-Tools');
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
 await f.press('tab-Settings');assert.equal(f.find(await f.pane(),'field-backend').props.value,backend);
});

test('a folder chosen during startup survives preferences resolution without saving', async () => {
  const { register } = await load();
  const f = fixture({ respond: d => success(d.request.action, d.request.action === 'pick-folder'
    ? { path: '/chosen/repos' } : { backend: 'https://default.example', baseDir: '/default/repos' }) });
  register(f.on); await f.emit('session.start', { surface: 'desktop' }); await f.press('tab-Settings');
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
  register(f.on); await f.emit('session.start'); await f.press('tab-Tools');
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
const iconImage = pose => ({ source: `<svg xmlns="http://www.w3.org/2000/svg"><text>${pose}</text></svg>`, stillSource: `<svg xmlns="http://www.w3.org/2000/svg"><text>${pose}-still</text></svg>`, animated: true });
const iconResponse = r => r.action === 'agent-icons' ? success(r.action, { environmentUid: r.environmentUid, account: 'agent-user@example.test',
  icons: Object.fromEntries(r.agentUids.map(uid => [uid, { images: { idle: iconImage('idle'), ...(r.includePoses ? { thinking: iconImage('thinking'), error: iconImage('error') } : {}) }, toolPoses: {}, posesLoaded: r.includePoses }])) }) : undefined;
const svgNodes = tree => !tree || typeof tree !== 'object' ? [] : [...(tree.type === 'Svg' ? [tree] : []), ...(tree.props?.children || []).flatMap(svgNodes)];

test('agent icons appear in list, details, composer activity and historical command output with shared caching', async () => {
 const f = await agentFixture({ respond: iconResponse });
 assert.ok(svgNodes(await f.pane()).some(node => node.props.width === 20 && node.props.source.includes('idle')));
 await f.press(`agent-details-${agentUid}`);
 assert.ok(svgNodes(await f.pane()).some(node => node.props.width === 32));
 await f.press('agents-back'); await f.startTalk();
 const mediaCalls = f.calls.filter(call => call.request?.request.action === 'agent-icons').length;
 await f.startTalk(); assert.equal(f.calls.filter(call => call.request?.request.action === 'agent-icons').length, mediaCalls);
 const finish = delayRequest(f, 'agent-send'), pending = f.send(); await flush();
 let footer = await f.emit('ui.render', { component: 'AbovePrompt', surface: 'desktop', props: {} });
 assert.ok(svgNodes(footer).some(node => node.props.source.includes('thinking') && node.props.isInteractive === false));
 const row = await f.emit('ui.render', { component: 'ToolUse', surface: 'desktop', props: { tool: f.tool('send'), isRunning: true } });
 assert.ok(svgNodes(row).some(node => node.props.source.includes('thinking')));
 finish(); const reply = await pending;
 const historical = await f.emit('ui.render', { component: 'CommandOutput', surface: 'desktop', props: { command: 'ms', text: reply.text } });
 assert.ok(svgNodes(historical).some(node => node.props.source.includes('idle-still') && !node.props.isInteractive));
 const prefixed = await f.emit('ui.render', { component: 'CommandOutput', surface: 'desktop', props: { command: 'ms', text: `mainsequence: ${reply.text}` } });
 assert.ok(svgNodes(prefixed).some(node => node.props.source.includes('idle-still')));
 assert.equal((await f.emit('ui.render', { component: 'CommandOutput', surface: 'desktop', props: { command: 'ms', text: `other-plugin: ${reply.text}` } })).type, 'engine');
 assert.equal((await f.emit('ui.render', { component: 'CommandOutput', surface: 'desktop', props: { command: 'other', text: reply.text } })).type, 'engine');
 assert.doesNotMatch(JSON.stringify(await f.emit('ui.render', { component: 'ToolUse', surface: 'terminal', props: { tool: f.tool('send'), isRunning: true } })), /idle|thinking/);
 await f.press('tab-Activity'); assert.doesNotMatch(JSON.stringify(await f.pane()), /agent-icons|idle-still|thinking-still/);
});

test('media avoids text truncation, is never persisted and cannot survive an environment change', async () => {
 const longSource = `<svg xmlns="http://www.w3.org/2000/svg"><!--${'x'.repeat(20000)}--></svg>`;
 const f = await agentFixture({ respond: r => {
   const result = iconResponse(r); if (result) for (const icon of Object.values(result.data.icons)) icon.images.idle.source = longSource;
   return result;
 } });
 assert.ok(svgNodes(await f.pane()).some(node => node.props.source === longSource));
 assert.doesNotMatch(JSON.stringify([...f.stores.values()]), /<svg|data:image/);
 const finish = delayRequest(f, 'agent-icons'); await f.press('agents-refresh');
 f.find(await f.pane(), 'mcp-environment').props.onSelect(agentId(9)); await flush(); finish(); await flush();
 assert.equal(svgNodes(await f.pane()).filter(node => node.props.source === longSource).length, 0);
 assert.equal(f.find(await f.emit('ui.render', { component: 'AbovePrompt', surface: 'desktop', props: {} }), 'agent-chat-activity'), undefined);
});

test('icon delivery failure leaves Talk and direct messaging available', async () => {
 const f = await agentFixture({ respond: r => r.action === 'agent-icons' ? { ...success(r.action), status: 'failure', summary: 'Optional media unavailable' } : undefined });
 await f.startTalk(); assert.match((await f.send()).text, /Reply from Research/);
 assert.ok(f.find(await f.pane(), `agent-talk-${agentUid}`));
});

test('failed media revalidation retains a displayed icon', async () => {
 let unavailable = false;
 const f = await agentFixture({ respond: r => {
   const result = iconResponse(r);
   if (unavailable && result) for (const icon of Object.values(result.data.icons)) icon.images.idle = null;
   return result;
 } });
 unavailable = true; await f.press('agents-refresh');
 assert.ok(svgNodes(await f.pane()).some(node => node.props.source.includes('<text>idle</text>')));
});

test('Talk resolves a session and prefills an editable draft with no auto-send or introduction',async()=>{
 const f=await agentFixture({draft:'What is the exposure?'});
 assert.doesNotMatch(JSON.stringify(await f.pane()),/Explain portfolio risk/);
 await f.press(`agent-details-${agentUid}`);assert.match(JSON.stringify(await f.pane()),/Explain portfolio risk/);await f.press('agents-back');
 await f.startTalk();assert.equal(f.draft,'/ms @research-assistant What is the exposure?');
 assert.equal(f.calls.filter(c=>c.submitted||c.suggested).length,0);
 assert.equal(f.calls.filter(c=>c.request?.request.action==='agent-send').length,0);
 const opened=f.calls.find(c=>c.request?.request.action==='agent-session').request.request;
 assert.match(opened.handleId,/^claude_[a-f0-9]+_.*_default$/);assert.equal(opened.expectedAccount,'agent-user@example.test');assert.equal(opened.parentSessionUid,undefined);
 await f.startTalk();assert.equal(f.draft,'/ms @research-assistant What is the exposure?');assert.equal(f.calls.filter(c=>c.request?.request.action==='agent-session').length,1);
 f.$.ui.ask=async()=>{throw new Error('Explicit user submission must not ask twice')};
 assert.match((await f.send('Only my message')).text,/Reply from Research/);
 const sent=f.calls.find(c=>c.request?.request.action==='agent-send').request.request;
 assert.equal(sent.message,'Only my message');assert.equal(sent.sessionUid,agentSession);assert.equal(sent.handleId,undefined);
 assert.equal(f.tools.some(t=>t.name.includes('introduce')),false);
});
test('draft retargeting keeps its text; unrelated slash commands and refused filling are preserved',async()=>{
 const f=await agentFixture({twoAgents:true,draft:'Keep\nall my text'});await f.startTalk();await f.startTalk(secondUid);
 assert.equal(f.draft,'/ms @crm-assistant Keep\nall my text');
 f.draft='/review something';await f.startTalk();assert.equal(f.draft,'/review something');
 const blocked=await agentFixture({refuseFill:true,draft:'Keep this'});await blocked.startTalk();assert.equal(blocked.draft,'Keep this');assert.match(blocked.calls.at(-1).toast,/could not fill/);
 assert.equal(blocked.calls.some(c=>c.submitted),false);
});
test('preparation and waiting affect only the correct card; changing selection keeps the original request valid',async()=>{
 const f=await agentFixture({twoAgents:true});const finishOpen=delayRequest(f,'agent-session',agentUid);
 await f.startTalk();let tree=await f.pane();assert.match(JSON.stringify(f.find(tree,`agent-status-${agentUid}`)),/Opening session/);assert.equal(f.find(tree,`agent-status-${secondUid}`),undefined);assert.equal(f.find(tree,`agent-talk-${agentUid}`).props.label,'Talk');assert.equal(f.find(tree,`agent-talk-${secondUid}`).props.label,'Talk');
 await f.startTalk(secondUid);finishOpen();await flush();assert.equal(f.draft,'/ms @crm-assistant ');
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
 f.$.tool.register=register;await f.startTalk();assert.equal(f.draft,'/ms @research-assistant ');assert.equal(f.calls.filter(c=>c.submitted||c.request?.request.action==='agent-send').length,0);
 const unavailable=await agentFixture({respond:r=>r.action==='agent-session'?{schemaVersion:1,action:r.action,status:'failure',summary:'Model configuration required'}:null});await unavailable.startTalk();
 assert.equal(unavailable.draft,'');assert.match(unavailable.calls.at(-1).toast,/Model configuration/);
});


test('returning to an agent that is still opening makes it the final selection without duplicate allocation', async () => {
 const f=await agentFixture({twoAgents:true}); const finish=delayRequest(f,'agent-session',agentUid);
 await f.startTalk(); await f.startTalk(secondUid); await f.startTalk(agentUid); finish(); await flush();
 assert.equal(f.draft,'/ms @research-assistant ');
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
 assert.equal(f.draft,'/ms @research-assistant Keep my edited question');
 assert.equal(f.calls.filter(c=>c.filled).length,1);assert.equal(f.calls.some(c=>c.submitted),false);
});
test('late ready cannot replace another selected agent; resumed Talk checks again',async()=>{
 const f=await agentFixture({twoAgents:true});const finish=delayRequest(f,'agent-readiness',agentUid);
 await f.startTalk();await f.startTalk(secondUid);finish();await flush();
 assert.equal(f.draft,'/ms @crm-assistant ');
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

test('session renewal belongs to Settings and never appears in Code or Projects',async()=>{
 const f=await agentFixture();await f.press('tab-Settings');
 await f.press('toggle-connection-actions');assert.ok(f.find(await f.pane(),'refresh-token'));
 for(const tab of ['Code','Projects','Home']){await f.press(`tab-${tab}`);assert.equal(f.find(await f.pane(),'refresh-token'),undefined);}
 await f.press('tab-Settings');assert.ok(f.find(await f.pane(),'refresh-token'));
});

test('agent defaults appear beneath the name without exposing or changing provider configuration',async()=>{
 const f=await agentFixture({agent:{defaults:{provider:'anthropic',model:'claude-sonnet-test',thinking:'high'}}});
 assert.match(JSON.stringify(f.find(await f.pane(),`agent-defaults-${agentUid}`)),/anthropic · claude-sonnet-test · high/);
 await f.press(`agent-details-${agentUid}`);
 assert.match(JSON.stringify(f.find(await f.pane(),`agent-defaults-${agentUid}`)),/claude-sonnet-test · high/);
 const missing=await agentFixture();assert.equal(missing.find(await missing.pane(),`agent-defaults-${agentUid}`),undefined,'absent defaults draw nothing');
 assert.doesNotMatch(JSON.stringify(await missing.pane()),/Not configured/);
 assert.equal(f.calls.some(c=>c.request?.request.action==='agent-send'||c.request?.request.action==='agent-session'),false);
});

test('opening the named workspace attaches both saved memberships, retries failures, and ignores unrelated sessions',async()=>{
  const {register}=await load(); const {workspaceBinding}=await import('../manifests/claude/hooks/workspace.mjs');
  const w={root:'/repos/project/Ontology',backend:'https://fixture.example',projectUid:projectId(1),environmentUid:projectId(2),name:'Ontology',repositories:[
    {repositoryUid:projectId(3),branchUid:projectId(4),name:'Ontology',branch:'main',path:'/repos/project/repositories/Ontology'},
    {repositoryUid:projectId(7),branchUid:projectId(8),name:'OntologyBackend',branch:'main',path:'/repos/project/repositories/OntologyBackend'}]};
  const stores=new Map([[`project-workspace:${w.root}`,workspaceBinding(w)]]);let fail=true;
  const f=fixture({cwd:w.root,stores,respond:({request:q})=>success(q.action,q.action==='read-project-workspace'?w:{}),commandResult:spec=>({text:fail&&spec.args.endsWith('OntologyBackend')?'Path was not found.':`Added ${spec.args} as a working directory for this session`})});
  register(f.on);await f.emit('session.start',{surface:'desktop'});for(const timer of f.timers.filter(t=>t.ms===0))timer.callback();await flush();
  assert.deepEqual(f.calls.filter(c=>c.runCommand).map(c=>c.runCommand.args),w.repositories.map(r=>r.path));
  assert.ok(f.find(await f.pane(),'workspace-attach-retry'));fail=false;await f.press('workspace-attach-retry');
  assert.equal(f.calls.filter(c=>c.runCommand).length,3);assert.equal(f.calls.filter(c=>c.runCommand).at(-1).runCommand.args,w.repositories[1].path);
  assert.equal(f.find(await f.pane(),'workspace-attach-retry'),undefined);assert.match(JSON.stringify(await f.pane()),/Ontology: 2 repository checkouts attached/);
  assert.equal(f.calls.some(c=>c.submitted),false);
  const unrelated=fixture({stores});register(unrelated.on);await unrelated.emit('session.start',{surface:'desktop'});for(const timer of unrelated.timers.filter(t=>t.ms===0))timer.callback();await flush();
  assert.equal(unrelated.calls.some(c=>c.runCommand),false);
});
test('attachment rejects covered descendants and unconfirmed native command results',async()=>{
  const {attachProjectRepositories}=await load();
  const w={root:'/p/Ontology',backend:'https://fixture.example',projectUid:'p',environmentUid:'e',name:'Ontology',repositories:[{path:'/p/repos/ontology',name:'Ontology',branch:'main'}]};
  for(const text of ['', 'Path /p/repos/ontology was not found.', '/p/repos/ontology is inside the current working directory /p']) {
    const attached=new Set();await assert.rejects(attachProjectRepositories({command:{run:async()=>({text})}},w,attached,()=>true,()=>{}),/could not attach/);assert.equal(attached.size,0);
  }
});
test('changed workspace membership is never automatically attached',async()=>{
  const {register}=await load(),{workspaceBinding}=await import('../manifests/claude/hooks/workspace.mjs');
  const w={root:'/p/Ontology',backend:'https://fixture.example',projectUid:'p',environmentUid:'e',name:'Ontology',repositories:[{path:'/p/repos/ontology',name:'Ontology',branch:'main',repositoryUid:'r',branchUid:'b'}]};
  const stores=new Map([[`project-workspace:${w.root}`,workspaceBinding(w)]]);
  const f=fixture({cwd:w.root,stores,respond:({request:q})=>success(q.action,q.action==='read-project-workspace'?{...w,repositories:[{...w.repositories[0],path:'/p/repos/other'}]}:{})});
  register(f.on);await f.emit('session.start',{surface:'desktop'});for(const timer of f.timers.filter(t=>t.ms===0))timer.callback();await flush();
  assert.equal(f.calls.some(c=>c.runCommand),false);assert.match(JSON.stringify(await f.pane()),/membership changed/);
});

test('Home shows next steps until sign-in, environment and folder are settled, then session status on request', async () => {
  const { register } = await load(); let signedIn = false;
  const f = fixture({ env: { HOME: '' }, respond: d => {
    const q = d.request;
    if (q.action === 'workspace-preferences') return success(q.action, { backend: 'https://api.main-sequence.app' });
    if (q.action === 'login') signedIn = true;
    if (q.action === 'auth-status') return success(q.action, { authenticated: signedIn, username: 'home@example.test' });
    if (q.action === 'mcp-environments') return success(q.action, [{ uid: 'env-1', name: 'Research' }]);
    if (q.action === 'status') return success(q.action, { project: { root: '/work/repo', branch: 'main', commit: 'abcdef1234', projectType: 'python' }, capabilities: [] });
    if (q.action === 'sdk-status') return success(q.action, { installed: '1.8.2', latest: '1.9.0', updateAvailable: true, updateSupported: true });
    if (q.action === 'pick-folder') return success(q.action, { path: '/chosen' });
    return success(q.action, { count: 0, results: [] });
  } });
  register(f.on); await f.emit('session.start', { surface: 'desktop' }); for (const timer of f.timers.filter(t => t.ms === 0)) timer.callback(); await flush();
  let tree = await f.pane(); assert.ok(f.find(tree, 'step-login')); assert.ok(f.find(tree, 'step-folder')); assert.equal(f.find(tree, 'step-row-environment'), undefined);
  assert.ok(f.find(tree, 'login'), 'header offers sign-in'); assert.equal(f.find(tree, 'mcp-environment'), undefined);
  await f.press('step-login'); tree = await f.pane(); assert.equal(f.find(tree, 'step-login'), undefined); assert.ok(f.find(tree, 'step-row-environment'));
  assert.match(JSON.stringify(tree), /home@example.test/);
  await f.press('step-environments'); f.find(await f.pane(), 'mcp-environment').props.onSelect('env-1'); await flush();
  await f.press('step-folder'); tree = await f.pane(); assert.equal(f.find(tree, 'step-row-environment'), undefined); assert.equal(f.find(tree, 'step-folder'), undefined);
  assert.equal(f.find(tree, 'step-login'), undefined);
  assert.equal(f.calls.some(c => c.request?.request.action === 'status'), false, 'status is not spawned until requested');
  await f.press('home-status'); tree = await f.pane();
  assert.match(JSON.stringify(tree), /"Branch".*"main"/); assert.match(JSON.stringify(tree), /1\.8\.2 → 1\.9\.0 available/); assert.ok(f.find(tree, 'home-update-sdk'));
  assert.match(JSON.stringify(f.find(tree, 'tab-Activity')), /Activity/);
  assert.ok(f.find(tree, 'recent-' + f.calls.find(c => c.request?.request.action === 'status').id));
});

test('the header blocks Projects, Agents and Tools until an environment is chosen, without hiding navigation', async () => {
  const { register } = await load();
  const f = fixture({ respond: d => success(d.request.action, d.request.action === 'auth-status' ? { authenticated: true, username: 'u' } : d.request.action === 'mcp-environments' ? [{ uid: 'env-1', name: 'Research' }] : {}) });
  register(f.on); await f.emit('session.start', { surface: 'desktop' }); for (const timer of f.timers.filter(t => t.ms === 0)) timer.callback(); await flush();
  for (const tab of ['Projects', 'Agents', 'Tools']) {
    await f.press(`tab-${tab}`); const tree = await f.pane();
    assert.match(JSON.stringify(tree), /Choose an organization environment/); assert.ok(f.find(tree, 'tab-Home'));
    assert.equal(f.find(tree, 'tools-add'), undefined); assert.equal(f.find(tree, 'field-agentSearch'), undefined); assert.equal(f.find(tree, 'field-projectSearch'), undefined);
  }
  f.find(await f.pane(), 'mcp-environment').props.onSelect('env-1'); await flush();
  const tree = await f.pane(); assert.doesNotMatch(JSON.stringify(tree), /Choose an organization environment/); assert.ok(f.find(tree, 'tools-add'));
});

test('Tools lists connections as rows, adds MCPs through search with confirmation, and keeps the explorer under Advanced', async () => {
  const { register } = await load(); const connected = [];
  const f = fixture({ respond: d => {
    const q = d.request;
    if (q.action === 'mcp-environments') return success(q.action, [{ uid: 'env-1', name: 'Research' }]);
    if (q.action === 'mcp-list') return success(q.action, connected.map(uid => ({ resource_release_uid: uid, name: `MCP ${uid}`, backend: 'https://api.main-sequence.app', mcp_connection: { organization_environment_uid: 'env-1', organization_environment_name: 'Research' } })));
    if (q.action === 'mcp-discover') return success(q.action, { count: 2, results: ['r1', 'r2'].map(uid => ({ resource_release_uid: uid, name: `MCP ${uid}`, mcp_connection: { organization_environment_uid: 'env-1' } })) });
    if (q.action === 'mcp-add') connected.push(q.releaseUid);
    if (q.action === 'mcp-remove') connected.splice(connected.indexOf(q.releaseUid), 1);
    if (q.action === 'mcp-tools') return success(q.action, { tools: [{ name: 'lookup', description: 'Find things', inputSchema: { type: 'object' } }] });
    return success(q.action, {});
  } });
  register(f.on); await f.emit('session.start'); await f.press('tab-Tools'); f.find(await f.pane(), 'mcp-environment').props.onSelect('env-1'); await flush();
  let tree = await f.pane(); assert.match(JSON.stringify(tree), /No MCPs connected/); assert.equal(f.find(tree, 'mcp-call'), undefined);
  await f.press('tools-add'); tree = await f.pane(); assert.ok(f.find(tree, 'mcp-add-r1')); assert.ok(f.find(tree, 'mcp-add-r2'));
  await f.press('mcp-add-r2'); assert.equal(f.calls.some(c => c.request?.request.action === 'mcp-add'), false);
  assert.match(JSON.stringify(await f.pane()), /Connect MCP r2 in Research/);
  await f.press('confirm-action');
  assert.equal(f.calls.find(c => c.request?.request.action === 'mcp-add').request.request.releaseUid, 'r2');
  assert.equal(f.tools.length, 1, 'tools register after connecting');
  tree = await f.pane(); assert.equal(f.find(tree, 'mcp-add-r2'), undefined); assert.ok(f.find(tree, 'mcp-add-r1'));
  await f.press('tools-back'); tree = await f.pane(); assert.ok(f.find(tree, 'mcp-connected-r2')); assert.match(JSON.stringify(f.find(tree, 'mcp-connected-r2')), /1 tools/);
  await f.press('mcp-open-r2'); tree = await f.pane(); assert.ok(f.find(tree, 'tool-lookup')); assert.equal(f.find(tree, 'mcp-call'), undefined);
  await f.press('toggle-tools-advanced'); tree = await f.pane(); assert.ok(f.find(tree, 'mcp-call')); assert.ok(f.find(tree, 'mcp-register'));
  await f.press('tools-back'); await f.press('mcp-remove-r2'); await f.press('confirm-action');
  assert.equal(f.calls.find(c => c.request?.request.action === 'mcp-remove').request.request.releaseUid, 'r2');
  assert.match(JSON.stringify(await f.pane()), /No MCPs connected/);
});

test('/ms @handle <message> names the receiving agent, bare and keyword forms are refused, and example questions prefill the draft', async () => {
  const f = await agentFixture({ draft: 'Keep this' }); await f.startTalk(); assert.equal(f.draft, '/ms @research-assistant Keep this');
  assert.match((await f.emit('command.run', { command: 'ms', args: 'What is my exposure?', origin: { kind: 'composer' } })).text, /\/ms @research-assistant <message>/, 'a bare message names the prepared handles');
  assert.match((await f.emit('command.run', { command: 'ms', args: '@research-assistant What is my exposure?', origin: { kind: 'composer' } })).text, /Reply from Research/);
  assert.equal(f.calls.filter(c => c.request?.request.action === 'agent-send').at(-1).request.request.message, 'What is my exposure?');
  assert.match((await f.emit('command.run', { command: 'ms', args: 'agent not-a-uid hello', origin: { kind: 'composer' } })).text, /Name the agent/);
  assert.equal(f.calls.filter(c => c.request?.request.action === 'agent-send').length, 1);
  await f.press(`agent-details-${agentUid}`); await f.press(`agent-example-${agentUid}-0`);
  assert.equal(f.draft, '/ms @research-assistant Explain exposure'); assert.equal(f.calls.some(c => c.submitted), false);
  const band = await f.emit('ui.render', { surface: 'desktop', component: 'AbovePrompt', props: {} });
  assert.ok(f.find(band, 'agent-switch')); f.find(band, 'agent-switch').props.onPress(); await flush();
  assert.equal(f.calls.at(-1).pane.focus, true); assert.equal(f.find(await f.pane(), `agent-talk-${agentUid}`).props.variant, 'primary');
  const taskOnly = await agentFixture({ agent: { responseKinds: ['task'] } }); await taskOnly.startTalk(); assert.equal(taskOnly.draft, '/ms task @research-assistant ');
  assert.equal((await taskOnly.emit('command.run', { command: 'ms', args: 'task @research-assistant Analyze', origin: { kind: 'composer' } })).text.includes('Task'), true);
  const fresh = await agentFixture(); assert.match((await fresh.emit('command.run', { command: 'ms', args: '@research-assistant hello', origin: { kind: 'composer' } })).text, /choose Talk/);
  assert.equal(fresh.calls.some(c => c.request?.request.action === 'agent-send'), false);
});

test('restored panes initialize without session.start and repeated startup never opens the pane', async () => {
  const { register } = await load(); const f = fixture(); register(f.on);
  assert.match(JSON.stringify(await f.pane()), /Loading MainSequence/);
  await flush();
  assert.ok(f.find(await f.pane(), 'tab-Home'));
  await f.emit('session.start', {surface:'desktop'});
  await f.emit('session.start', {surface:'desktop'});
  assert.equal(f.calls.filter(c => c.command).length, 1);
  assert.equal(f.calls.some(c => c.pane), false);
});

test('render faults show a retry screen and recover without replaying actions', async () => {
  const { register } = await load(); const f = fixture(); register(f.on); await f.emit('session.start');
  await f.press('tab-Tools');
  const requests = f.calls.filter(c => c.request).length;
  await f.emit('ui.fault', {surface:'desktop', component:'Pane', requestId:'mainsequence', phase:'draw', element:'Svg'});
  assert.ok(f.find(await f.pane(), 'retry-pane'));
  await f.press('retry-pane');
  assert.ok(f.find(await f.pane(), 'mcp-environments'));
  assert.equal(f.calls.filter(c => c.request).length, requests);
  const resolve = f.$.ui.resolve;
  f.$.ui.resolve = () => ({...resolve(), Svg() { throw new Error('private-render-error'); }});
  assert.ok(f.find(await f.pane(), 'retry-pane'));
  assert.doesNotMatch(JSON.stringify(await f.pane()), /private-render-error/);
  f.$.ui.resolve = resolve;
  await f.press('retry-pane');
  assert.ok(f.find(await f.pane(), 'tab-Tools'));
});

test('failed startup can be retried without leaving an empty pane', async () => {
  const { register } = await load(); const f = fixture(); register(f.on);
  const get = f.$.store.get;
  f.$.store.get = async () => { throw new Error('private-store-error'); };
  await f.emit('session.start', {surface:'desktop'});
  assert.ok(f.find(await f.pane(), 'retry-pane'));
  f.$.store.get = get;
  await f.press('retry-pane');
  assert.ok(f.find(await f.pane(), 'tab-Home'));
  assert.equal(f.calls.some(c => c.pane), false);
});

async function setupFixture() {
  const { register } = await load();
  const f = fixture({ respond: d => success(d.request.action,
    d.request.action === 'repositories' ? ['a', 'b'].map(uid => ({uid, code_repository_name: `Repo ${uid}`, branches:[{repository_branch:'main'},{repository_branch:'develop'}]}))
      : d.request.action === 'local-repositories' ? [] : d.request.action === 'setup' ? {root:'/repos/a'} : {}) });
  register(f.on); await f.emit('session.start'); await f.press('tab-Settings'); await f.field('baseDir', '/repos'); await f.press('tab-Code');
  await f.press('setup-repository-a');
  f.find(await f.pane(), 'repository-branch').props.onSelect('main'); await flush();
  const original = f.$.process.spawn;
  let finish;
  f.$.process.spawn = input => {
    const envelope = JSON.parse(input.input);
    if (envelope.request.request.action !== 'setup') return original(input);
    f.calls.push(envelope);
    let done; const result = new Promise(resolve => { done = resolve; });
    let complete; const gate = new Promise(resolve => { complete = resolve; });
    const stream = (async function* () {
      yield {stream:'stdout', text:JSON.stringify({type:'progress', id:envelope.id, message:'Cloning Repo a…'})+'\n'};
      const answer = await gate;
      yield {stream:'stdout', text:JSON.stringify({type:'result', id:envelope.id, result:answer})+'\n'};
      done({code:0,signal:null}); return {code:0,signal:null};
    })();
    stream.result = result;
    finish = complete;
    stream.return = async () => { done({code:null,signal:'SIGTERM'}); complete({schemaVersion:1,action:'setup',status:'cancelled',summary:'Setup cancelled.'}); return {done:true}; };
    return stream;
  };
  f.finishSetup = answer => finish(answer);
  return f;
}

test('setup displays streamed progress, prevents duplicates, and retains target-specific status across navigation', async () => {
  const f = await setupFixture();
  // Retain the callback too: a stale click must not bypass the operation guard.
  const setup = f.find(await f.pane(), 'setup').props.onPress;
  await f.press('setup'); await f.press('confirm-action');
  let tree = await f.pane();
  assert.match(JSON.stringify(tree), /Cloning Repo a/);
  assert.equal(f.find(tree, 'setup').props.disabled, true);
  setup(); await flush(); assert.equal(f.find(await f.pane(), 'confirm-action'), undefined);
  assert.equal(f.calls.filter(c => c.request?.request.action === 'setup').length, 1);
  await f.press('tab-Settings'); assert.match(JSON.stringify(await f.pane()), /Setting up Repo a · main: Cloning Repo a/);
  await f.press('tab-Code'); await f.press('code-back'); await f.press('setup-repository-b');
  tree = await f.pane(); assert.doesNotMatch(JSON.stringify(f.find(tree, 'setup')), /Setting up/);
  assert.match(JSON.stringify(tree), /Setting up Repo a · main/, 'another repository still shows the running setup in the header');
  await f.press('code-back'); await f.press('setup-repository-a');
  f.find(await f.pane(), 'repository-branch').props.onSelect('main'); await flush();
  assert.match(JSON.stringify(await f.pane()), /Cloning Repo a/);
  f.finishSetup(success('setup',{root:'/repos/a'})); await flush();
  tree = await f.pane(); assert.match(JSON.stringify(tree), /Local setup completed/);
  assert.ok(f.find(tree, 'setup-open')); assert.equal(f.find(tree, 'cancel-setup'), undefined);
});

test('setup failure and cancellation release controls and never retry the operation automatically', async () => {
  for (const cancelled of [false, true]) {
    const f = await setupFixture(); await f.press('toggle-setup-install'); await f.press('setup');
    assert.match(JSON.stringify(await f.pane()), /install its dependencies/);
    await f.press('confirm-action');
    assert.equal(f.calls.find(c => c.request?.request.action === 'setup').request.request.install, true);
    if (cancelled) await f.press('cancel-setup');
    else {
      f.finishSetup({schemaVersion:1,action:'setup',status:'failure',summary:'Dependency installation failed.',effects:{state:'partial-or-uncertain',message:'The cloned folder remains.'}});
      await flush();
    }
    const tree = await f.pane();
    assert.match(JSON.stringify(tree), cancelled ? /Setup cancelled/ : /The cloned folder remains/);
    assert.equal(!!f.find(tree, 'setup').props.disabled, false);
    assert.equal(f.calls.filter(c => c.request?.request.action === 'setup').length, 1);
  }
});

test('MCP rows show repository names and route by exact release without environment suffixes', async () => {
  const { register } = await load();
  const connections = ['BackofficeBackend', 'alpaca-connectors'].map((name, i) => ({
    resource_release_uid: `release-${i}`, name: 'app', display_name: name,
    backend: 'https://backend.example', mcp_connection: { organization_environment_uid: 'env', organization_environment_name: 'Production' },
  }));
  const f = fixture({ respond: domain => {
    const q = domain.request;
    return success(q.action, q.action === 'mcp-environments' ? [{ uid: 'env', name: 'Production' }]
      : ['mcp-discover', 'mcp-list'].includes(q.action) ? connections
      : q.action === 'mcp-tools' ? { tools: [{ name: 'lookup', inputSchema: { type: 'object' } }] } : {});
  } });
  register(f.on); await f.emit('session.start'); await f.press('tab-Tools');
  f.find(await f.pane(), 'mcp-environment').props.onSelect('env'); await flush();
  let tree = await f.pane();
  assert.deepEqual(connections.map(c => f.find(tree, `mcp-open-${c.resource_release_uid}`).props.label), ['BackofficeBackend', 'alpaca-connectors']);
  await f.press('tools-add'); tree = await f.pane();
  for (const c of connections) assert.match(JSON.stringify(f.find(tree, `mcp-discovered-${c.resource_release_uid}`)), new RegExp(c.display_name));
  assert.doesNotMatch(JSON.stringify(tree), /Production ·|· Production|"app"/);
  await f.press('tools-back'); await f.press('mcp-open-release-0');
  assert.equal(f.calls.filter(call => call.request?.request.action === 'mcp-tools').at(-1).request.request.releaseUid, 'release-0');
});

test('slow MCP tool reads cannot block discovery or replace another selected MCP catalog', async () => {
  const { register } = await load();
  const f = fixture({respond: d => {
    const q = d.request;
    const connections = ['a','b'].map(uid => ({backend:'https://api.main-sequence.app',resource_release_uid:uid,name:`MCP ${uid}`,mcp_connection:{organization_environment_uid:'env'}}));
    return success(q.action, q.action === 'mcp-environments' ? [{uid:'env',name:'Research'}]
      : ['mcp-list','mcp-discover'].includes(q.action) ? connections
        : q.action === 'mcp-tools' ? {tools:[{name:`lookup_${q.releaseUid}`,inputSchema:{type:'object'}}]} : {});
  }});
  register(f.on); await f.emit('session.start'); await f.press('tab-Tools');
  // Oldest pending mcp-tools request is released first.
  const original = f.$.process.spawn, gates = [];
  f.$.process.spawn = input => {
    const envelope = JSON.parse(input.input);
    if (envelope.request.request.action !== 'mcp-tools') return original(input);
    let release; const gate = new Promise(resolve => { release = resolve; }); gates.push(release);
    const child = original(input);
    const stream = (async function*(){ await gate; for await (const chunk of child) yield chunk; })(); stream.result = child.result; return stream;
  };
  const finish = () => { assert.ok(gates.length, 'request started'); gates.shift()(); };
  f.find(await f.pane(), 'mcp-environment').props.onSelect('env'); await flush();
  await f.press('tools-add');
  assert.ok(f.find(await f.pane(), 'mcp-discovered-a'), 'directory loads while tool registration waits');
  finish(); await flush(); finish(); await flush();
  await f.press('tools-back'); await f.press('mcp-open-a');
  await f.press('tools-back'); await f.press('mcp-open-b');
  finish(); await flush();
  let tree = await f.pane(); assert.equal(f.find(tree, 'tool-lookup_a'), undefined, 'late A tools are not displayed for B');
  finish(); await flush();
  tree = await f.pane(); assert.ok(f.find(tree, 'tool-lookup_b'));
});

test('large MCP catalogs list every tool and page the direct-call selector within the native limit', async () => {
  const { register } = await load();
  const f = fixture({respond: d => {
    const q = d.request;
    return success(q.action, q.action === 'mcp-environments' ? [{uid:'env',name:'Production'}]
      : ['mcp-list','mcp-discover'].includes(q.action) ? [{resource_release_uid:'release',name:'CRM',backend:'https://api.main-sequence.app',mcp_connection:{organization_environment_uid:'env'}}]
      : q.action === 'mcp-tools' ? {tools:Array.from({length:130}, (_, i) => ({name:`crm_tool_${i}`,description:`Tool ${i}`,inputSchema:{type:'object'}}))} : {});
  }});
  register(f.on); await f.emit('session.start'); await f.press('tab-Tools');
  f.find(await f.pane(), 'mcp-environment').props.onSelect('env'); await flush();
  assert.equal(f.tools.length, 80, 'registration keeps its existing cap');
  await f.press('mcp-open-release'); await f.press('toggle-tools-advanced');
  let tree = await f.pane(); assert.ok(f.find(tree, 'tool-crm_tool_129'), 'every tool is listed as a row');
  assert.ok(f.find(tree, 'mcp-tool').props.options.length <= 64); assert.match(JSON.stringify(tree), /1–63 of 130/);
  await f.press('mcp-tool-next'); await f.press('mcp-tool-next');
  f.find(await f.pane(), 'mcp-tool').props.onSelect('crm_tool_129'); await flush();
  await f.press('mcp-tool-previous');
  tree = await f.pane(); assert.equal(f.find(tree, 'mcp-tool').props.value, 'crm_tool_129'); assert.equal(f.find(tree, 'field-mcpTool').props.value, 'crm_tool_129');
});

test('paged native selectors retain every catalog entry, selection and valid bounds', async () => {
  const { selectPage } = await import(pathToFileURL(path.resolve(__dirname, '../manifests/claude/hooks/model.mjs')).href);
  for (const count of [0, 1, 63, 64, 65, 70, 130]) {
    const options = Array.from({length:count}, (_, i) => ({value:`item-${i}`,label:`Item ${i}`}));
    const seen = [];
    for (let page = 0; page < Math.ceil(count/63); page++) {
      const result = selectPage(options, 'item-0', page);
      assert.ok(result.entries.length <= 63);
      assert.equal(result.selected.value, 'item-0');
      seen.push(...result.entries);
    }
    assert.deepEqual(seen, options);
    assert.equal(selectPage(options, '', 100).page, Math.max(0, Math.ceil(count/63)-1));
  }
  assert.equal(selectPage([{value:'a'},{value:'a'},{value:null}], '', 0).total, 1);
});

test('pressing Agents during startup keeps the signed-in account, the saved environment and agent icons', async () => {
  const { register } = await load(); const backend = 'https://api.main-sequence.app';
  const f = fixture({ environments: { [backend]: agentEnvironment }, respond: r => {
    const q = r.request;
    if (q.action === 'workspace-preferences') return success(q.action, { backend, baseDir: '/repos' });
    if (q.action === 'auth-status') return success(q.action, { authenticated: true, username: 'agent-user@example.test' });
    if (q.action === 'mcp-environments') return success(q.action, [{ uid: agentEnvironment, name: 'Research' }]);
    if (q.action === 'mcp-list' || q.action === 'mcp-discover') return success(q.action, []);
    if (q.action === 'agents-list') return success(q.action, { account: 'agent-user@example.test', results: [{ uid: agentUid, name: 'Research assistant', environmentUid: agentEnvironment, environmentName: 'Research', runtimeState: 'current', runtimeReleaseUid: agentId(5), responseKinds: ['message'], skills: [] }], count: 1 });
    return iconResponse({ ...q, agentUids: q.agentUids || [] }) || success(q.action, {});
  } });
  register(f.on); await f.emit('session.start', { surface: 'desktop' });
  const finishAuth = delayRequest(f, 'auth-status');
  f.timers.find(t => t.ms === 0).callback();
  // Preferences resolve, the sign-in check is still in flight, and the person opens Agents.
  await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  await f.press('tab-Agents');
  finishAuth(); await flush(); await flush();
  const tree = await f.pane();
  assert.match(JSON.stringify(tree), /agent-user@example.test/, 'signed-in account survives the environment change');
  assert.equal(f.find(tree, 'login'), undefined);
  assert.equal(f.find(tree, 'mcp-environment').props.value, agentEnvironment);
  assert.ok(f.find(tree, `agent-${agentUid}`)); assert.ok(f.find(tree, `agent-icon-${agentUid}-20`), 'icon drawn in the list');
  assert.equal(f.calls.filter(c => c.request?.request.action === 'agents-list').length, 1, 'agents load once');
  assert.equal(f.calls.filter(c => c.request?.request.action === 'mcp-environments').length, 1, 'environments load once');
  assert.equal(f.calls.filter(c => c.request?.request.action === 'agent-icons').length, 1, 'icons load once');
});

test('registered tool results reach Claude as content blocks, forwarding the MCP blocks and never a bare object', async () => {
  const { register, toolResult } = await load();
  const blocks = toolResult({ schemaVersion: 1, action: 'mcp-call', status: 'success', summary: 'The MCP tool completed.',
    data: { content: [{ type: 'text', text: 'Found 2 contacts' }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }], isError: false, structuredContent: { count: 2 } } });
  assert.ok(Array.isArray(blocks.result)); assert.deepEqual(blocks.result[0], { type: 'text', text: 'Found 2 contacts' });
  assert.deepEqual(blocks.result[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }, 'MCP images become Messages API images');
  const other = toolResult({ schemaVersion: 1, action: 'mcp-call', status: 'success', summary: 'ok', data: { content: [
    { type: 'resource_link', uri: 'file:///report.pdf', name: 'report' }, { type: 'audio', data: 'BBBB', mimeType: 'audio/wav' },
    { type: 'resource', resource: { uri: 'mem://x', blob: 'CCCC', mimeType: 'application/pdf' } }, { type: 'image', data: 'DDDD', mimeType: 'image/svg+xml' }] } });
  assert.deepEqual(other.result.map(b => b.type), ['text', 'text', 'text', 'text'], 'non-API blocks become text');
  assert.match(other.result[0].text, /report\.pdf/); assert.doesNotMatch(JSON.stringify(other.result), /BBBB|CCCC|DDDD/, 'binary payloads are not inlined as text');
  assert.match(blocks.result[2].text, /"count":2/); assert.equal(blocks.isError, undefined);
  const failed = toolResult({ schemaVersion: 1, action: 'mcp-call', status: 'failure', summary: 'The MCP tool reported an error.', error: { code: 'API_ERROR', message: 'boom' },
    data: { content: [{ type: 'text', text: 'missing uid' }], isError: true } });
  assert.equal(failed.isError, true); assert.equal(failed.result[0].text, 'missing uid'); assert.match(failed.result[1].text, /API_ERROR/);
  const plain = toolResult({ schemaVersion: 1, action: 'agent-send', status: 'success', summary: 'Sent.', data: { message: 'Reply', accessToken: 'secret-token' } });
  assert.deepEqual(plain.result.map(b => b.type), ['text']); assert.match(plain.result[0].text, /Reply/); assert.doesNotMatch(plain.result[0].text, /secret-token/);
  // Through the hooks: an MCP tool call and an agent send both answer with blocks.
  const f = fixture({ respond: domain => {
    const q = domain.request;
    if (q.action === 'mcp-environments') return success(q.action, [{ uid: 'env-1', name: 'Research' }]);
    if (q.action === 'mcp-list') return success(q.action, [{ resource_release_uid: 'release-1', name: 'Project', backend: 'https://backend.example', mcp_connection: { organization_environment_uid: 'env-1' } }]);
    if (q.action === 'mcp-tools') return success(q.action, { tools: [{ name: 'lookup', inputSchema: { type: 'object' } }] });
    if (q.action === 'mcp-call') return success(q.action, { content: [{ type: 'text', text: 'hello back' }], isError: false });
    return success(q.action, {});
  } });
  register(f.on); await f.emit('session.start'); await f.press('tab-Tools'); f.find(await f.pane(), 'mcp-environment').props.onSelect('env-1'); await flush();
  const answer = await f.emit('tool.call', { tool: 'mcp__mainsequence__' + f.tools[0].name, tool_use_id: 'call-1', query: 'hi' });
  assert.deepEqual(answer, { result: [{ type: 'text', text: 'hello back' }] });
  const agents = await agentFixture(); await agents.startTalk();
  const sent = await agents.emit('tool.call', { tool: agents.tool('send'), message: 'Hi', responseKind: 'message' });
  assert.ok(Array.isArray(sent.result)); assert.equal(sent.result[0].type, 'text'); assert.match(sent.result[0].text, /Reply from Research assistant/); assert.match(sent.result[0].text, /"agentName":"Research assistant"/);
});

test('an uncertain delivery can be released by the person for the next send without replaying anything', async () => {
  const f = await agentFixture({ respond: r => r.action === 'agent-send' ? { schemaVersion: 1, action: r.action, status: 'failure', summary: 'Timed out.', effects: { state: 'partial-or-uncertain', message: 'The message may have reached the agent.' } } : null });
  await f.startTalk(); await f.send('@research-assistant First');
  let tree = await f.pane(); assert.ok(f.find(tree, `agent-resend-${agentUid}`)); assert.match((await f.send('@research-assistant Again')).text, /uncertain/);
  await f.press(`agent-resend-${agentUid}`);
  tree = await f.pane(); assert.equal(f.find(tree, `agent-resend-${agentUid}`), undefined);
  assert.equal(f.stores.get('agent-conversations-session-1')[Object.keys(f.stores.get('agent-conversations-session-1'))[0]].uncertain, false);
  assert.equal(f.calls.filter(c => c.request?.request.action === 'agent-send').length, 1, 'releasing sends nothing');
  assert.doesNotMatch((await f.send('@research-assistant Third')).text, /uncertain/);
  assert.equal(f.calls.filter(c => c.request?.request.action === 'agent-send').length, 2);
});

test('a conversation stays addressed to the agent after each reply until the person ends it', async () => {
  const f = await agentFixture(); await f.startTalk(); assert.equal(f.draft, '/ms @research-assistant ');
  f.draft = ''; // the composer empties when the command is submitted
  assert.match((await f.send('@research-assistant First question')).text, /Reply from Research/);
  assert.equal(f.draft, '/ms @research-assistant ', 'the empty composer is re-addressed after the reply');
  f.draft = 'Typed while waiting';
  await f.send('@research-assistant Second'); assert.equal(f.draft, 'Typed while waiting', 'queued text is never replaced');
  f.draft = '/ms @research-assistant ';
  const band = await f.emit('ui.render', { surface: 'desktop', component: 'AbovePrompt', props: {} });
  assert.ok(f.find(band, 'agent-end')); f.find(band, 'agent-end').props.onPress(); await flush();
  assert.equal(f.draft, '', 'ending clears a bare prefix');
  assert.deepEqual(await f.emit('ui.render', { surface: 'desktop', component: 'AbovePrompt', props: {} }), { type: 'engine', ref: 1 }, 'the band disappears');
  await f.send('@research-assistant Third'); assert.equal(f.draft, '', 'no refill after End');
  assert.equal(f.calls.filter(c => c.request?.request.action === 'agent-send').length, 3, 'End never resends or blocks explicit sends');
  await f.startTalk(); assert.equal(f.draft, '/ms @research-assistant '); f.draft = '';
  await f.send('@research-assistant Fourth'); assert.equal(f.draft, '/ms @research-assistant ', 'Talk resumes the sticky conversation');
  const model = await agentFixture(); await model.startTalk(); model.draft = '';
  await model.emit('command.run', { command: 'ms', args: `agent ${agentUid} From a plugin`, origin: { kind: 'plugin', name: 'other' } });
  assert.equal(model.draft, '', 'only composer submissions keep the prefix');
});

test('an agent without an idle icon never costs the other agents in its batch their icons, before or after Refresh', async () => {
  const uids = [agentId(2), agentId(6), agentId(7), agentId(8), agentId(10)];
  const agents = uids.map((uid, i) => ({ uid, name: `Agent ${i}`, environmentUid: agentEnvironment, environmentName: 'Research', runtimeState: 'current', runtimeReleaseUid: agentId(5), responseKinds: ['message'], skills: [] }));
  const f = fixture({ respond: r => {
    const q = r.request;
    if (q.action === 'auth-status') return success(q.action, { authenticated: true, username: 'agent-user@example.test' });
    if (q.action === 'mcp-environments') return success(q.action, [{ uid: agentEnvironment, name: 'Research' }]);
    if (q.action === 'mcp-list' || q.action === 'mcp-discover') return success(q.action, []);
    if (q.action === 'agents-list') return success(q.action, { account: 'agent-user@example.test', results: agents, count: agents.length });
    // Real backend shape: agent 1 has a projection without an idle asset; agents 3 and 4 have icons.
    if (q.action === 'agent-icons') return success(q.action, { environmentUid: q.environmentUid, account: 'agent-user@example.test', icons: Object.fromEntries(q.agentUids.flatMap(uid =>
      uid === uids[1] ? [[uid, { rendering: 'color', toolPoses: {}, images: { idle: null }, posesLoaded: false }]]
        : [uids[3], uids[4]].includes(uid) ? [[uid, { rendering: 'color', toolPoses: {}, images: { idle: iconImage('idle') }, posesLoaded: false }]] : [])) });
    return success(q.action, {});
  } });
  const { register } = await load(); register(f.on); await f.emit('session.start', { surface: 'desktop' });
  f.timers.find(t => t.ms === 0).callback(); await flush();
  await f.press('tab-Agents'); f.find(await f.pane(), 'mcp-environment').props.onSelect(agentEnvironment); await flush(); await flush();
  let tree = await f.pane();
  for (const uid of [uids[3], uids[4]]) assert.ok(f.find(tree, `agent-icon-${uid}-20`), `icon for ${uid}`);
  for (const uid of [uids[0], uids[1], uids[2]]) assert.equal(f.find(tree, `agent-icon-${uid}-20`), undefined);
  const lists = f.calls.filter(c => c.request?.request.action === 'agents-list').length;
  await f.press('agents-refresh'); await flush(); await flush();
  assert.equal(f.calls.filter(c => c.request?.request.action === 'agents-list').length, lists + 1, 'Refresh reloads the list');
  tree = await f.pane();
  for (const uid of [uids[3], uids[4]]) assert.ok(f.find(tree, `agent-icon-${uid}-20`), `icon for ${uid} after Refresh`);
});

function reloadFixture(options = {}) {
  const backend = 'https://api.main-sequence.app';
  return fixture({ ...options, environments: { [backend]: 'env-1' }, respond: d => {
    const q = d.request;
    if (q.action === 'workspace-preferences') return success(q.action, { backend, baseDir: '/repos' });
    if (q.action === 'auth-status') return success(q.action, { authenticated: true, username: 'reload@example.test' });
    if (q.action === 'mcp-environments') return success(q.action, [{ uid: 'env-1', name: 'Production' }]);
    if (q.action === 'mcp-list') return success(q.action, [{ resource_release_uid: 'release-1', name: 'BackofficeBackend', backend, mcp_connection: { organization_environment_uid: 'env-1' } }]);
    if (q.action === 'mcp-tools') return success(q.action, { tools: [{ name: 'get_current_user', inputSchema: { type: 'object' } }] });
    if (q.action === 'mcp-call') return success(q.action, { content: [{ type: 'text', text: '{"user_uid":"u-1"}' }], isError: false });
    return success(q.action, {});
  } });
}

test('an SDK-hosted start or reload with no surface still initializes from the desktop surfaces or the first footer render', async () => {
  const { register } = await load();
  // session.start names no surface, but the session already draws on the desktop.
  const a = reloadFixture({ surfaces: ['desktop'] }); register(a.on); await a.emit('session.start', { surface: null });
  for (const t of a.timers.filter(t => t.ms === 0)) t.callback(); await flush(); await flush();
  assert.ok(a.calls.some(c => c.request?.request.action === 'auth-status'), 'session checked'); assert.equal(a.tools.length, 1, 'MCP tools re-registered');
  assert.match(JSON.stringify(await a.pane()), /reload@example.test/); assert.equal(a.calls.some(c => c.pane), false, 'the pane is not opened');
  // Neither session.start nor surfaces() reveal the desktop: the footer render does.
  const b = reloadFixture({ surfaces: [] }); register(b.on); await b.emit('session.start', { surface: null });
  assert.equal(b.calls.some(c => c.request), false, 'nothing runs before a desktop draw');
  await b.emit('ui.render', { surface: 'desktop', component: 'SessionMode', props: { modes: [] } }); await flush(); await flush();
  assert.ok(b.calls.some(c => c.request?.request.action === 'auth-status')); assert.equal(b.tools.length, 1, 'footer render registers MCP tools');
  await b.emit('ui.render', { surface: 'desktop', component: 'SessionMode', props: { modes: [] } }); await flush();
  assert.equal(b.calls.filter(c => c.request?.request.action === 'workspace-preferences').length, 1, 'startup runs once');
  // A terminal or headless start never spawns workers.
  const c = reloadFixture({ surfaces: [] }); register(c.on); await c.emit('session.start', { surface: null });
  await c.emit('ui.render', { surface: 'terminal', component: 'SessionMode', props: { modes: [] } }); await flush();
  assert.equal(c.calls.some(x => x.request), false);
});

test('a model call to a MainSequence tool right after a reload waits for registration instead of refusing', async () => {
  const { register } = await load();
  const first = reloadFixture({ surfaces: ['desktop'] }); register(first.on); await first.emit('session.start', { surface: null });
  for (const t of first.timers.filter(t => t.ms === 0)) t.callback(); await flush(); await flush();
  const name = 'mcp__mainsequence__' + first.tools[0].name;
  // The reloaded instance: the engine's catalog still names the tool; nothing has run yet.
  const f = reloadFixture({ surfaces: [] }); register(f.on); await f.emit('session.start', { surface: null });
  assert.equal(f.tools.length, 0);
  const answer = await f.emit('tool.call', { tool: name, tool_use_id: 'after-reload' });
  assert.deepEqual(answer, { result: [{ type: 'text', text: '{"user_uid":"u-1"}' }] });
  assert.equal(f.calls.filter(c => c.request?.request.action === 'mcp-call').length, 1);
  assert.match((await f.emit('tool.call', { tool: 'mcp__mainsequence__ms_unknown_0' })).deny, /no longer connected/, 'an unknown name is still refused');
});

// Deployments: the Code card, the run detail with its logs, hidden runs, polling and the model tool.
const deployId = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const deployRepo = deployId(30), deployBranch = deployId(31), deployRun = deployId(40), ownedRun = deployId(41), hiddenRun = deployId(42);
function workflowFixtureEntry(state = 'succeeded') {
  const failed = state === 'failed', running = state === 'running';
  const step = (key, operation, resourceKey, stepState, startedAt, finishedAt, extra = {}) => ({ id: key, key, operation, resourceKey, state: stepState, reason: '', needs: [], deploymentRunUid: null,
    startedAt, finishedAt, durationMs: startedAt && finishedAt ? Date.parse(finishedAt) - Date.parse(startedAt) : null, error: '', ...extra });
  return { kind: 'workflow_run', uid: deployRun, state, reason: '', workflowPath: '.mainsequence/workflows/crm-api.yaml', repositoryUid: deployRepo, repositoryName: 'Real project',
    branchUid: deployBranch, branchName: 'main', commit: 'abc1234', createdAt: '2026-10-21T08:00:00.000Z', startedAt: '2026-10-21T08:00:00.000Z',
    finishedAt: running ? null : '2026-10-21T08:06:00.000Z', durationMs: running ? 120000 : 360000, error: failed ? 'Migration failed.' : '',
    steps: [step('image', 'prepare_image', 'crm', 'succeeded', '2026-10-21T08:00:10.000Z', '2026-10-21T08:02:30.000Z', { deploymentRunUid: ownedRun }),
      step('migrate', 'run_job', 'migrate-crm', failed ? 'failed' : running ? 'running' : 'succeeded', '2026-10-21T08:02:31.000Z', running || failed ? (failed ? '2026-10-21T08:03:00.000Z' : null) : '2026-10-21T08:04:00.000Z', { needs: ['image'], error: failed ? 'exit status 1' : '' }),
      step('deploy_api', 'deploy', 'crm', failed ? 'blocked' : running ? 'pending' : 'succeeded', failed || running ? null : '2026-10-21T08:04:01.000Z', failed || running ? null : '2026-10-21T08:06:00.000Z', { needs: ['migrate'], deploymentRunUid: ownedRun, reason: failed ? 'prerequisite_not_successful' : '' })],
    deploymentRuns: [{ uid: ownedRun, targetLabel: 'FastAPI', targetType: 'resource_release', state: failed ? 'failed' : running ? 'queued' : 'succeeded', workflowStepKeys: ['image', 'deploy_api'], createdAt: '2026-10-21T08:00:05.000Z', startedAt: '2026-10-21T08:00:10.000Z', finishedAt: running ? null : '2026-10-21T08:06:00.000Z' }] };
}
function deployFixture(options = {}) {
  const backend = 'https://api.main-sequence.app';
  const state = { latest: workflowFixtureEntry(options.state || 'succeeded'), hidden: false, logs: {} };
  const f = fixture({ ...options, environments: options.noEnvironment ? undefined : { [backend]: 'env-1' }, respond: d => {
    const q = d.request, override = options.respond?.(q, state);
    if (override) return override;
    if (q.action === 'workspace-preferences') return success(q.action, { backend, baseDir: '/repos' });
    if (q.action === 'auth-status') return success(q.action, { authenticated: true, username: 'deploy@example.test' });
    if (q.action === 'mcp-environments') return success(q.action, [{ uid: 'env-1', name: 'Research' }]);
    if (q.action === 'mcp-list' || q.action === 'mcp-discover') return success(q.action, []);
    if (q.action === 'repositories') return success(q.action, [{ uid: deployRepo, code_repository_name: 'Real project', branches: [{ uid: deployBranch, repository_branch: 'main' }, { uid: deployId(32), repository_branch: 'develop' }] }]);
    if (q.action === 'workspace-profile') return success(q.action, { organization: 'acme' });
    if (q.action === 'local-repositories') return success(q.action, [{ name: 'Real project', path: '/work/repo', repositoryUid: deployRepo, isGitRepository: true }]);
    if (q.action === 'status') return success(q.action, { project: { root: '/work/repo', branch: 'main', commit: 'abc1234def', projectType: 'python' }, capabilities: [] });
    if (q.action === 'deployment-history') return success(q.action, { environmentUid: q.environmentUid, branchUid: q.codeRepositoryBranchUid || null, count: 1, limit: q.limit, offset: q.offset, now: '2026-10-21T08:02:00.000Z', results: q.codeRepositoryBranchUid && q.codeRepositoryBranchUid !== deployBranch ? [] : [state.latest] });
    // Like the platform: a workflow run's uid answers 404 on the deployment-run endpoint.
    if (q.action === 'deployment-run') return state.hidden || q.runUid === hiddenRun || (q.kind === 'deployment_run' && q.runUid === deployRun) ? { ...success(q.action, { hidden: true, uid: q.runUid, kind: q.kind, now: '2026-10-21T08:02:00.000Z' }), summary: "You can't see this deployment. A deployment is shown to the people who can see its release or Job." }
      : success(q.action, { hidden: false, uid: q.runUid, kind: q.kind, run: state.latest, now: '2026-10-21T08:02:00.000Z' });
    if (q.action === 'deployment-logs') {
      const page = q.cursor === 'cursor-2' ? { entries: [{ sequence: 2, timestamp: '2026-10-21T08:00:12.500Z', stepUid: null, source: 'orchestrator', stream: 'stdout', level: 'info', text: 'Second page line' }], nextCursor: null, complete: true }
        : { entries: [{ sequence: 0, timestamp: '2026-10-21T08:00:11.000Z', stepUid: null, source: 'orchestrator', stream: 'stdout', level: 'info', text: 'Resolving revision' }, { sequence: 1, timestamp: null, stepUid: null, source: 'build', stream: 'stdout', level: 'info', text: 'Building image' }], nextCursor: 'cursor-2', complete: false };
      return success(q.action, { hidden: false, runUid: q.runUid, stepUid: q.stepUid || null, cursor: q.cursor || null, now: '2026-10-21T08:02:00.000Z', ...page });
    }
    return success(q.action, {});
  } });
  f.deploy = state;
  f.start = async () => { await f.emit('session.start', { surface: 'desktop' }); for (const timer of f.timers.filter(t => t.ms === 0)) timer.callback(); await flush(); await flush(); };
  f.openCodeDetail = async () => { await f.press('tab-Code'); await flush(); await f.press('code-open-session'); await flush(); };
  return f;
}
const deployRequests = (f, action) => f.calls.filter(c => c.request?.request.action === action).map(c => c.request.request);

test('the Code detail shows the branch’s latest run with its state colour and progress rail, succeeded and failed', async () => {
  const { register } = await load();
  for (const outcome of ['succeeded', 'failed']) {
    const f = deployFixture({ state: outcome }); register(f.on); await f.start(); await f.openCodeDetail();
    const latest = deployRequests(f, 'deployment-history');
    assert.equal(latest.length, 1, 'one latest-run read for the branch'); assert.equal(latest[0].codeRepositoryBranchUid, deployBranch); assert.equal(latest[0].limit, 1); assert.equal(latest[0].environmentUid, 'env-1');
    const tree = await f.pane(), card = JSON.stringify(tree);
    assert.ok(f.find(tree, `deploy-open-${deployRun}`), 'the latest run opens its detail'); assert.ok(f.find(tree, 'deploy-all'));
    assert.match(card, outcome === 'succeeded' ? /"● Succeeded"/ : /"! Failed"/);
    assert.match(card, /Real project · main · abc1234/); assert.match(card, /Started 2026-10-21/);
    const rail = f.find(tree, `deploy-rail-${deployRun}`); assert.ok(rail, 'progress rail');
    const glyphs = rail.props.children.filter(child => child.type === 'Text' && child.props.key?.startsWith('deploy-rail-')).map(child => child.props.children[0]);
    assert.deepEqual(glyphs, outcome === 'succeeded' ? ['●', '●', '●'] : ['●', '!', '○'], 'glyphs in plan order');
    assert.match(card, outcome === 'succeeded' ? /3\/3 steps/ : /1\/3 steps/);
    assert.equal(f.timers.some(t => t.ms === 10000 || t.ms === 30000), false, 'a finished run is never polled');
    assert.doesNotMatch(JSON.stringify(f.find(tree, 'tab-Activity')), /running/, 'remote runs never count as running operations');
    await f.press('tab-Home'); const home = await f.pane();
    assert.ok(f.find(home, 'home-deploy-view'), 'Home shows the session branch’s latest run'); assert.match(JSON.stringify(f.find(home, 'home-deploy')), outcome === 'succeeded' ? /Succeeded · Workflow run/ : /Failed · Workflow run/);
    assert.equal(deployRequests(f, 'deployment-history').length, 1, 'Home reuses the loaded latest run');
  }
});

test('opening a run selects its first failed step, shows the timeline and step rows, and pages logs by cursor', async () => {
  const { register } = await load(); const f = deployFixture({ state: 'failed' }); register(f.on); await f.start(); await f.openCodeDetail();
  await f.press(`deploy-open-${deployRun}`); await flush();
  const read = deployRequests(f, 'deployment-run'); assert.equal(read.length, 1); assert.equal(read[0].runUid, deployRun); assert.equal(read[0].kind, 'workflow_run');
  let tree = await f.pane(); let text = JSON.stringify(tree);
  const timeline = f.find(tree, 'deploy-timeline')?.props.children[0]; assert.equal(timeline?.type, 'Svg', 'the Svg timeline is drawn');
  assert.match(timeline.props.source, /^<svg /); assert.ok(timeline.props.source.length < 8000); assert.equal(timeline.props.width, 360); assert.equal((timeline.props.source.match(/<rect/g) || []).length, 2, 'two timed bars'); assert.equal((timeline.props.source.match(/<circle/g) || []).length, 1, 'one marker for the step that never ran');
  for (const key of ['image', 'migrate', 'deploy_api']) assert.ok(f.find(tree, `deploy-step-${key}`), `row for ${key}`);
  assert.equal(f.find(tree, 'deploy-step-migrate').props.plain, undefined, 'the failed step is selected'); assert.equal(f.find(tree, 'deploy-step-image').props.plain, true);
  assert.match(text, /Step migrate/); assert.match(text, /exit status 1/); assert.match(text, /Job run logs are shown in Command Center/);
  assert.equal(deployRequests(f, 'deployment-logs').length, 0, 'a job step has no deployment logs to read');
  assert.ok(f.find(tree, `deploy-open-${ownedRun}`), 'owned deployments are listed'); assert.match(text, /prerequisite not successful/);
  await f.press('deploy-step-image'); await flush();
  let logs = deployRequests(f, 'deployment-logs'); assert.equal(logs.length, 1); assert.equal(logs[0].runUid, ownedRun); assert.equal(logs[0].cursor, undefined); assert.equal(logs[0].limit, 200);
  tree = await f.pane(); const block = f.find(tree, 'deploy-logs')?.props.children[0]; assert.equal(block?.type, 'Code', 'logs draw in a Code block'); assert.equal(block.props.language, 'text');
  assert.match(block.props.source, /^\d\d:\d\d:\d\d\.000 Resolving revision\n {12} Building image$/, 'chronological HH:MM:SS.mmm lines; a missing timestamp keeps the column');
  assert.equal(f.find(tree, 'deploy-logs-older').props.disabled, true); assert.equal(f.find(tree, 'deploy-logs-newer').props.disabled, undefined);
  await f.press('deploy-logs-newer'); logs = deployRequests(f, 'deployment-logs'); assert.equal(logs.at(-1).cursor, 'cursor-2');
  const logSource = async () => f.find(await f.pane(), 'deploy-logs').props.children[0].props.source;
  tree = await f.pane(); assert.match(await logSource(), /Second page line/); assert.equal(f.find(tree, 'deploy-logs-newer').props.disabled, true);
  await f.press('deploy-logs-older'); logs = deployRequests(f, 'deployment-logs'); assert.equal(logs.at(-1).cursor, undefined, 'Older returns to the first page');
  assert.match(await logSource(), /Resolving revision/);
  await f.press('deploy-back'); tree = await f.pane(); assert.ok(f.find(tree, `deploy-open-${deployRun}`), 'Back returns to the Code detail'); assert.ok(f.find(tree, 'sync'));
});

test('a run the reader cannot see is described without asserting that it exists', async () => {
  const { register } = await load(); const f = deployFixture(); register(f.on); await f.start(); await f.openCodeDetail();
  await f.press(`deploy-open-${deployRun}`); await flush();
  await f.press(`deploy-open-${ownedRun}`); await flush();
  f.deploy.hidden = true; await f.press('deploy-back'); await flush();
  const text = JSON.stringify(await f.pane());
  assert.match(text, /You can't see this deployment\. A deployment is shown to the people who can see its release or Job\./);
  assert.doesNotMatch(text, /not found|does not exist|no such/i);
  assert.equal(f.find(await f.pane(), 'deploy-timeline'), undefined);
});

test('an active run is refreshed every 10 s while shown, the list every 30 s, and polling stops when it finishes or the section changes', async () => {
  const { register } = await load(); const f = deployFixture({ state: 'running' }); register(f.on);
  const cancelled = [], every = f.$.clock.every;
  f.$.clock.every = (ms, callback) => { const timer = every(ms, callback); timer.cancel = () => { cancelled.push(timer); }; return timer; };
  await f.start(); await f.openCodeDetail();
  const mark = f.calls.length;
  const polls = () => f.timers.filter(t => (t.ms === 10000 || t.ms === 30000) && !cancelled.includes(t));
  assert.deepEqual(polls().map(t => t.ms), [10000], 'the active latest run on the Code card is polled');
  await f.press(`deploy-open-${deployRun}`); await flush();
  assert.deepEqual(polls().map(t => t.ms), [10000], 'the open detail is polled once');
  const before = deployRequests(f, 'deployment-run').length;
  polls()[0].callback(); await flush(); await flush();
  assert.equal(deployRequests(f, 'deployment-run').length, before + 1, 'a tick re-reads the run');
  f.deploy.latest = workflowFixtureEntry('succeeded'); polls()[0].callback(); await flush(); await flush();
  assert.deepEqual(polls(), [], 'polling stops once the run has finished');
  assert.match(JSON.stringify(await f.pane()), /"● Succeeded"/);
  f.deploy.latest = workflowFixtureEntry('running'); await f.press('deploy-back'); await flush(); await f.press('deploy-refresh'); await flush();
  assert.deepEqual(polls().map(t => t.ms), [10000]);
  await f.press('tab-Tools'); assert.deepEqual(polls(), [], 'leaving the section cancels the timer');
  await f.press('tab-Code'); await flush(); assert.deepEqual(polls().map(t => t.ms), [10000], 'returning resumes it');
  await f.emit('ui.close', { id: 'mainsequence', origin: { kind: 'person' } }); assert.deepEqual(polls(), [], 'a closed pane polls nothing');
  await f.pane(); await flush(); assert.deepEqual(polls().map(t => t.ms), [10000], 'a draw of the reopened pane resumes it');
  await f.press('deploy-all'); await flush();
  assert.deepEqual(polls().map(t => t.ms), [30000], 'the list polls every 30 s while an entry is active');
  assert.ok(f.find(await f.pane(), `deploy-row-${deployRun}`));
  f.deploy.latest = workflowFixtureEntry('failed'); polls()[0].callback(); await flush(); await flush();
  assert.deepEqual(polls(), [], 'a settled list stops polling');
  await f.emit('session.end'); assert.deepEqual(polls(), []);
  assert.ok(f.calls.slice(mark).some(c => c.request?.request.action.startsWith('deployment-')), 'deployment reads ran');
  assert.equal(f.calls.slice(mark).some(c => c.status), false, 'the status line and Activity never count remote runs or their reads');
  assert.equal(f.calls.slice(mark).some(c => c.request && !c.request.request.action.startsWith('deployment-')), false, 'only deployment reads ran');
});

test('ms_deployment_status reads the branch’s latest run and the failed step’s log tail, and is denied without an environment', async () => {
  const { register } = await load(); const f = deployFixture({ state: 'failed' }); register(f.on); await f.start();
  const spec = f.registered.find(t => t.name === 'ms_deployment_status'); assert.ok(spec, 'registered with the environment'); assert.match(spec.description, /Research/);
  assert.deepEqual(Object.keys(spec.inputSchema.properties).sort(), ['branch', 'logs', 'repository', 'runUid']);
  assert.equal(f.registered.filter(t => t.name === 'ms_deployment_status').length, 1, 'registered once per environment selection');
  const asks = f.$.ui.ask; f.$.ui.ask = async () => assert.fail('a read-only tool needs no confirmation');
  const answer = await f.emit('tool.call', { tool: 'mcp__mainsequence__ms_deployment_status', tool_use_id: 'deploy-1', repository: 'real project', branch: 'main', logs: true });
  f.$.ui.ask = asks;
  assert.equal(answer.isError, undefined); assert.equal(answer.result[0].type, 'text');
  assert.match(answer.result[0].text, /Environment: Research/); assert.match(answer.result[0].text, /Real project · main · abc1234/); assert.match(answer.result[0].text, /Workflow run .*crm-api\.yaml — Failed/);
  assert.match(answer.result[0].text, /! migrate \(run_job · migrate-crm\) — failed/); assert.match(answer.result[0].text, /○ deploy_api .* — blocked/); assert.match(answer.result[0].text, /needs migrate/);
  assert.match(answer.result[1].text, /^Logs: Job run logs are shown in Command Center/);
  assert.equal(deployRequests(f, 'deployment-history').at(-1).codeRepositoryBranchUid, deployBranch);
  f.deploy.latest = { ...workflowFixtureEntry('failed'), steps: workflowFixtureEntry('failed').steps.map(step => step.key === 'deploy_api' ? { ...step, state: 'failed', error: 'rollout refused' } : { ...step, state: 'succeeded', error: '' }) };
  const withLogs = await f.emit('tool.call', { tool: 'mcp__mainsequence__ms_deployment_status', tool_use_id: 'deploy-2', runUid: deployRun, logs: true });
  assert.match(withLogs.result[1].text, /^Logs of deploy_api \(first failed step\) · last 3 of 3 lines:\n/); assert.match(withLogs.result[1].text, /Resolving revision\n.*Building image\n.*Second page line$/);
  assert.deepEqual(deployRequests(f, 'deployment-logs').slice(-2).map(q => [q.runUid, q.cursor]), [[ownedRun, undefined], [ownedRun, 'cursor-2']], 'the tail follows next_cursor');
  const byRun = deployRequests(f, 'deployment-run'); assert.deepEqual(byRun.slice(-2).map(q => q.kind), ['deployment_run', 'workflow_run'], 'a uid is tried as a deployment, then as a workflow run');
  const hidden = await f.emit('tool.call', { tool: 'mcp__mainsequence__ms_deployment_status', tool_use_id: 'deploy-3', runUid: hiddenRun });
  assert.equal(hidden.result.length, 1); assert.match(hidden.result[0].text, /You can't see this deployment/); assert.doesNotMatch(hidden.result[0].text, /not found|does not exist/i);
  assert.match((await f.emit('tool.call', { tool: 'mcp__mainsequence__ms_deployment_status', tool_use_id: 'deploy-4', repository: 'Unknown' })).result[0].text, /No MainSequence repository named Unknown/);
  assert.match((await f.emit('tool.call', { tool: 'mcp__mainsequence__ms_deployment_status', tool_use_id: 'deploy-5', repository: 'Real project', branch: 'nope' })).result[0].text, /main, develop/);
  const none = deployFixture({ noEnvironment: true }); register(none.on); await none.start();
  assert.equal(none.registered.some(t => t.name === 'ms_deployment_status'), false, 'no registration without an environment');
  assert.match((await none.emit('tool.call', { tool: 'mcp__mainsequence__ms_deployment_status', tool_use_id: 'deploy-6' })).deny, /Choose a MainSequence organization environment/);
  assert.equal(none.calls.some(c => c.request?.request.action.startsWith('deployment-')), false);
});
