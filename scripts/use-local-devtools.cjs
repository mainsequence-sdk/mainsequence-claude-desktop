// Install a verified local release archive without changing the pinned registry dependency.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const archive = path.resolve(process.argv[2] ?? '');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const entry = lock.packages['node_modules/@dev-mainsequence/devtools'];
assert.equal(entry.version, pkg.dependencies['@dev-mainsequence/devtools']);
const integrity = 'sha512-' + crypto.createHash('sha512').update(fs.readFileSync(archive)).digest('base64');
assert.equal(integrity, entry.integrity, 'Archive must match the exact version/integrity in package-lock.json');
const members = cp.execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
assert.ok(members.every(name => name.startsWith('package/') && !name.split('/').includes('..')), 'Unexpected archive path');
const parent = path.join(root, 'node_modules', '@dev-mainsequence');
fs.mkdirSync(parent, { recursive: true });
const temporary = fs.mkdtempSync(path.join(parent, '.devtools-'));
try {
  cp.execFileSync('tar', ['-xzf', archive, '-C', temporary, '--strip-components=1']);
  const metadata = JSON.parse(fs.readFileSync(path.join(temporary, 'package.json'), 'utf8'));
  assert.equal(metadata.name, '@dev-mainsequence/devtools'); assert.equal(metadata.version, entry.version);
  const target = path.join(parent, 'devtools');
  fs.rmSync(target, { recursive: true, force: true }); fs.renameSync(temporary, target);
  console.log(`Installed the verified local ${metadata.name}@${metadata.version}; registry pin is unchanged.`);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
