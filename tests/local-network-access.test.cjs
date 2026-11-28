const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePlistXml, localNetworkRules, defaultBrowserId, browserAccess, readBrowserAccess } = require('../dist/hosts/localNetworkAccess');
const { checkSignInPage, signInLocalAddress, announceSignInPage } = require('../dist/hosts/claudeSignIn');

// A keyed archive shaped like macOS's network extension preferences, with made-up apps and paths.
const uid = n => `<dict><key>CF$UID</key><integer>${n}</integer></dict>`;
const string = s => `<string>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string>`;
function rulesArchive(rules) {
  const objects = ['<string>$null</string>', '<dict><key>$classes</key><array><string>NEPathRule</string><string>NEAppRule</string><string>NSObject</string></array><key>$classname</key><string>NEPathRule</string></dict>',
    '<dict><key>$classes</key><array><string>NEProfileIngestionPayloadInfo</string></array><key>$classname</key><string>NEProfileIngestionPayloadInfo</string></dict>'];
  for (const rule of rules) {
    const signing = objects.push(string(rule.id)) - 1, file = rule.path ? objects.push(string(rule.path)) - 1 : 0;
    objects.push(`<dict>\n\t\t\t<key>$class</key>${uid(rule.kind ?? 1)}<key>DenyMulticast</key>${rule.denied ? '<true/>' : '<false/>'}<key>MulticastPreferenceSet</key>${rule.decided ? '<true/>' : '<false/>'}`
      + `<key>Path</key>${uid(file)}<key>SigningIdentifier</key>${uid(signing)}<key>WiFiBehavior</key><integer>0</integer><key>MatchDomains</key>${uid(0)}</dict>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>$archiver</key>\n\t<string>NSKeyedArchiver</string>\n\t<key>$objects</key>\n\t<array>\n${objects.map(o => '\t\t' + o).join('\n')}\n\t</array>\n\t<key>$version</key>\n\t<integer>100000</integer>\n</dict>\n</plist>\n`;
}
const INSTALLED = '/Applications/Example Browser.app/Contents/MacOS/Example Browser';
const clone = id => `/private/var/folders/xx/fixture/X/com.example.Browser.code_sign_clone/code_sign_clone.${id}/Example Browser.app.bundle/Contents/MacOS/Example Browser`;
const BROWSER = 'com.example.Browser';

test('the XML property list reader keeps dictionaries, arrays, scalars and entities', () => {
  assert.deepEqual(parsePlistXml('<?xml version="1.0"?>\n<!DOCTYPE plist PUBLIC "x" "y">\n<plist version="1.0"><dict>\n<key>a &amp; b</key><array><integer>-3</integer><real>1.5</real><true/><false/><string/><string> spaced </string><data>AAE=</data></array>'
    + '<key>empty</key><dict/><key>uid</key><dict><key>CF$UID</key><integer>7</integer></dict><key>text</key><string>&lt;Zoë&gt; &#x41;&#66;</string></dict></plist>'),
  { 'a & b': [-3, 1.5, true, false, '', ' spaced ', 'AAE='], empty: {}, uid: { 'CF$UID': 7 }, text: '<Zoë> AB' });
  assert.throws(() => parsePlistXml('<plist><dict><key>a</key></dict></plist>'));
  assert.throws(() => parsePlistXml('<plist><array><string>open</array></plist>'));
});

test('the Local Network rules are the path rules of the keyed archive, with their switch and whether it was chosen', () => {
  const rules = localNetworkRules(rulesArchive([{ id: BROWSER, path: INSTALLED, denied: true, decided: true }, { id: 'com.example.Tool', denied: false, decided: true },
    { id: 'com.example.Other', path: '/Applications/Other.app/Contents/MacOS/Other', denied: true, decided: false }, { id: 'com.example.Profile', path: '/x', kind: 2, denied: true, decided: true }]));
  assert.deepEqual(rules, [{ path: INSTALLED, signingIdentifier: BROWSER, denied: true, decided: true }, { path: '', signingIdentifier: 'com.example.Tool', denied: false, decided: true },
    { path: '/Applications/Other.app/Contents/MacOS/Other', signingIdentifier: 'com.example.Other', denied: true, decided: false }]);
  assert.deepEqual(localNetworkRules('<plist><dict/></plist>'), []);
});

test('the default browser is the https handler, then http, else Safari', () => {
  assert.equal(defaultBrowserId({ LSHandlers: [{ LSHandlerURLScheme: 'mailto', LSHandlerRoleAll: 'com.example.mail' }, { LSHandlerURLScheme: 'https', LSHandlerRoleAll: 'com.example.Browser' }] }), 'com.example.browser');
  assert.equal(defaultBrowserId({ LSHandlers: [{ LSHandlerURLScheme: 'http', LSHandlerRoleViewer: 'com.example.Other' }] }), 'com.example.other');
  assert.equal(defaultBrowserId({}), 'com.apple.safari');
  assert.equal(defaultBrowserId(null), 'com.apple.safari');
});

test('the running copy of the browser decides, since macOS keeps one rule per executable path', () => {
  const rules = [{ path: INSTALLED, signingIdentifier: BROWSER, denied: true, decided: true }, { path: clone('AbC123'), signingIdentifier: BROWSER, denied: false, decided: true },
    { path: clone('DeF456'), signingIdentifier: BROWSER, denied: true, decided: true }, { path: '/Applications/Other.app/Contents/MacOS/Other', signingIdentifier: 'com.example.Other', denied: false, decided: true }];
  assert.deepEqual(browserAccess('com.example.browser', rules, [INSTALLED, '/usr/sbin/cfprefsd']), { name: 'Example Browser', access: 'denied', rules: 3 });
  assert.deepEqual(browserAccess('com.example.browser', rules, [clone('AbC123')]), { name: 'Example Browser', access: 'allowed', rules: 3 });
  assert.deepEqual(browserAccess('com.example.browser', rules, [clone('NeW789')]), { name: 'Example Browser', access: 'unknown', rules: 3 }, 'a copy macOS has not asked about yet');
  assert.deepEqual(browserAccess('com.example.browser', rules, []), { name: 'Example Browser', access: 'denied', rules: 3 }, 'not running: the installed path decides');
  assert.deepEqual(browserAccess('com.example.browser', rules.slice(1), []), { name: 'Example Browser', access: 'unknown', rules: 2 }, 'only copies have rules');
  assert.deepEqual(browserAccess('com.example.browser', [{ ...rules[0], decided: false }], [INSTALLED]), { name: 'Example Browser', access: 'unknown', rules: 1 }, 'never chosen');
  assert.deepEqual(browserAccess('com.google.chrome', rules, []), { name: 'Google Chrome', access: 'unknown', rules: 0 }, 'no rule: named, not judged');
  assert.deepEqual(browserAccess('com.example.unlisted', [], []), { name: 'Your browser', access: 'unknown', rules: 0 });
  assert.deepEqual(browserAccess('com.example.tool', [{ path: '', signingIdentifier: 'com.example.Tool', denied: true, decided: true }], []), { name: 'Your browser', access: 'denied', rules: 1 }, 'a rule without a path covers the app');
});

test('the worker reads the three files with fixed commands and gives up quietly', async () => {
  const calls = [];
  const fake = answers => ({ runProcess: async spec => { calls.push(spec); return answers[spec.args.includes('xml1') ? 'rules' : spec.executable === '/bin/ps' ? 'ps' : 'handlers'] } });
  const ok = stdout => ({ exitCode: 0, stdout, stderr: '' }), failed = { exitCode: 1, stdout: '', stderr: 'no file' };
  const archive = rulesArchive([{ id: BROWSER, path: INSTALLED, denied: true, decided: true }]);
  const handlers = JSON.stringify({ LSHandlers: [{ LSHandlerURLScheme: 'https', LSHandlerRoleAll: 'com.example.browser' }] });
  assert.deepEqual(await readBrowserAccess(fake({ handlers: ok(handlers), rules: ok(archive), ps: ok(`/sbin/launchd\n${INSTALLED}\n`) }), 'darwin', '/home/fixture'), { name: 'Example Browser', access: 'denied', rules: 1 });
  assert.deepEqual(calls.map(c => [c.executable, ...c.args]).sort(), [['/bin/ps', '-axo', 'comm='],
    ['/usr/bin/plutil', '-convert', 'json', '-o', '-', '/home/fixture/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist'],
    ['/usr/bin/plutil', '-convert', 'xml1', '-o', '-', '/Library/Preferences/com.apple.networkextension.plist']]);
  assert.ok(calls.every(c => c.timeoutMs <= 3000));
  assert.deepEqual(await readBrowserAccess(fake({ handlers: failed, rules: ok(rulesArchive([{ id: 'com.apple.Safari', path: '/Applications/Safari.app/Contents/MacOS/Safari', denied: false, decided: true }])), ps: failed }), 'darwin', '/home/fixture'),
    { name: 'Safari', access: 'allowed', rules: 1 }, 'no chosen browser is Safari');
  assert.equal(await readBrowserAccess(fake({ handlers: ok(handlers), rules: failed, ps: ok('') }), 'darwin', '/home/fixture'), null);
  assert.equal(await readBrowserAccess(fake({ handlers: ok(handlers), rules: ok('<plist><dict><key>a</key></plist>'), ps: ok('') }), 'darwin', '/home/fixture'), null, 'an unreadable archive');
  calls.length = 0;
  assert.equal(await readBrowserAccess(fake({}), 'linux'), null); assert.equal(calls.length, 0, 'nothing is read off macOS');
});

test('on this machine the reader answers or stays silent, never throws', { skip: process.platform !== 'darwin' }, async () => {
  const { createNodeHost } = require('@dev-mainsequence/devtools');
  const found = await readBrowserAccess(createNodeHost(() => {}));
  assert.ok(found === null || (typeof found.name === 'string' && ['allowed', 'denied', 'unknown'].includes(found.access)), JSON.stringify(found));
});

test('the sign-in page carries its local address and the browser rule; a public page carries neither', async () => {
  const lookup = async host => host === 'dev-backend.test' ? [{ address: '2001:db8::1' }, { address: '192.168.50.7' }] : [{ address: '34.1.2.3' }];
  assert.equal(await signInLocalAddress('http://dev-backend.test:8000/auth/', 'darwin', lookup), '192.168.50.7');
  assert.equal(await signInLocalAddress('http://dev-backend.test:8000/auth/', 'linux', lookup), '');
  assert.equal(await signInLocalAddress('https://api.main-sequence.app/auth/', 'darwin', lookup), '');
  const pages = [], host = { openBrowser: async () => true, runProcess: async () => ({ exitCode: 0, stdout: '', stderr: '' }) };
  announceSignInPage(host, page => pages.push(page), () => {}, async () => ({ localNetwork: true, address: '192.168.50.7', browser: { name: 'Example Browser', access: 'denied' } }));
  await host.openBrowser('http://dev-backend.test:8000/auth/cli/authorize/?state=x');
  assert.deepEqual(pages, [{ type: 'browser', url: 'http://dev-backend.test:8000/auth/cli/authorize/?state=x', localNetwork: true, address: '192.168.50.7', browser: { name: 'Example Browser', access: 'denied' } }]);
  assert.deepEqual(await checkSignInPage('https://api.main-sequence.app/auth/cli/authorize/', { runProcess: async () => { throw new Error('not read for a public page'); } }), { localNetwork: false });
});
