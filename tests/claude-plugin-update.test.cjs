const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { CLAUDE_CATALOG_URL, compareVersions, updateStatus, createClaudePluginUpdate } = require('../dist/hosts/claudePluginUpdate.js');

const catalog = version => ({ plugins: [{ name: 'other', version: '9.9.9' }, { name: 'mainsequence', version }] });
async function engine(t, name = 'claude') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-engine-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, name); await fs.writeFile(file, ''); return file;
}
/** A fake engine: `plugin list --json` answers from `installed`, and every command is recorded. */
function harness(executable, { installed = [{ id: 'mainsequence@mainsequence-desktop', version: '0.4.21', scope: 'user' }], latest = '0.4.22', exit = () => 0, afterUpdate } = {}) {
  const runs = [], fetched = [];
  let rows = installed;
  const host = { openBrowser: async () => false, progress: () => {}, runProcess: async spec => {
    runs.push(spec);
    const code = exit(spec.args);
    if (spec.args[1] === 'update' && code === 0 && afterUpdate) rows = afterUpdate;
    return { exitCode: code, stdout: spec.args[1] === 'list' ? JSON.stringify(rows) : '{}', stderr: '' };
  } };
  const fetch = async (url, init) => { fetched.push({ url, init }); return latest instanceof Error ? Promise.reject(latest)
    : { ok: latest !== null, text: async () => JSON.stringify(catalog(latest)) }; };
  // A test run inside Claude Code inherits the real engine's path; only the fake engine may be found.
  return { runs, fetched, options: { host, fetch, version: '0.4.21', parentExecutable: async () => executable, env: { CLAUDE_CODE_EXECPATH: undefined } } };
}

test('versions order by release, with a prerelease before its release', () => {
  assert.equal(compareVersions('0.4.22', '0.4.21'), 1);
  assert.equal(compareVersions('0.4.9', '0.4.10'), -1);
  assert.equal(compareVersions('0.4.11-rc.2', '0.4.11'), -1);
  assert.equal(compareVersions('0.4.11-rc.10', '0.4.11-rc.2'), 1);
  assert.equal(compareVersions('unknown', '0.4.21'), 0);
  assert.equal(updateStatus('0.4.21', '0.4.21', '0.4.22'), 'update_available');
  assert.equal(updateStatus('0.4.21', '0.4.22', '0.4.22'), 'restart_required');
  assert.equal(updateStatus('0.4.21', '0.4.22', '0.4.23'), 'update_available');
  assert.equal(updateStatus('0.4.21', '0.4.21', '0.4.21'), 'current');
  assert.equal(updateStatus('0.4.21', null, null), 'unknown');
  assert.equal(updateStatus('unknown', '0.4.21', '0.4.22'), 'unknown');
});

test("the version check reads Claude's installed copy and the published catalog without changing anything", async t => {
  const executable = await engine(t), h = harness(executable);
  const result = await createClaudePluginUpdate(h.options).dispatch({ action: 'plugin-version' });
  assert.equal(result.status, 'success');
  assert.deepEqual(result.data, { running: '0.4.21', installed: '0.4.21', latest: '0.4.22', status: 'update_available', updateSupported: true });
  assert.equal(result.summary, 'MainSequence 0.4.22 is available.');
  assert.deepEqual(h.runs.map(run => [run.executable, ...run.args]), [[executable, 'plugin', 'list', '--json']]);
  assert.equal(h.fetched[0].url, CLAUDE_CATALOG_URL);
});

test('an unreachable catalog or a missing engine still reports the running version', async t => {
  const offline = harness(await engine(t), { latest: new Error('offline') });
  const result = await createClaudePluginUpdate(offline.options).dispatch({ action: 'plugin-version' });
  assert.equal(result.status, 'success'); assert.equal(result.data.status, 'unknown'); assert.equal(result.data.running, '0.4.21');
  assert.match(result.data.catalogError, /could not be reached/);
  for (const executable of [await engine(t, 'node'), 'relative/claude', path.join(os.tmpdir(), 'missing-engine', 'claude')]) {
    const h = harness(executable);
    const answer = await createClaudePluginUpdate(h.options).dispatch({ action: 'plugin-version' });
    assert.deepEqual([answer.data.status, answer.data.installed, answer.data.updateSupported], ['update_available', null, false], executable);
    assert.equal(h.runs.length, 0, 'only a file named claude is ever run');
    const update = await createClaudePluginUpdate(h.options).dispatch({ action: 'plugin-update' });
    assert.equal(update.error.code, 'UNSUPPORTED_ACTION');
  }
});

test("Claude's engine is found from the environment when the parent process is not it", async t => {
  const executable = await engine(t), h = harness(await engine(t, 'node'));
  const result = await createClaudePluginUpdate({ ...h.options, env: { CLAUDE_CODE_EXECPATH: executable } }).dispatch({ action: 'plugin-version' });
  assert.equal(result.data.updateSupported, true); assert.equal(h.runs[0].executable, executable);
});

test("updating refreshes the marketplace, then runs Claude's updater in the installed scope without accepting commands", async t => {
  const executable = await engine(t);
  const h = harness(executable, { afterUpdate: [{ id: 'mainsequence@mainsequence-desktop', version: '0.4.22', scope: 'user' }] });
  const result = await createClaudePluginUpdate(h.options).dispatch({ action: 'plugin-update' });
  assert.equal(result.status, 'success', JSON.stringify(result));
  assert.deepEqual(result.data, { running: '0.4.21', previous: '0.4.21', installed: '0.4.22', status: 'restart_required' });
  assert.equal(result.summary, 'MainSequence 0.4.22 is installed. Start a new Code session to use it.');
  assert.deepEqual(h.runs.map(run => run.args.join(' ')), ['plugin list --json', 'plugin marketplace update mainsequence-desktop --json',
    'plugin update mainsequence@mainsequence-desktop --scope user --json', 'plugin list --json']);
  assert.equal(h.runs.some(run => run.args.includes('-y') || run.args.includes('--yes')), false);
});

test('a failed refresh or update is reported and nothing else runs', async t => {
  const executable = await engine(t);
  const refresh = harness(executable, { exit: args => args[1] === 'marketplace' ? 1 : 0 });
  const refused = await createClaudePluginUpdate(refresh.options).dispatch({ action: 'plugin-update' });
  assert.equal(refused.status, 'failure'); assert.match(refused.summary, /could not refresh the mainsequence-desktop marketplace/);
  assert.equal(refresh.runs.some(run => run.args[1] === 'update'), false);
  const update = harness(executable, { exit: args => args[1] === 'update' ? 1 : 0 });
  const failed = await createClaudePluginUpdate(update.options).dispatch({ action: 'plugin-update' });
  assert.equal(failed.status, 'failure'); assert.equal(failed.summary, 'Claude could not update MainSequence.');
  const missing = harness(executable, { installed: [{ id: 'mainsequence@uploaded', version: '0.4.21' }] });
  assert.equal((await createClaudePluginUpdate(missing.options).dispatch({ action: 'plugin-update' })).error.code, 'UNSUPPORTED_ACTION');
});
