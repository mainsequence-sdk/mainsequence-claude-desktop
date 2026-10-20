const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const { createNodeHost } = require('@dev-mainsequence/devtools');
const { createClaudeProjectActions } = require('../dist/hosts/claudeProjectActions.js');

test('opening a prepared Claude workspace validates both memberships and their current branches', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-org-project-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const container = await fs.realpath(temp), root = path.join(container, 'Ontology');await fs.mkdir(root);
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const repositories = [];
  for (const [i,name] of ['Ontology','OntologyBackend'].entries()) {
    const repo=path.join(container,'repositories',name);await fs.mkdir(repo,{recursive:true});
    cp.execFileSync('git',['init','-b','main'],{cwd:repo,stdio:'ignore'});
    repositories.push({repositoryUid:id(i+10),branchUid:id(i+20),name,branch:'main',path:repo});
  }
  const manifest = {schemaVersion:2,status:'ready',backend:'https://fixture.example',projectUid:id(1),environmentUid:id(2),root,name:'Ontology',repositories};
  for(const dir of [container,root])await fs.writeFile(path.join(dir,'.mainsequence-project.json'),JSON.stringify(manifest));
  const opened=[],host={...createNodeHost(),openBrowser:async url=>{opened.push(url);return true;}},actions=createClaudeProjectActions({host});
  const request={action:'open-project-workspace',root,backend:manifest.backend,projectUid:id(1),environmentUid:id(2)};
  const read=await actions.dispatch({...request,action:'read-project-workspace'});assert.equal(read.status,'success',JSON.stringify(read));assert.equal(read.data.repositories.length,2);assert.equal(opened.length,0);
  assert.equal((await actions.dispatch(request)).status,'success');
  const url=new URL(opened[0]);assert.equal(url.searchParams.get('folder'),root);assert.equal(path.basename(root),'Ontology');assert.equal(url.searchParams.has('q'),false);
  assert.equal((await actions.dispatch({...request,projectUid:id(9)})).status,'failure');assert.equal(opened.length,1);
  cp.execFileSync('git',['symbolic-ref','HEAD','refs/heads/wrong'],{cwd:repositories[1].path});
  const wrongBranch=await actions.dispatch(request);assert.equal(wrongBranch.status,'failure');assert.match(wrongBranch.summary,/OntologyBackend.*main/);assert.equal(opened.length,1);
});
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
