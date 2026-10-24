// Install the build dependencies with the exact pinned devtools package.
//
// `npm ci --ignore-scripts` installs the pinned devtools from the npm registry. While that
// version is not published yet, this script builds it from the devtools repository at
// DEVTOOLS_SOURCE_REF (default: the tag of the pinned version), or takes a local archive
// path as its argument, checks the archive against the lockfile integrity and installs it
// through scripts/use-local-devtools.cjs without changing the registry pin.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const pin = pkg.dependencies['@dev-mainsequence/devtools'];
const repository = 'https://github.com/mainsequence-sdk/mainsequence-devtools.git';
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`);
};
function published() {
  const view = spawnSync('npm', ['view', `@dev-mainsequence/devtools@${pin}`, 'version'], { encoding: 'utf8' });
  return view.status === 0 && view.stdout.trim() === pin;
}
function buildFromSource(temporary) {
  const ref = process.env.DEVTOOLS_SOURCE_REF || `v${pin}`;
  const checkout = path.join(temporary, 'devtools');
  console.log(`devtools ${pin} is not on the registry; building it from ${repository} at ${ref}.`);
  run('git', ['clone', '--quiet', '--depth', '1', '--branch', ref, repository, checkout]);
  const built = JSON.parse(fs.readFileSync(path.join(checkout, 'package.json'), 'utf8'));
  if (built.version !== pin) throw new Error(`${ref} declares devtools ${built.version}, but this package pins ${pin}.`);
  run('npm', ['ci', '--ignore-scripts'], { cwd: checkout });
  run('npm', ['run', 'build'], { cwd: checkout });
  run('npm', ['pack', '--ignore-scripts', '--pack-destination', temporary], { cwd: checkout });
  return path.join(temporary, `dev-mainsequence-devtools-${pin}.tgz`);
}
function installDevDependencies(temporary) {
  // The lockfile names the unpublished archive, so install the remaining (dev) dependencies
  // from a throwaway manifest and move them into place.
  const staging = path.join(temporary, 'dev-dependencies');
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify({ name: 'codex-plugin-build-dependencies', private: true, devDependencies: pkg.devDependencies }));
  run('npm', ['install', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund'], { cwd: staging });
  fs.rmSync(path.join(root, 'node_modules'), { recursive: true, force: true });
  fs.cpSync(path.join(staging, 'node_modules'), path.join(root, 'node_modules'), { recursive: true, verbatimSymlinks: true });
}
const archiveArgument = process.argv[2];
if (!archiveArgument && published()) {
  run('npm', ['ci', '--ignore-scripts'], { cwd: root });
  console.log(`Installed the published devtools ${pin} from the registry.`);
} else {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-codex-devtools-'));
  try {
    const archive = archiveArgument ? path.resolve(archiveArgument) : buildFromSource(temporary);
    installDevDependencies(temporary);
    run(process.execPath, [path.join(__dirname, 'use-local-devtools.cjs'), archive], { cwd: root });
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
