// Publish this repository's verified source build; update only generated catalog metadata.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const repository = 'mainsequence-sdk/mainsequence-claude-desktop';
function run(command, args, cwd = root, capture = false, env = process.env) {
  const r = spawnSync(command, args, { cwd, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (r.status !== 0) throw new Error(`${command} ${args[0]} failed: ${capture ? r.stderr?.trim() : r.status}`);
  return r.stdout?.trim();
}
if (run('git', ['status', '--porcelain'], root, true)) throw new Error('Commit and push the checked source before publishing.');
const revision = run('git', ['rev-parse', 'HEAD'], root, true);
const origin = run('git', ['remote', 'get-url', 'origin'], root, true);
if (!origin.endsWith(`${repository}.git`) && !origin.endsWith(repository)) throw new Error('Origin must be this Claude repository.');
const remote = JSON.parse(run('gh', ['repo', 'view', repository, '--json', 'visibility,defaultBranchRef'], root, true));
if (remote.visibility !== 'PUBLIC') throw new Error('Expected a public repository; visibility is never changed.');
if (run('gh', ['api', `repos/${repository}/commits/${revision}`, '--jq', '.sha'], root, true) !== revision) throw new Error('Source revision must already be pushed.');
const lock = require('../package-lock.json').packages['node_modules/@dev-mainsequence/devtools'];
if (lock.version !== pkg.dependencies['@dev-mainsequence/devtools'] || !lock.integrity ||
  lock.resolved !== `https://registry.npmjs.org/@dev-mainsequence/devtools/-/devtools-${lock.version}.tgz`) throw new Error('Release must pin a registry devtools package with integrity.');
const tag = `v${pkg.version}`, filename = `mainsequence-claude-desktop-${pkg.version}.zip`;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mainsequence-claude-release-'));
try {
  const snapshot = path.join(temporary, 'artifacts'); fs.mkdirSync(snapshot);
  for (const name of [filename, filename + '.sha256']) fs.copyFileSync(path.join(root, 'artifacts', name), path.join(snapshot, name));
  fs.cpSync(path.join(root, 'artifacts/claude-distribution'), path.join(snapshot, 'claude-distribution'), { recursive: true });
  run(process.execPath, [path.join(__dirname, 'verify-claude-distribution.cjs')], root, false, { ...process.env, MS_CLAUDE_ARTIFACTS_DIR: snapshot });
  const catalogFile = '.claude-plugin/marketplace.json';
  const catalog = JSON.parse(fs.readFileSync(path.join(snapshot, 'claude-distribution', catalogFile), 'utf8'));
  const checkout = path.join(temporary, 'catalog');
  run('git', ['clone', '--depth', '1', '--branch', remote.defaultBranchRef.name, `https://github.com/${repository}.git`, checkout]);
  const existingCatalog = JSON.parse(fs.readFileSync(path.join(checkout, catalogFile), 'utf8'));
  const currentVersion = existingCatalog.plugins[0].version;
  const numeric = version => version.split('.').map(Number);
  const current = numeric(currentVersion), incoming = numeric(pkg.version);
  if (current.some((n, i) => n > incoming[i] && current.slice(0, i).every((m, j) => m === incoming[j]))) throw new Error('Refusing to downgrade the marketplace.');
  const lookup = spawnSync('gh', ['release', 'view', tag, '--repo', repository, '--json', 'isDraft,assets,tagName'], { encoding: 'utf8' });
  let release;
  if (lookup.status === 0) release = JSON.parse(lookup.stdout);
  else if (!/release not found/i.test(lookup.stderr || '')) throw new Error('Could not inspect the release.');
  if (!release) {
    const notes = path.join(temporary, 'notes.md');
    const versionNotes = path.join(root, 'docs/releases', `${pkg.version}.md`);
    const description = fs.existsSync(versionNotes) ? fs.readFileSync(versionNotes, 'utf8').trim()
      : `MainSequence for Claude Desktop Code ${pkg.version} preview. Bundles @dev-mainsequence/devtools@${lock.version}.`;
    fs.writeFileSync(notes, `${description}\n\nSource revision: ${revision}. Archive SHA-256: ${catalog.plugins[0].source.sha256}.\n`);
    run('gh', ['release', 'create', tag, '--repo', repository, '--target', revision, '--draft', '--prerelease', '--title', `MainSequence Desktop ${pkg.version} preview`, '--notes-file', notes]);
    release = JSON.parse(run('gh', ['release', 'view', tag, '--repo', repository, '--json', 'isDraft,assets,tagName'], root, true));
  }
  const download = path.join(temporary, 'download'); fs.mkdirSync(download);
  for (const name of [filename, filename + '.sha256']) {
    if (!release.assets.some(asset => asset.name === name)) {
      if (!release.isDraft) throw new Error('Published release missing asset; use a new version.');
      run('gh', ['release', 'upload', tag, '--repo', repository, path.join(snapshot, name)]);
    }
    run('gh', ['release', 'download', tag, '--repo', repository, '--pattern', name, '--dir', download]);
    if (!fs.readFileSync(path.join(download, name)).equals(fs.readFileSync(path.join(snapshot, name)))) throw new Error('Release bytes differ; published assets are immutable.');
  }
  if (release.isDraft) run('gh', ['release', 'edit', tag, '--repo', repository, '--draft=false', '--prerelease']);
  fs.copyFileSync(path.join(snapshot, 'claude-distribution', catalogFile), path.join(checkout, catalogFile));
  fs.writeFileSync(path.join(checkout, 'mainsequence-distribution.json'), JSON.stringify({ host: 'claude-desktop-code', version: pkg.version,
    devtools: lock.version, archiveSha256: catalog.plugins[0].source.sha256, sourceRevision: revision }, null, 2) + '\n');
  run('git', ['add', '--', catalogFile, 'mainsequence-distribution.json'], checkout);
  if (run('git', ['diff', '--cached', '--name-only'], checkout, true)) {
    run('git', ['-c', 'user.name=MainSequence Release', '-c', 'user.email=release@mainsequence.io', 'commit', '-m', `Publish Claude Desktop ${pkg.version} catalog`], checkout);
    run('git', ['-c', 'credential.helper=!gh auth git-credential', 'push', 'origin', `HEAD:${remote.defaultBranchRef.name}`], checkout);
  }
  console.log(`Published https://github.com/${repository}/releases/tag/${tag}`);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
