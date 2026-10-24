const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { ToolingError } = require('@dev-mainsequence/devtools');
const { claudeFailure } = require('../dist/hosts/claudeProtocol');

test('Claude protocol preserves safe shared reasons and clears them on cancellation', () => {
  const error = new ToolingError('STORE_ERROR', 'The desktop session bus is unavailable.', 'SESSION_UNAVAILABLE');
  assert.equal(claudeFailure('auth-status', error).error.reason, 'SESSION_UNAVAILABLE');
  assert.equal(claudeFailure('auth-status', error, true).error.reason, undefined);
});

test('packaged Claude worker uses the shared Linux diagnostics and machine session', { skip: process.platform !== 'linux', timeout: 30000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ms claude linux '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = [];
  const server = http.createServer((req, res) => {
    calls.push(req.method + ' ' + req.url);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v1/users/me/' && req.headers.authorization === 'Bearer fixture-machine-access') return res.end(JSON.stringify({ username: 'fixture-linux-user' }));
    res.writeHead(403).end('{}');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const backend = `http://127.0.0.1:${server.address().port}`;
  const bin = path.join(root, 'bin'), failureFile = path.join(root, 'helper-failure');
  await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, 'secret-tool'), `#!${process.execPath}
const fs = require('node:fs');
if (fs.existsSync(${JSON.stringify(failureFile)})) { process.stderr.write(fs.readFileSync(${JSON.stringify(failureFile)}, 'utf8')); process.exit(1); }
if (process.env.DBUS_SESSION_BUS_ADDRESS !== 'unix:path=/fixture/bus') { process.stderr.write('secret-tool: Cannot autolaunch D-Bus without X11 $DISPLAY\\nprivate-helper-output'); process.exit(1); }
require('node:assert/strict').equal(process.argv[2], 'lookup', 'No fixture credentials may be written or removed.');
console.log(${JSON.stringify(JSON.stringify({ v: 1, backend, username: 'fixture-linux-user', access: 'fixture-machine-access', refresh: 'fixture-machine-refresh' }))});
`, { mode: 0o755 });
  const base = { HOME: root, PATH: bin + path.delimiter + process.env.PATH, MAINSEQUENCE_ENDPOINT: backend };
  const desktop = { ...base, DBUS_SESSION_BUS_ADDRESS: 'unix:path=/fixture/bus', XDG_RUNTIME_DIR: '/fixture/runtime' };
  const worker = path.resolve('claude/dist/claudeRunner.js');
  async function run(action, env, check = false) {
    const child = spawn(process.execPath, [worker], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
    t.after(() => child.kill());
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
    child.stdin.end(JSON.stringify({ protocolVersion: 1, id: 'linux-session', request: { scope: 'devtools', request: { action, backend, ...(check ? { check: true } : {}) } } }));
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(code, 0, stderr); assert.equal(stderr, '');
    const message = stdout.trim().split('\n').map(line => JSON.parse(line)).find(value => value.type === 'result');
    assert.equal(message.id, 'linux-session');
    assert.doesNotMatch(JSON.stringify(message), /private-helper-output|fixture-machine-access|fixture-machine-refresh/);
    return message.result;
  }
  for (const action of ['auth-status', 'login', 'refresh-token', 'logout']) {
    const result = await run(action, base);
    assert.equal(result.error.code, 'STORE_ERROR'); assert.equal(result.error.reason, 'SESSION_UNAVAILABLE');
    assert.match(result.error.message, /desktop session bus/); assert.doesNotMatch(result.error.message, /Unlock/);
  }
  assert.deepEqual(calls, []);
  const result = await run('auth-status', desktop, true);
  assert.equal(result.status, 'success'); assert.equal(result.data.source, 'machine'); assert.equal(result.data.store, 'Secret Service');
  assert.equal(result.data.checked, true); assert.equal(result.data.username, 'fixture-linux-user');
  const count = calls.length; assert.ok(count > 0);
  for (const [stderr, reason] of [
    ['org.freedesktop.Secret.Error.IsLocked', 'LOCKED'],
    ['org.freedesktop.DBus.Error.ServiceUnknown', 'SERVICE_UNAVAILABLE'],
    ['org.freedesktop.DBus.Error.AccessDenied', 'ACCESS_DENIED'],
    ['unrecognized helper failure', 'HELPER_FAILED'],
  ]) {
    await fs.writeFile(failureFile, stderr + '\nprivate-helper-output');
    for (const action of ['auth-status', 'login', 'refresh-token', 'logout']) {
      const result = await run(action, desktop);
      assert.equal(result.error.code, 'STORE_ERROR'); assert.equal(result.error.reason, reason);
    }
  }
  assert.equal(calls.length, count, 'Store failures must stop before browser launch or backend access.');
});
