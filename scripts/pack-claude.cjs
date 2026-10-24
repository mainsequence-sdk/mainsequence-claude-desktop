const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const artifact = path.join(root, 'claude');
const manifest = JSON.parse(fs.readFileSync(path.join(artifact, '.claude-plugin/plugin.json'), 'utf8'));
if (manifest.version !== pkg.version) throw new Error('Build the matching Claude artifact before packing.');
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const archive = path.join(root, 'artifacts', `mainsequence-claude-desktop-${pkg.version}.zip`);
fs.rmSync(archive, { force: true });
// Normalize generated-file metadata/order so a repeated build of the same inputs
// can retry publication without changing the pinned archive digest.
const entries = [];
function inventory(relative = '') {
  for (const name of fs.readdirSync(path.join(artifact, relative)).sort()) {
    if (/[\r\n]/.test(name)) throw new Error('Unexpected newline in plugin filename.');
    const file = path.posix.join(relative, name), absolute = path.join(artifact, file);
    const stat = fs.lstatSync(absolute);
    if (!stat.isDirectory() && !stat.isFile()) throw new Error('Only regular files and directories may be distributed.');
    if (stat.isDirectory()) inventory(file);
    fs.chmodSync(absolute, stat.isDirectory() ? 0o755 : 0o644);
    fs.utimesSync(absolute, 946684800, 946684800);
    entries.push(file + (stat.isDirectory() ? '/' : ''));
  }
}
inventory();
const packed = spawnSync('zip', ['-X', '-q', archive, '-@'], { cwd: artifact, encoding: 'utf8',
  env: { ...process.env, TZ: 'UTC' }, input: entries.sort().join('\n') + '\n' });
if (packed.status !== 0) throw new Error('The zip archiver could not package the Desktop plugin: ' + (packed.error?.message || packed.stderr));
console.log(archive);
const digest = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
fs.writeFileSync(archive + '.sha256', `${digest}  ${path.basename(archive)}\n`);
const repository = 'mainsequence-sdk/mainsequence-claude-desktop';
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Invalid distribution repository.');
const distribution = path.join(root, 'artifacts/claude-distribution');
fs.rmSync(distribution, { recursive: true, force: true });
fs.mkdirSync(path.join(distribution, '.claude-plugin'), { recursive: true });
const catalog = {
  name: 'mainsequence-desktop', owner: { name: 'MainSequence', url: 'https://mainsequence.io' },
  description: 'MainSequence plugins for Claude Desktop Code.',
  plugins: [{ name: manifest.name, version: manifest.version, description: manifest.description,
    homepage: `https://github.com/${repository}`, license: 'MIT',
    source: { source: 'archive', url: `https://github.com/${repository}/releases/download/v${manifest.version}/${path.basename(archive)}`, sha256: digest } }],
};
fs.writeFileSync(path.join(distribution, '.claude-plugin/marketplace.json'), JSON.stringify(catalog, null, 2) + '\n');
for (const file of ['README.md', 'LICENSE', 'NOTICE']) fs.copyFileSync(path.join(artifact, file), path.join(distribution, file));
fs.cpSync(path.join(artifact, 'docs'), path.join(distribution, 'docs'), { recursive: true });
fs.cpSync(path.join(artifact, 'third_party'), path.join(distribution, 'third_party'), { recursive: true });
console.log(`Built checksum-pinned public marketplace for ${repository}.`);
