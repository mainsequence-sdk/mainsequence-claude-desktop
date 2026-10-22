const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { repositorySshKeyIdentity } = require('@dev-mainsequence/devtools');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const token = 'fixture-platform-token';
const origin = 'git@github.com:Acme/Pricing.git';
const identity = repositorySshKeyIdentity(origin).identity;

/** A checkout with one commit on `branch`, its origin set to `remote`, outside any repositories folder. */
async function checkout(parent, name, branch, remote) {
  const root = path.join(parent, name);
  await fs.mkdir(root, { recursive: true });
  const git = args => execFileSync('git', args, { cwd: root, stdio: 'ignore', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });
  git(['init', '-b', branch]); git(['config', 'user.email', 'fixture@example.test']); git(['config', 'user.name', 'Fixture']);
  await fs.writeFile(path.join(root, 'README.md'), name);
  git(['add', '.']); git(['commit', '-m', 'fixture']);
  if (remote) git(['remote', 'add', 'origin', remote]);
  return { root: await fs.realpath(root), git };
}

test('packaged worker identifies a checkout anywhere on disk from its Git remote, falling back to registered branch names', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-local-identity-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const requests = [];
  // Like the platform: one visible registered branch (`main`) of one repository matches the identity; everything else is 404.
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const url = new URL(req.url, 'http://127.0.0.1');
    const payload = body ? JSON.parse(body) : {};
    requests.push({ method: req.method, path: url.pathname, authorization: req.headers.authorization, ...payload });
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== `Bearer ${token}`) return res.writeHead(401).end('{}');
    if (req.method === 'POST' && url.pathname === '/api/v1/code-repository-branches/resolve-git-context/'
      && payload.repository_identity === identity && payload.repository_branch === 'main') {
      return res.end(JSON.stringify({ canonical_repository_identity: identity, repository_branch: 'main', repository_ref: 'refs/heads/main', commit_sha: payload.commit_sha,
        code_repository_branch: { uid: id(4), code_repository_uid: id(3), code_repository_name: 'Pricing', repository_branch: 'main', is_initialized: true } }));
    }
    res.writeHead(404).end(JSON.stringify({ detail: 'No visible CodeRepositoryBranch matches the Git source context.', code: 'code_repository_branch_git_context_not_found' }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const backend = `http://127.0.0.1:${server.address().port}`;
  const packageRoot = path.resolve(__dirname, '../claude');
  async function run(action, extra = {}) {
    const envelope = { protocolVersion: 1, id: 'local-identity', request: { scope: 'projects', request: { action, ...extra } } };
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(packageRoot, 'dist/claudeRunner.js')], { cwd: temp, env: { PATH: process.env.PATH, HOME: temp, MAINSEQUENCE_ENDPOINT: backend, MAINSEQUENCE_ACCESS_TOKEN: token }, stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000 });
      let output = '';
      child.stdout.on('data', bytes => { output += bytes; }); child.stderr.resume();
      child.on('error', reject);
      child.on('close', code => {
        try {
          assert.equal(code, 0, 'packaged worker exited successfully');
          const result = output.trim().split('\n').map(line => JSON.parse(line)).find(message => message.type === 'result' && message.id === envelope.id)?.result;
          assert.ok(result, 'correlated result');
          assert.doesNotMatch(output, /fixture-platform-token/, 'credentials never reach the pane');
          resolve(result);
        } catch (error) { reject(error); }
      });
      child.stdin.end(JSON.stringify(envelope));
    });
  }

  const elsewhere = path.join(temp, 'code', 'somewhere else');
  const feature = await checkout(elsewhere, 'pricing', 'feature/risk-fix', origin);
  const tried = () => requests.splice(0).map(request => {
    assert.equal(request.authorization, `Bearer ${token}`);
    assert.match(request.commit_sha, /^[0-9a-f]{40}$/, 'the full commit is sent');
    return request.repository_branch;
  });

  // A feature branch is not registered: the checked-out branch is asked first, then registered names until one matches.
  const onFeature = await run('identify-folder', { backend, root: feature.root, branches: ['main', 'develop', 'main', '', 'bad\nname'] });
  assert.equal(onFeature.status, 'success', onFeature.summary);
  assert.deepEqual(onFeature.data, { root: feature.root, matched: true, repositoryUid: id(3), repositoryName: 'Pricing', branch: 'feature/risk-fix', registeredBranch: 'main' });
  assert.deepEqual(tried(), ['feature/risk-fix', 'main'], 'stops at the first match and never asks for develop');

  // On a registered branch one request suffices and the branch itself is named.
  feature.git(['switch', '-c', 'main']);
  const subfolder = path.join(feature.root, 'src'); await fs.mkdir(subfolder);
  const onMain = await run('identify-folder', { backend, root: subfolder, branches: ['develop'] });
  assert.deepEqual(onMain.data, { root: feature.root, matched: true, repositoryUid: id(3), repositoryName: 'Pricing', branch: 'main', registeredBranch: 'main', branchUid: id(4) });
  assert.deepEqual(tried(), ['main']);
  assert.equal(requests.length, 0);

  // Another remote matches nothing; every request carried the saved credential and the full commit.
  const other = await checkout(elsewhere, 'notes', 'main', 'https://github.com/Acme/Notes.git');
  const unmatched = await run('identify-folder', { backend, root: other.root, branches: ['develop', 'release'] });
  assert.equal(unmatched.status, 'success');
  assert.equal(unmatched.data.matched, false); assert.equal(unmatched.data.root, other.root); assert.match(unmatched.data.reason, /No repository/);
  assert.deepEqual(tried(), ['main', 'develop', 'release']);

  // Folders that are not checkouts are not identified and cost no request.
  const plain = path.join(temp, 'plain folder'); await fs.mkdir(plain);
  const notGit = await run('identify-folder', { backend, root: plain });
  assert.equal(notGit.status, 'success'); assert.equal(notGit.data.matched, false);
  const noRemote = await checkout(elsewhere, 'scratch', 'main');
  assert.equal((await run('identify-folder', { backend, root: noRemote.root })).data.matched, false);
  assert.deepEqual(tried(), []);
  assert.equal((await run('identify-folder', { backend, root: 'relative/path' })).error.code, 'INVALID_REQUEST');
  assert.equal((await run('identify-folder', { backend, root: feature.root, branches: 'main' })).error.code, 'INVALID_REQUEST');

  const existing = await run('existing-folders', { paths: [feature.root, path.join(temp, 'gone'), 'relative', plain] });
  assert.deepEqual(existing.data.existing, [feature.root, plain]);
  assert.equal((await run('existing-folders', { paths: 'nope' })).error.code, 'INVALID_REQUEST');
});
