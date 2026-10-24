// Documentation stays current: links resolve, named npm scripts exist, the README links
// the user guide, and the README and guides carry no plugin or devtools version numbers
// (versions live in package.json, the marketplace and GitHub releases). Claude Desktop
// engine versions (2.1.x) are requirements and may be named.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const guides = ['docs/agent-icons.md', 'docs/agents.md', 'docs/claude-desktop.md', 'docs/claude-desktop-distribution.md'];
const documents = ['README.md', ...guides, 'docs/adr/0004-claude-desktop-mod.md', 'docs/adr/0005-user-authored-agent-interactions.md'];
const pkg = require('../package.json');
for (const filename of documents) {
  const source = fs.readFileSync(path.join(root, filename), 'utf8');
  for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z]+:/.test(target)) continue;
    assert.ok(fs.existsSync(path.resolve(root, path.dirname(filename), target)), `${filename}: missing link ${target}`);
  }
  for (const [, script] of source.matchAll(/npm run ([a-z:-]+)/g)) assert.ok(pkg.scripts[script], `${filename}: unknown npm script ${script}`);
}
for (const filename of ['README.md', ...guides]) {
  const source = fs.readFileSync(path.join(root, filename), 'utf8');
  const versions = [...source.matchAll(/\b\d+\.\d+\.\d+\b/g)].map(match => match[0]).filter(version => !/^2\.1\.\d+$/.test(version));
  assert.deepEqual(versions, [], `${filename} must not name versions; found ${versions.join(', ')}`);
}
assert.ok(fs.existsSync(path.join(root, 'third_party/claude-account-rotator/LICENSE')), 'Missing upstream attribution');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
assert.ok(readme.includes('(docs/claude-desktop.md)'), 'Root README must link the Desktop guide');
assert.ok(readme.includes('https://github.com/mainsequence-sdk/mainsequence-claude-desktop.git'), 'Root README must give the marketplace repository URL');
console.log('Claude Desktop documentation links, verification commands, version-free guides and attribution verified.');
