const test=require('node:test'),assert=require('node:assert/strict');
const {createNodeHost,createSessionService,RepositoryClient}=require('../claude/dist/vendor/devtools');
test('packaged repository client accepts the canonical empty deploy-key success without replay',async()=>{
 const calls=[],backend='https://fixture.example';let mode='empty';
 const session=createSessionService(createNodeHost(),{store:null,env:{MAINSEQUENCE_ENDPOINT:backend,MAINSEQUENCE_ACCESS_TOKEN:'fixture-access'},fetch:async(url,init)=>{calls.push({path:new URL(url).pathname,method:init.method});return new Response(mode==='invalid'?'not JSON':null,{status:mode==='error'?502:200});}});
 const client=new RepositoryClient(session,backend);
 await client.addCodeRepositoryDeployKey('repo','fixture','ssh-ed25519 fixture-public');
 assert.equal(calls.length,1);assert.equal(calls[0].method,'POST');
 await assert.rejects(client.getCodeRepositories(),error=>error.code==='API_ERROR','empty directory reads remain errors');
 mode='invalid';await assert.rejects(client.addCodeRepositoryDeployKey('repo','fixture','ssh-ed25519 fixture-public'),error=>error.code==='API_ERROR');
 mode='error';await assert.rejects(client.addCodeRepositoryDeployKey('repo','fixture','ssh-ed25519 fixture-public'),error=>error.code==='API_ERROR');
 assert.equal(calls.length,4,'failed writes are never automatically replayed');
});
