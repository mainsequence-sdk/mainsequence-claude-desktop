const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createNodeHost } = require('@dev-mainsequence/devtools');
const { createClaudeProjectActions } = require('../dist/hosts/claudeProjectActions.js');
const os = require('node:os');
async function localProject(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-native-project-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root: await fs.realpath(root) };
}

test('native capabilities are reported truthfully and only invoked when supplied', async t => {
  const { root } = await localProject(t), host = createNodeHost();
  const unsupported = createClaudeProjectActions({ host });
  assert.equal((await unsupported.dispatch({ action: 'pick-folder' })).error.code, 'UNSUPPORTED_ACTION');
  assert.equal((await unsupported.dispatch({ action: 'open-container', root })).error.code, 'UNSUPPORTED_ACTION');
  const calls = [];
  const supported = createClaudeProjectActions({ host, version: 'fixture', pickFolder: async initial => { calls.push(initial); return root; }, openContainer: async selected => { calls.push(selected); } });
  const picked = await supported.dispatch({ action: 'pick-folder', initialPath: root });
  assert.equal(picked.data.path, root); assert.equal(picked.data.cancelled, false);
  assert.equal((await supported.dispatch({ action: 'open-container', root })).status, 'success');
  const diagnostics = await supported.dispatch({ action: 'runtime-diagnostics' });
  assert.equal(diagnostics.data.capabilities.pickFolder, true); assert.equal(diagnostics.data.capabilities.openContainer, true);
  assert.deepEqual(calls, [root, root]);
});


test('workspace preferences reuse only the existing folder and never rewrite configuration', async t => {
  const {root}=await localProject(t),configPath=path.join(root,'config.json');
  const original=JSON.stringify({mainsequence_path:root,provider:{key:'fixture-only'},accessToken:'fixture-session'});
  await fs.writeFile(configPath,original);
  const actions=createClaudeProjectActions({host:createNodeHost(),configPath,env:{}});
  const result=await actions.dispatch({action:'workspace-preferences'});
  assert.deepEqual(result.data,{backend:'https://api.main-sequence.app',baseDir:root});
  assert.equal(await fs.readFile(configPath,'utf8'),original);
  assert.doesNotMatch(JSON.stringify(result),/fixture-only|fixture-session/);
  await fs.writeFile(configPath,JSON.stringify({mainsequence_path:'relative-path'}));
  assert.equal(path.isAbsolute((await actions.dispatch({action:'workspace-preferences'})).data.baseDir),true);
});
