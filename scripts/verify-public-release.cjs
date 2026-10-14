// Verify the published marketplace in a disposable engine configuration.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const pkg = require('../package.json');
const lock = require('../package-lock.json').packages['node_modules/@dev-mainsequence/devtools'];
const repository = 'mainsequence-sdk/mainsequence-claude-desktop';

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  assert.equal(response.status, 200, `Public download failed: ${url}`);
  return response;
}
async function main() {
  const binary = process.env.MS_CLAUDE_DESKTOP_BINARY;
  assert.ok(binary && path.isAbsolute(binary), 'Set MS_CLAUDE_DESKTOP_BINARY to the absolute path of Desktop\'s bundled Code engine.');
  const catalog = await (await download(`https://raw.githubusercontent.com/${repository}/main/.claude-plugin/marketplace.json`)).json();
  assert.equal(catalog.name, 'mainsequence-desktop');
  assert.equal(catalog.plugins.length, 1);
  const entry = catalog.plugins[0];
  assert.equal(entry.name, 'mainsequence'); assert.equal(entry.version, pkg.version);
  const filename = `mainsequence-claude-desktop-${pkg.version}.zip`;
  assert.equal(entry.source.source, 'archive');
  assert.equal(entry.source.url, `https://github.com/${repository}/releases/download/v${pkg.version}/${filename}`);
  const bytes = Buffer.from(await (await download(entry.source.url)).arrayBuffer());
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest, entry.source.sha256);
  assert.equal((await (await download(entry.source.url + '.sha256')).text()).trim(), `${digest}  ${filename}`);
  console.log(`Anonymous release ${pkg.version} verified: SHA-256 ${digest}.`);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mainsequence-public-install-'));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(temporary, 'config'),
    CLAUDE_SECURESTORAGE_CONFIG_DIR: path.join(temporary, 'credential-slot'),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1' };
  for (const key of ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_API_KEY_HELPER', 'MAINSEQUENCE_ACCESS_TOKEN']) delete env[key];
  function run(args) {
    const result = spawnSync(binary, args, { cwd: temporary, env, encoding: 'utf8', timeout: 60_000 });
    process.stdout.write(result.stdout || '');
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  }
  try {
    run(['plugin', 'marketplace', 'add', `https://github.com/${repository}.git`]);
    run(['plugin', 'install', 'mainsequence@mainsequence-desktop', '--scope', 'user']);
    const installed = JSON.parse(fs.readFileSync(path.join(env.CLAUDE_CONFIG_DIR, 'plugins/installed_plugins.json'), 'utf8'));
    const record = installed.plugins['mainsequence@mainsequence-desktop'][0];
    assert.equal(record.version, pkg.version);
    assert.ok(record.installPath.startsWith(temporary + path.sep), 'Installation escaped the disposable configuration.');
    const info = JSON.parse(fs.readFileSync(path.join(record.installPath, 'build-info.json'), 'utf8'));
    assert.equal(info.devtools.name, '@dev-mainsequence/devtools');
    assert.equal(info.devtools.version, lock.version); assert.equal(info.devtools.integrity, lock.integrity);
    run(['plugin', 'validate', record.installPath]); run(['plugin', 'test', record.installPath]);
    const worker = spawnSync(process.execPath, [path.join(record.installPath, 'dist/claudeRunner.js')], {
      cwd: temporary, env, encoding: 'utf8', timeout: 20_000,
      input: JSON.stringify({ protocolVersion: 1, id: 'public-install-check', request: { scope: 'projects', request: { action: 'runtime-diagnostics' } } }),
    });
    assert.equal(worker.status, 0, worker.stderr || worker.error?.message);
    const result = JSON.parse(worker.stdout.trim());
    assert.equal(result.result.status, 'success'); assert.equal(result.result.data.version, pkg.version);
    assert.equal(result.result.data.bundleHealth.compiledEntry, true);
    console.log('Public marketplace installation, pinned dependency, native fixtures and standalone worker passed. Live GUI/account acceptance is separate.');
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
