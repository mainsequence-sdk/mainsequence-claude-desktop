const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createClaudeAccountsService, claudeCredentialReference, parseClaudeCredential, pickClaudeAccount } = require('../dist/hosts/claudeAccounts.js');

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-claude-accounts-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const directory = path.join(home, 'metadata');
  const clock = { now: Date.UTC(2026, 9, 14, 12) };
  const credentials = new Map(), identities = new Map(), usage = new Map(), calls = [];
  let loginBehavior, logoutExit = 0;
  const host = { async openBrowser() { throw new Error('fixture must not open browser'); }, async runProcess(spec) {
    calls.push(spec);
    if (spec.args[1] === 'status') return { exitCode: 0, stderr: '', stdout: JSON.stringify({ loggedIn: true, ...identities.get(spec.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude')) }) };
    if (spec.args[1] === 'login') return loginBehavior ? loginBehavior(spec) : { exitCode: 0, stderr: '', stdout: 'fixture-secret-output' };
    if (spec.args[1] === 'logout') return { exitCode: logoutExit, stdout: '', stderr: 'fixture-secret-output' };
    throw new Error('unexpected native command');
  } };
  const options = { home, directory, platform: 'linux', env: { HOME: home, USER: 'fixture', CLAUDE_CODE_OAUTH_TOKEN: 'host-secret', ANTHROPIC_API_KEY: 'api-secret' },
    host, now: () => clock.now, readCredential: async ref => credentials.get(ref.path) ?? null,
    fetch: async (_url, request) => new Response(JSON.stringify(usage.get(request.headers.Authorization) ?? { five_hour: { utilization: 10 }, seven_day: { utilization: 10 } }), { status: 200 }) };
  const service = createClaudeAccountsService(options);
  const slot = id => id === 'default' ? path.join(home, '.claude') : path.join(directory, 'profiles', id);
  const put = (id, settings = {}) => {
    const token = `private-token-${id}`;
    credentials.set(path.join(slot(id), '.credentials.json'), { accessToken: token, expiresAt: clock.now + 3_600_000, ...settings });
    identities.set(slot(id), { email: `${id}@example.test`, orgId: 'organization-one', orgName: 'Fixture organization', subscriptionType: 'max' });
    return token;
  };
  const request = (action, rest = {}) => service.dispatch({ action, sessionId: 'session-one', ...rest });
  const add = async label => {
    const result = await request('add', { label }); assert.equal(result.status, 'success');
    return result.data.accounts.at(-1).id;
  };
  return { home, directory, clock, options, service, calls, request, add, put, slot, credentials, identities, usage,
    login(fn) { loginBehavior = fn; }, logout(code) { logoutExit = code; } };
}

test('native references follow Claude naming and credential parser drops unrelated secrets', () => {
  const slot = '/Users/tester/.claude/accounts/2';
  const digest = crypto.createHash('sha256').update(slot).digest('hex').slice(0, 8);
  assert.deepEqual(claudeCredentialReference(slot, '/Users/tester', 'tester', 'darwin'), { kind: 'keychain', service: `Claude Code-credentials-${digest}`, user: 'tester' });
  assert.equal(claudeCredentialReference('', '/Users/tester', 'bad user', 'darwin').user, 'claude-code-user');
  assert.equal(claudeCredentialReference('', '/fixture', 'x', 'linux').path, '/fixture/.claude/.credentials.json');
  assert.deepEqual(parseClaudeCredential(JSON.stringify({ claudeAiOauth: { accessToken: 'private', expiresAt: 99, refreshToken: 'never-export' }, mcp: { token: 'other' } })), { accessToken: 'private', expiresAt: 99 });
  assert.equal(parseClaudeCredential('{'), null);
});

test('simultaneous independent services allocate unique slots and preserve all metadata updates', async t => {
  const f = await fixture(t);
  const results = await Promise.all(Array.from({ length: 16 }, (_, i) => createClaudeAccountsService(f.options).dispatch({ action: 'add', sessionId: `session-${i}`, label: `Account ${i}` })));
  for (const result of results) assert.equal(result.status, 'success', result.summary);
  const listed = await f.request('list');
  assert.equal(listed.data.accounts.length, 17);
  assert.equal(new Set(listed.data.accounts.map(a => a.id)).size, 17);
  assert.equal((await fs.stat(path.join(f.directory, 'accounts.json'))).mode & 0o777, 0o600);
  assert.equal((await fs.stat(f.directory)).mode & 0o777, 0o700);
});

test('metadata locking works across separate worker processes', async t => {
  const f = await fixture(t);
  const entry = path.resolve(__dirname, '../dist/hosts/claudeAccounts.js');
  await Promise.all(Array.from({ length: 5 }, (_, i) => new Promise((resolve, reject) => {
    const code = `const {createClaudeAccountsService}=require(process.argv[1]);createClaudeAccountsService({home:process.argv[2],directory:process.argv[3],platform:'linux',env:{HOME:process.argv[2]}}).dispatch({action:'add',sessionId:process.argv[4]}).then(r=>{if(r.status!=='success')process.exitCode=1;process.stdout.write(JSON.stringify(r));});`;
    const child = spawn(process.execPath, ['-e', code, entry, f.home, f.directory, `worker-${i}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', b => out += b); child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(out)));
  })));
  assert.equal((await f.request('list')).data.accounts.length, 6);
});

test('switch prepares only a private credential reference and stale confirmations are rejected', async t => {
  const f = await fixture(t), id = await f.add('Second account'); f.put('default'); const token = f.put(id);
  const first = await f.request('select', { accountId: id });
  assert.equal(first.status, 'success');
  assert.equal(first.data.session.activeId, 'default');
  assert.equal(first.data.session.state, 'pending');
  assert.equal(first.data.projection.verification, 'pending');
  assert.equal(first.data.projection.credential.kind, 'file');
  assert.doesNotMatch(JSON.stringify(first), /private-token|host-secret|api-secret/);
  const second = await f.request('select', { accountId: id });
  assert.equal(second.error.code, 'PROJECT_BUSY');
  assert.equal((await f.request('confirm', { generation: 'stale-generation' })).status, 'failure');
  const confirmed = await f.request('confirm', { generation: first.data.projection.generation });
  assert.equal(confirmed.data.session.state, 'projected-unverified');
  assert.equal(confirmed.data.session.activeId, id);
  assert.equal((await fs.readFile(path.join(f.directory, 'accounts.json'), 'utf8')).includes(token), false);
});

test('live session leases prevent logout beneath another session and are released explicitly', async t => {
  const f = await fixture(t), id = await f.add(); f.put(id);
  const selected = await f.request('select', { accountId: id });
  await f.request('confirm', { generation: selected.data.projection.generation });
  const remove = await f.request('remove', { accountId: id, sessionId: 'another-session' });
  assert.equal(remove.error.code, 'PROJECT_BUSY');
  assert.equal(f.calls.some(c => c.args[1] === 'logout'), false);
  await f.request('release');
  const removed = await f.request('remove', { accountId: id, sessionId: 'another-session' });
  assert.equal(removed.status, 'success');
  assert.equal(removed.data.accounts.some(a => a.id === id), false);
});

test('logout failure preserves account metadata and a cancelled native child does not leak stderr', async t => {
  const f = await fixture(t), id = await f.add(); f.logout(7);
  const result = await f.request('remove', { accountId: id });
  assert.equal(result.status, 'failure'); assert.doesNotMatch(JSON.stringify(result), /fixture-secret/);
  assert.equal((await f.request('list')).data.accounts.some(a => a.id === id), true);
});

test('expired credentials cannot be projected and native status environment excludes host/API tokens', async t => {
  const f = await fixture(t), id = await f.add(); f.put(id, { expiresAt: f.clock.now - 1 });
  const selected = await f.request('select', { accountId: id });
  assert.equal(selected.error.code, 'NOT_AUTHENTICATED');
  f.put(id); await f.request('refresh');
  for (const call of f.calls) {
    assert.equal(call.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
    assert.equal(call.env.ANTHROPIC_API_KEY, undefined);
  }
});

test('automatic selection rejects stale unknown exhausted and cross-organization accounts', () => {
  const now = 1_000_000_000;
  const config = { mode: 'automatic', fiveHourThreshold: 90, weeklyThreshold: 95, sameOrganizationOnly: true };
  const profile = (id, percentUsed, extra = {}) => ({ id, health: 'ready', expiresAt: now + 3_600_000, organizationId: 'one', usage: { fiveHour: { percentUsed }, week: { percentUsed: 10 }, checkedAt: now }, ...extra });
  const base = profile('base', 95), ready = profile('ready', 30);
  const accounts = [base, profile('stale', 0, { usage: { fiveHour: { percentUsed: 0 }, checkedAt: now - 21 * 60_000 } }), profile('unknown', 0, { usage: undefined }), profile('cross-org', 0, { organizationId: 'two' }), profile('weekly-spent', 0, { usage: { fiveHour: { percentUsed: 0 }, week: { percentUsed: 96 }, checkedAt: now } }), ready];
  assert.equal(pickClaudeAccount(accounts, 'base', config, now).id, 'ready');
  assert.equal(pickClaudeAccount(accounts, 'base', { ...config, eligibleAccountIds: [] }, now), undefined);
  assert.equal(pickClaudeAccount(accounts.map(a => ({ ...a, organizationId: undefined })), 'base', config, now), undefined);
});

test('automatic mode prepares threshold rotation without falsely confirming the request account', async t => {
  const f = await fixture(t), id = await f.add(); const primaryToken = f.put('default'); f.put(id);
  f.usage.set(`Bearer ${primaryToken}`, { five_hour: { utilization: 90 }, seven_day: { utilization: 25 } });
  const selected = await f.request('select', { accountId: 'default' });
  await f.request('confirm', { generation: selected.data.projection.generation });
  await f.request('configure', { config: { mode: 'automatic' } });
  const checked = await f.request('check');
  assert.equal(checked.status, 'success'); assert.equal(checked.data.projection.accountId, id);
  assert.equal(checked.data.session.activeId, 'default'); assert.equal(checked.data.session.state, 'pending');
  assert.doesNotMatch(JSON.stringify(checked), /private-token|host-secret|api-secret/);
});

test('browser sign-in is cancellable from another worker and releases its reservation', async t => {
  const f = await fixture(t), id = await f.add();
  let entered; const started = new Promise(resolve => entered = resolve);
  f.login(spec => new Promise(resolve => { entered(); spec.signal.addEventListener('abort', () => resolve({ exitCode: null, stdout: 'private-child', stderr: 'private-error', cancelled: true }), { once: true }); }));
  const pending = f.request('login', { accountId: id }); await started;
  const other = createClaudeAccountsService(f.options);
  assert.equal((await other.dispatch({ action: 'cancel-login', accountId: id, sessionId: 'another' })).status, 'success');
  const result = await pending;
  assert.equal(result.status, 'cancelled'); assert.doesNotMatch(JSON.stringify(result), /private-child|private-error/);
  const listed = await f.request('list'); assert.equal(listed.data.accounts.find(a => a.id === id).health, 'login-needed');
});

test('successful relogin keeps native credentials private and detects duplicate identities', async t => {
  const f = await fixture(t), id = await f.add(); f.put('default'); f.put(id);
  await f.request('refresh');
  f.identities.set(f.slot(id), { email: 'default@example.test', orgId: 'organization-one', subscriptionType: 'max' });
  const result = await f.request('login', { accountId: id });
  assert.equal(result.status, 'success');
  const added = result.data.accounts.find(a => a.id === id);
  assert.equal(added.health, 'login-needed'); assert.match(added.healthReason, /already account/);
  assert.doesNotMatch(JSON.stringify(result), /private-token|fixture-secret-output/);
  const rechecked = await f.request('refresh');
  assert.equal(rechecked.data.accounts.find(a => a.id === id).health, 'login-needed');
  assert.equal((await f.request('select', { accountId: id })).status, 'failure');
});

test('elapsed time never releases a possibly suspended desktop account lease', async t => {
  const f = await fixture(t), id = await f.add(); f.put(id);
  const selected = await f.request('select', { accountId: id });
  await f.request('confirm', { generation: selected.data.projection.generation });
  f.clock.now += 30 * 60_000;
  const removed = await f.request('remove', { accountId: id, sessionId: 'another-session' });
  assert.equal(removed.error.code, 'PROJECT_BUSY');
  const listed = await f.request('list', { sessionId: 'another-session' });
  assert.equal(listed.data.leases.find(s => s.sessionId === 'session-one').stale, true);
  assert.equal((await f.request('release-stale', { sessionId: 'another-session', leaseSessionId: 'session-one' })).status, 'failure');
  assert.equal((await f.request('release-stale', { sessionId: 'another-session', leaseSessionId: 'session-one', acknowledgeSessionClosed: true })).status, 'success');
  assert.equal((await f.request('remove', { accountId: id, sessionId: 'another-session' })).status, 'success');
});

test('automatic mode cannot assume stored CLI credentials are the Desktop host identity', async t => {
  const f = await fixture(t), id = await f.add(); const token = f.put('default'); f.put(id);
  f.usage.set(`Bearer ${token}`, { five_hour: { utilization: 99 } });
  await f.request('configure', { config: { mode: 'automatic' } });
  const checked = await f.request('check');
  assert.equal(checked.data.session.state, 'host-managed'); assert.equal(checked.data.projection, undefined);
  assert.equal((await f.request('recover', { failure: 'rate_limit' })).status, 'failure');
});

test('reauthentication cannot replace another live session account identity', async t => {
  const f = await fixture(t), id = await f.add(); f.put(id);
  const selected = await f.request('select', { accountId: id });
  await f.request('confirm', { generation: selected.data.projection.generation });
  const result = await f.request('login', { accountId: id, sessionId: 'another-session' });
  assert.equal(result.error.code, 'PROJECT_BUSY');
  assert.equal(f.calls.some(c => c.args[1] === 'login'), false);
});

test('cancel-switch is generation-scoped and retains the previous selected account lease', async t => {
  const f = await fixture(t), id = await f.add(); f.put(id); f.put('default');
  const primary = await f.request('select', { accountId: 'default' });
  await f.request('confirm', { generation: primary.data.projection.generation });
  const selected = await f.request('select', { accountId: id });
  assert.equal((await f.request('cancel-switch', { generation: 'another-generation' })).status, 'failure');
  const cancelled = await f.request('cancel-switch', { generation: selected.data.projection.generation });
  assert.equal(cancelled.data.session.activeId, 'default'); assert.equal(cancelled.data.session.state, 'projected-unverified');
  assert.equal(cancelled.data.session.pending, undefined);
});

test('rejected credentials stay ineligible until the native sign-in changes', async t => {
  const f = await fixture(t), id = await f.add(); f.put(id);
  const service = createClaudeAccountsService({ ...f.options, fetch: async () => new Response('{}', { status: 401 }) });
  await service.dispatch({ action: 'check', sessionId: 'session-one' });
  assert.equal((await f.request('select', { accountId: id })).error.code, 'AUTH_REJECTED');
  const current = f.credentials.get(path.join(f.slot(id), '.credentials.json'));
  f.credentials.set(path.join(f.slot(id), '.credentials.json'), { ...current, accessToken: 'renewed-private-token' });
  assert.equal((await f.request('select', { accountId: id })).status, 'success');
});

test('failure recovery is bounded and prepares projection without replaying a prompt', async t => {
  const f = await fixture(t), id = await f.add(); f.put('default'); f.put(id);
  const primary = await f.request('select', { accountId: 'default' });
  await f.request('confirm', { generation: primary.data.projection.generation });
  await f.request('configure', { config: { mode: 'automatic' } });
  for (let i = 0; i < 2; i++) {
    const recovered = await f.request('recover', { failure: 'rate_limit' });
    assert.equal(recovered.status, 'success', recovered.summary);
    assert.equal(recovered.data.session.recovery.attempts, i + 1);
    await f.request('confirm', { generation: recovered.data.projection.generation });
  }
  const limited = await f.request('recover', { failure: 'rate_limit' });
  assert.equal(limited.error.code, 'PROJECT_BUSY');
  assert.match(limited.summary, /two switches/);
  assert.equal(f.calls.some(c => c.args.includes('--print')), false);
});

test('cancelled usage request cannot continue to automatic projection', async t => {
  const f = await fixture(t), id = await f.add(); f.put('default'); f.put(id);
  const controller = new AbortController(); let entered;
  const ready = new Promise(resolve => entered = resolve);
  const service = createClaudeAccountsService({ ...f.options, signal: controller.signal, fetch: async (_url, options) => {
    entered(); return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('private-network-error')), { once: true }));
  } });
  const running = service.dispatch({ action: 'check', sessionId: 'session-one' });
  await ready; controller.abort();
  const result = await running;
  assert.equal(result.status, 'cancelled'); assert.equal(result.data, undefined); assert.doesNotMatch(JSON.stringify(result), /private-network-error/);
});

test('prototype session names are rejected before touching session metadata', async t => {
  const f = await fixture(t);
  for (const sessionId of ['__proto__', 'constructor', 'prototype']) assert.equal((await f.request('list', { sessionId })).status, 'failure');
});

test('concurrent writers recover a dead owner without deleting a new live lock', async t => {
  const f = await fixture(t);
  const pid = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
    child.once('error', reject); child.once('exit', () => resolve(child.pid));
  });
  await fs.mkdir(path.join(f.directory, '.lock'), { recursive: true });
  const owner = crypto.randomUUID();
  await fs.writeFile(path.join(f.directory, '.lock', `${owner}.json`), JSON.stringify({ pid, owner }));
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => createClaudeAccountsService(f.options).dispatch({ action: 'add', sessionId: `recovery-${i}` })));
  for (const result of results) assert.equal(result.status, 'success', result.summary);
  assert.equal((await f.request('list')).data.accounts.length, 13);
  await fs.mkdir(path.join(f.directory, '.lock'));
  await fs.mkdir(path.join(f.directory, '.lock-recovery'));
  assert.equal((await f.request('list')).status, 'success', 'legacy empty/orphan recovery directories do not block new locks');
});

test('changed native token must be identified again before its profile can be selected', async t => {
  const f = await fixture(t), id = await f.add(); f.put(id);
  const selected = await f.request('select', { accountId: id });
  await f.request('confirm', { generation: selected.data.projection.generation });
  f.credentials.set(path.join(f.slot(id), '.credentials.json'), { accessToken: 'different-private-native-token', expiresAt: f.clock.now + 3_600_000 });
  f.identities.delete(f.slot(id));
  assert.equal((await f.request('select', { accountId: id })).error.code, 'NOT_AUTHENTICATED');
  const refreshed = await f.request('refresh');
  const profile = refreshed.data.accounts.find(a => a.id === id);
  assert.equal(profile.health, 'unavailable'); assert.equal(profile.email, undefined);
});

test('credential changes bypass the usage cache and fetch the new credential quota', async t => {
  const f = await fixture(t), id = await f.add(); const oldToken = f.put(id);
  f.usage.set(`Bearer ${oldToken}`, { five_hour: { utilization: 11 }, seven_day: { utilization: 12 } });
  await f.request('check');
  f.credentials.set(path.join(f.slot(id), '.credentials.json'), { accessToken: 'new-private-credential', expiresAt: f.clock.now + 3_600_000 });
  f.usage.set('Bearer new-private-credential', { five_hour: { utilization: 71 }, seven_day: { utilization: 72 } });
  const refreshed = await f.request('refresh');
  const profile = refreshed.data.accounts.find(a => a.id === id);
  assert.equal(profile.usage.fiveHour.percentUsed, 71);
  assert.equal(profile.usage.week.percentUsed, 72);
});

test('failed usage fetch after credential change discards quota cached under the old credential', async t => {
  const f = await fixture(t), id = await f.add(); f.put(id);
  assert.ok((await f.request('check')).data.accounts.find(a => a.id === id).usage);
  f.credentials.set(path.join(f.slot(id), '.credentials.json'), { accessToken: 'renewed-private-credential', expiresAt: f.clock.now + 3_600_000 });
  const service = createClaudeAccountsService({ ...f.options, fetch: async () => new Response('{}', { status: 503 }) });
  const refreshed = await service.dispatch({ action: 'refresh', sessionId: 'session-one' });
  assert.equal(refreshed.data.accounts.find(a => a.id === id).usage, undefined);
});

test('automatic selection rejects missing or malformed weekly usage and accepts explicit no-weekly-limit', async t => {
  const f = await fixture(t), missing = await f.add(), inapplicable = await f.add(), malformed = await f.add(); f.put('default');
  f.usage.set(`Bearer ${f.put(missing)}`, { five_hour: { utilization: 1 } });
  f.usage.set(`Bearer ${f.put(inapplicable)}`, { five_hour: { utilization: 30 }, seven_day: null });
  f.usage.set(`Bearer ${f.put(malformed)}`, { five_hour: { utilization: 2 }, seven_day: { utilization: 'unknown' } });
  const checked = await f.request('check');
  const accounts = checked.data.accounts;
  assert.equal(accounts.find(a => a.id === missing).usage.weekStatus, 'unknown');
  assert.equal(accounts.find(a => a.id === malformed).usage.weekStatus, 'unknown');
  assert.equal(accounts.find(a => a.id === inapplicable).usage.weekStatus, 'not-applicable');
  assert.equal(pickClaudeAccount(accounts, 'default', checked.data.config, f.clock.now).id, inapplicable);
  assert.equal(pickClaudeAccount(accounts.filter(a => a.id !== inapplicable), 'default', checked.data.config, f.clock.now), undefined);
});

test('malformed metadata fails closed without discarding existing accounts', async t => {
  const f = await fixture(t); await f.request('list');
  await fs.writeFile(path.join(f.directory, 'accounts.json'), 'broken metadata');
  const result = await f.request('add');
  assert.equal(result.error.code, 'STORE_ERROR');
  assert.equal(await fs.readFile(path.join(f.directory, 'accounts.json'), 'utf8'), 'broken metadata');
});
