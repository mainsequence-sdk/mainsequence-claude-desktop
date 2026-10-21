const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

test('packaged Claude worker discovers, connects and calls MCPs with nameless release details and saved connections', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-mcp-contract-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const releaseUid = 'b0a5ee29-f649-46ab-a040-38504838a131';
  const otherUid = 'b0a5ee29-f649-46ab-a040-38504838a132';
  const environmentUid = 'ba034541-73b4-4c5b-81ad-16516d8a8f94';
  const platformToken = 'fixture-platform-token', releaseToken = 'fixture-release-token';
  const state = { denied: false, noMcp: false, namesDenied: false, namesEnvironment: environmentUid,
    endpoint: undefined, detailUid: releaseUid, exchanged: 0, invoked: 0 };
  const calls = [];
  async function listen(handler) {
    const server = http.createServer(async (req, res) => {
      try { await handler(req, res); } catch { res.writeHead(500).end('{}'); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    return 'http://127.0.0.1:' + server.address().port;
  }
  async function body(req) { let text = ''; for await (const chunk of req) text += chunk; return text ? JSON.parse(text) : undefined; }
  function reply(res, id, result) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id, result })); }
  function initialized(res, message) {
    if (message.method === 'initialize') {
      reply(res, message.id, { protocolVersion: '2025-11-25', capabilities: { tools: {} } }); return true;
    }
    if (message.method === 'notifications/initialized') { res.writeHead(202).end(); return true; }
    return false;
  }
  const project = await listen(async (req, res) => {
    const message = await body(req);
    calls.push({ server: 'project', method: message.method, authorization: req.headers.authorization });
    if (req.headers.authorization !== 'Bearer ' + releaseToken) return res.writeHead(401).end();
    assert.equal(req.url, '/mcp'); assert.equal(req.method, 'POST');
    if (initialized(res, message)) return;
    if (message.method === 'tools/list') return reply(res, message.id, { tools: [{ name: 'lookup', inputSchema: { type: 'object', properties: { value: { type: 'number' } } } }] });
    if (message.method === 'tools/call') {
      state.invoked++;
      assert.equal(message.params.name, 'lookup');
      return reply(res, message.id, { content: [{ type: 'text', text: 'fixture answer' }], structuredContent: { value: message.params.arguments.value } });
    }
    res.writeHead(400).end();
  });
  let backend;
  const metadata = uid => ({ url: state.endpoint || project + '/mcp', transport: 'streamable-http',
    resource_metadata_url: backend + '/.well-known/oauth-protected-resource/mcp?resource_release_uid=' + uid,
    organization_environment_uid: environmentUid, organization_environment_name: 'Research',
    active_revision_uid: '21fe3fba-e8fa-4010-b2bd-4a16d873ec28' });
  backend = await listen(async (req, res) => {
    const message = await body(req);
    calls.push({ server: 'platform', path: req.url, authorization: req.headers.authorization });
    if (req.headers.authorization !== 'Bearer ' + platformToken || state.denied) return res.writeHead(403).end();
    if (req.url === '/mcp') {
      if (initialized(res, message)) return;
      assert.equal(message.params.name, 'resource_release.mcp_endpoints');
      return reply(res, message.id, { content: [], structuredContent: { count: 2, results: [
        { resource_release_uid: releaseUid, name: 'app', mcp_connection: metadata(releaseUid) },
        { resource_release_uid: otherUid, name: 'app', mcp_connection: metadata(otherUid) },
      ] } });
    }
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/api/v1/resource-releases/?')) {
      if (state.namesDenied) return res.writeHead(403).end('{}');
      // Exact matching must find entries after the first collection page and
      // ignore metadata for the same release in another environment.
      const offset = Number(new URL(req.url, backend).searchParams.get('offset'));
      return res.end(JSON.stringify({ count: 102, results: offset === 0
        ? [{ uid: releaseUid, code_repository_branch_uid: 'wrong', mcp_connection: { organization_environment_uid: 'different' } }]
        : [releaseUid, otherUid].map((uid, i) => ({ uid, code_repository_branch_uid: `branch-${i}`, name: i === 0 ? 'crm' : 'app',
          mcp_connection: { organization_environment_uid: state.namesEnvironment } })) }));
    }
    if (req.url.startsWith('/api/v1/code-repository-branches/')) {
      if (state.branchesDenied) return res.writeHead(503).end('{}');
      const uid = req.url.split('/').at(-2);
      assert.ok(['branch-0', 'branch-1'].includes(uid), 'only exact environment matches are resolved');
      return res.end(JSON.stringify({ uid, code_repository_uid: `repo-${uid}`,
        code_repository_name: uid === 'branch-0' ? 'BackofficeBackend' : 'alpaca-connectors',
        repository_branch: 'main', is_initialized: true }));
    }
    if (req.url === '/api/v1/resource-releases/' + releaseUid + '/') return res.end(JSON.stringify({
      uid: state.detailUid, release_kind: 'fastapi', mcp_enabled: !state.noMcp,
      mcp_connection: state.noMcp ? null : metadata(state.detailUid),
    }));
    if (req.url === '/api/v1/resource-releases/' + releaseUid + '/exchange-launch/') {
      state.exchanged++;
      return res.end(JSON.stringify({ mode: 'token', release_kind: 'fastapi', token: releaseToken, rpc_url: project + '/' }));
    }
    res.writeHead(404).end('{}');
  });

  const packageRoot = path.resolve(__dirname, '../claude');
  const store = path.join(dir, 'connections.json'), bootstrap = path.join(dir, 'worker.cjs');
  // Inject only temporary metadata storage through the public factory; execute
  // the real packaged worker and its bundled dependency in every subprocess.
  await fs.writeFile(bootstrap, `
const entry = require.resolve(${JSON.stringify(path.join(packageRoot, 'dist/vendor/devtools'))});
const core = require(entry);
require.cache[entry].exports = { ...core, createDevTools: options => core.createDevTools({ ...options, mcpConnectionsPath: ${JSON.stringify(store)} }) };
require(${JSON.stringify(path.join(packageRoot, 'dist/claudeRunner.js'))}).main();
`);
  async function run(action, extra = {}) {
    const envelope = { protocolVersion: 1, id: 'mcp-contract', request: { scope: 'devtools', request: { action, backend, environmentUid, releaseUid, ...extra } } };
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [bootstrap], { cwd: dir, env: { PATH: process.env.PATH,
        MAINSEQUENCE_ENDPOINT: backend, MAINSEQUENCE_ACCESS_TOKEN: platformToken }, stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 });
      let output = '';
      child.stdout.on('data', bytes => { output += bytes; }); child.stderr.resume();
      child.on('error', reject);
      child.on('close', code => {
        try {
          assert.equal(code, 0, 'packaged worker exited successfully');
          const result = output.trim().split('\n').map(line => JSON.parse(line)).find(message => message.type === 'result' && message.id === envelope.id)?.result;
          assert.ok(result, 'correlated result');
          assert.doesNotMatch(output, /fixture-platform-token|fixture-release-token/);
          resolve(result);
        } catch (error) { reject(error); }
      });
      child.stdin.end(JSON.stringify(envelope));
    });
  }

  const discovered = await run('mcp-discover');
  assert.equal(discovered.status, 'success');
  assert.deepEqual(discovered.data.results.map(row => row.name), ['app', 'app']);
  assert.deepEqual(discovered.data.results.map(row => row.display_name), ['BackofficeBackend', 'alpaca-connectors']);
  const added = await run('mcp-add');
  assert.equal(added.status, 'success', added.summary);
  assert.equal(added.data.tools[0].name, 'lookup');
  assert.equal(Object.hasOwn(added.data.connection, 'name'), false);
  const saved = await fs.readFile(store, 'utf8');
  assert.equal(Object.hasOwn(JSON.parse(saved)[0], 'name'), false);
  const listed = await run('mcp-list');
  assert.equal(listed.data.length, 1);
  assert.equal(listed.data[0].display_name, 'BackofficeBackend', 'old nameless saved connections get the same name');
  assert.equal(listed.data[0].name, 'crm', 'the release name from the projection labels a nameless saved connection');
  assert.deepEqual((await run('mcp-discover')).data.results.map(row => row.name), ['app', 'app'], 'a name the directory gave is kept');
  assert.equal(Object.hasOwn(JSON.parse(saved)[0], 'display_name'), false, 'presentation names do not rewrite connection storage');
  assert.equal(Object.hasOwn(JSON.parse(saved)[0], 'name'), false, 'release names do not rewrite connection storage either');
  state.branchesDenied = true;
  const unresolved = await run('mcp-list');
  assert.equal(unresolved.data[0].display_name, undefined);
  assert.equal(unresolved.data[0].name, 'crm', 'the release name remains when its repository cannot be read');
  state.branchesDenied = false;
  state.namesDenied = true;
  const unavailableNames = await run('mcp-list');
  assert.equal(unavailableNames.status, 'success');
  assert.equal(unavailableNames.data[0].display_name, undefined, 'optional name lookup cannot break a saved connection');
  state.namesDenied = false; state.namesEnvironment = 'different';
  assert.equal((await run('mcp-list')).data[0].display_name, undefined, 'names from another environment cannot leak');
  state.namesEnvironment = environmentUid;
  assert.equal((await run('mcp-tools')).data.tools[0].name, 'lookup');
  const called = await run('mcp-call', { tool: 'lookup', arguments: { value: 42 } });
  assert.equal(called.status, 'success'); assert.equal(called.data.structuredContent.value, 42);

  const exchanged = state.exchanged, executed = calls.filter(call => call.server === 'project').length;
  state.denied = true;
  assert.equal((await run('mcp-tools')).error.code, 'AUTH_REJECTED');
  state.denied = false; state.endpoint = 'https://changed.example/mcp';
  assert.equal((await run('mcp-tools')).error.code, 'INVALID_REQUEST');
  state.endpoint = undefined; state.detailUid = otherUid;
  assert.equal((await run('mcp-tools')).error.code, 'API_ERROR');
  state.detailUid = releaseUid; state.noMcp = true;
  assert.equal((await run('mcp-tools')).error.code, 'API_ERROR');
  assert.equal(state.exchanged, exchanged); assert.equal(state.invoked, 1);
  assert.equal(calls.filter(call => call.server === 'project').length, executed);
  assert.equal(await fs.readFile(store, 'utf8'), saved, 'failures preserve saved metadata');
  assert.ok(calls.filter(call => call.server === 'project').every(call => call.authorization === 'Bearer ' + releaseToken));
  assert.ok(calls.filter(call => call.server === 'platform').every(call => call.authorization === 'Bearer ' + platformToken));
});
