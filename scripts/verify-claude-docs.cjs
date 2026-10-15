const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const documents = ['docs/agents.md', 'README.md', 'docs/claude-desktop.md', 'docs/claude-desktop-verification.md', 'docs/claude-desktop-distribution.md', 'docs/adr/0004-claude-desktop-mod.md', 'docs/adr/0005-user-authored-agent-interactions.md'];
for (const filename of documents) {
  const source = fs.readFileSync(path.join(root, filename), 'utf8');
  for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z]+:/.test(target)) continue;
    assert.ok(fs.existsSync(path.resolve(root, path.dirname(filename), target)), `${filename}: missing link ${target}`);
  }
}
const pkg = require('../package.json');
for (const filename of documents) {
  const document = fs.readFileSync(path.join(root, filename), 'utf8');
  for (const [, script] of document.matchAll(/npm run ([a-z:-]+)/g)) assert.ok(pkg.scripts[script], `Undocumented/missing npm script ${script}`);
}
assert.ok(fs.existsSync(path.join(root, 'third_party/claude-account-rotator/LICENSE')), 'Missing upstream attribution');
assert.ok(fs.readFileSync(path.join(root, 'README.md'), 'utf8').includes('docs/claude-desktop.md'), 'Root README must link the Desktop guide');
console.log('Claude Desktop documentation links, verification commands and attribution verified.');
