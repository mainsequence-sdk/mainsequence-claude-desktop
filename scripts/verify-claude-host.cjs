const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const artifact = path.resolve(process.env.MS_CLAUDE_PACKAGE || path.join(root, 'claude'));
const manifest = JSON.parse(fs.readFileSync(path.join(artifact, '.claude-plugin/plugin.json'), 'utf8'));
const info = JSON.parse(fs.readFileSync(path.join(artifact, 'build-info.json'), 'utf8'));
assert.equal(info.version, manifest.version);
assert.equal(info.workerProtocol, 1);
const dependency = JSON.parse(fs.readFileSync(path.join(artifact, 'dist/vendor/devtools/package.json'), 'utf8'));
assert.equal(dependency.name, '@dev-mainsequence/devtools');
assert.equal(dependency.version, info.devtools.version);

for (const file of ['hooks/hooks.json', 'hooks/register.mjs', 'hooks/view.mjs', 'hooks/agentView.mjs', 'hooks/projectView.mjs', 'docs/agents.md', 'dist/claudeRunner.js',
  'docs/claude-desktop.md', 'docs/claude-desktop-verification.md', 'third_party/claude-account-rotator/LICENSE']) {
  assert.ok(fs.statSync(path.join(artifact, file)).isFile(), `Missing packaged file: ${file}`);
}
const worker = spawnSync(process.execPath, [path.join(artifact, 'dist/claudeRunner.js')], {
  cwd: artifact, encoding: 'utf8', timeout: 20_000,
  input: JSON.stringify({ protocolVersion: 1, id: 'packaged-smoke', request: { scope: 'projects', request: { action: 'runtime-diagnostics' } } }),
});
assert.equal(worker.status, 0, worker.stderr);
const result = JSON.parse(worker.stdout.trim());
assert.equal(result.result.status, 'success');
assert.equal(result.result.data.version, manifest.version);
assert.equal(result.result.data.bundleHealth.compiledEntry, true);
console.log('Packaged Claude Desktop worker, manifest, docs and attribution passed.');
if (process.env.MS_CLAUDE_DESKTOP_BINARY) {
  const binary = process.env.MS_CLAUDE_DESKTOP_BINARY;
  for (const command of ['validate', ...(fs.existsSync(path.join(artifact, 'tests')) ? ['test'] : [])]) {
    const result = spawnSync(binary, ['plugin', command, artifact], { encoding: 'utf8', timeout: 60_000, cwd: artifact });
    process.stdout.write(result.stdout || '');
    assert.equal(result.status, 0, result.stderr || result.error?.message || `Native plugin ${command} failed`);
  }
} else console.log('Native loader/GUI checks not run: set MS_CLAUDE_DESKTOP_BINARY for loader validation; follow the live acceptance checklist.');
