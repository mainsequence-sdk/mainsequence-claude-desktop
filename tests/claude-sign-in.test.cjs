const test = require('node:test');
const assert = require('node:assert/strict');
const { localNetworkAddress, signInOverLocalNetwork, announceSignInPage } = require('../dist/hosts/claudeSignIn');

test('the local network is the private, link-local and unique-local ranges, never loopback', () => {
  for (const address of ['192.168.1.10', '10.0.0.5', '172.16.0.1', '172.31.255.255', '169.254.3.4', 'fd12:3456::1', 'FE80::1', '[fe80::1]', '::ffff:192.168.1.10'])
    assert.equal(localNetworkAddress(address), true, address);
  for (const address of ['127.0.0.1', '::1', '8.8.8.8', '172.32.0.1', '172.15.0.1', '100.64.0.1', '2001:db8::1', 'fc::1', 'localhost', ''])
    assert.equal(localNetworkAddress(address), false, address);
});

test('a sign-in page is on the local network on macOS when its host resolves there', async () => {
  const lookup = async host => {
    if (host === 'local-backend') return [{ address: '192.168.1.10' }];
    if (host === 'api.main-sequence.app') return [{ address: '34.1.2.3' }];
    if (host === 'slow.example') return new Promise(() => {});
    throw new Error('ENOTFOUND');
  };
  assert.equal(await signInOverLocalNetwork('http://local-backend:8000/auth/cli/authorize/?state=x', 'darwin', lookup), true);
  assert.equal(await signInOverLocalNetwork('http://local-backend:8000/auth/cli/authorize/', 'linux', lookup), false, 'only macOS has the Local Network permission');
  assert.equal(await signInOverLocalNetwork('https://api.main-sequence.app/auth/cli/authorize/', 'darwin', lookup), false);
  assert.equal(await signInOverLocalNetwork('http://127.0.0.1:8000/auth/cli/authorize/', 'darwin', lookup), false);
  assert.equal(await signInOverLocalNetwork('http://[fd00::5]:8000/auth/cli/authorize/', 'darwin', lookup), true);
  assert.equal(await signInOverLocalNetwork('http://missing.example/auth/', 'darwin', lookup), false);
  assert.equal(await signInOverLocalNetwork('not a url', 'darwin', lookup), false);
  const started = Date.now();
  assert.equal(await signInOverLocalNetwork('http://slow.example/auth/', 'darwin', lookup), false, 'a lookup that never answers does not hold up sign-in');
  assert.ok(Date.now() - started < 5_000);
});

test('the worker names the sign-in page before the browser opens it', async () => {
  const order = [];
  const host = { openBrowser: async url => { order.push(['open', url]); return true; }, runProcess: async () => ({ exitCode: 0, stdout: '', stderr: '' }) };
  announceSignInPage(host, page => order.push(['page', page]), message => order.push(['progress', message]), async url => url.includes('local-backend'));
  assert.equal(await host.openBrowser('http://local-backend:8000/auth/cli/authorize/?state=x'), true);
  assert.deepEqual(order, [
    ['page', { type: 'browser', url: 'http://local-backend:8000/auth/cli/authorize/?state=x', localNetwork: true }],
    ['progress', 'Waiting for you to sign in in your browser…'],
    ['open', 'http://local-backend:8000/auth/cli/authorize/?state=x'],
  ]);
});
