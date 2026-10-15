const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');
const core = require('@dev-mainsequence/devtools');
const root = path.resolve(__dirname, '..');

test('Claude imports only the public devtools API and has no maintained shared implementation', () => {
  assert.equal(fs.existsSync(path.join(root, 'src/shared')), false);
  function walk(directory) {
    for (const name of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, name.name);
      if (name.isDirectory()) walk(file);
      else if (file.endsWith('.ts')) {
        const source = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(source, /@dev-mainsequence\/devtools\//, file);
        assert.doesNotMatch(source, /from\s+['"][^'"]*(?:\/shared\/|codex-plugin|node_modules|\.\.\/\.\.\/\.\.)/, file);
      }
    }
  }
  walk(path.join(root, 'src'));
  for (const name of ['createDevTools', 'createNodeHost', 'createProjectOperations', 'ToolingError']) assert.equal(typeof core[name], 'function');
  assert.match(pkg.dependencies['@dev-mainsequence/devtools'], /^\d+\.\d+\.\d+$/);
});

test('built worker includes the pinned package and shared failures keep the public contract', async () => {
  const info = require('../claude/build-info.json');
  const bundled = require('../claude/dist/vendor/devtools/package.json');
  assert.equal(info.devtools.version, pkg.dependencies['@dev-mainsequence/devtools']);
  assert.equal(bundled.version, info.devtools.version);
  assert.equal(bundled.name, '@dev-mainsequence/devtools');
  assert.equal(fs.existsSync(path.join(root, 'claude/dist/vendor/devtools/hosts')), false);
  const result = await core.createProjectOperations({ host: core.createNodeHost() }).dispatch({ action: 'unsupported-operation' });
  assert.equal(result.schemaVersion, 1); assert.equal(result.error.code, 'INVALID_REQUEST');
});


test('release carries branding but no Claude credential reader, account worker or auth lifecycle hooks', () => {
  for(const filename of ['claudeAccounts.js','claudeRuntime.js']) assert.equal(fs.existsSync(path.join(root,'claude/dist/hosts',filename)),false);
  const hooks=fs.readFileSync(path.join(root,'claude/hooks/register.mjs'),'utf8');
  assert.doesNotMatch(hooks,/CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_SECURESTORAGE_CONFIG_DIR|\$\.env\.|\$\.fs\.read|projectAccount|runAccount|prompt\.submit|turn\.step|AbovePrompt/);
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'claude/.claude-plugin/plugin.json'),'utf8'));
  assert.equal(manifest.userConfig.claudeExecutable,undefined);
  assert.ok(fs.statSync(path.join(root,'claude/assets/mainsequence-emblem.png')).size>0);
});
