const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const environmentUid = id(1), branchUid = id(2), workflowUid = id(10), deploymentUid = id(11), ownedUid = id(12), hiddenUid = id(13), stageUid = id(20);
const token = 'fixture-platform-token';

/** Recorded-style platform rows: a workflow run, a stand-alone deployment run with billing, and logs. */
const workflowRow = { kind: 'workflow_run', uid: workflowUid, workflow_path: '.mainsequence/workflows/crm-api.yaml', commit_sha: '3e3f54ba7c3edbb86fbc9a3854f2f6457025f849',
  state: 'running', reason: '', creation_date: '2026-10-21T07:59:51.749491Z', finished_at: null,
  steps: [
    { step_key: 'image', operation: 'prepare_image', resource_key: 'crm', state: 'succeeded', reason: '', finished_at: '2026-10-21T08:05:08.808356Z', job_run_uid: null, deployment_run_uid: ownedUid, needs: [], image_from: null, dispatch_authorized_at: '2026-10-21T08:02:39.569920Z', dispatch_started_at: null, error: null },
    { step_key: 'migrate', operation: 'run_job', resource_key: 'migrate-crm', state: 'running', reason: '', finished_at: null, job_run_uid: id(30), deployment_run_uid: null, needs: ['image'], image_from: 'image', dispatch_authorized_at: '2026-10-21T08:05:09.000000Z', dispatch_started_at: '2026-10-21T08:05:10.000000Z', error: null },
    { step_key: 'deploy_api', operation: 'deploy', resource_key: 'crm', state: 'pending', reason: '', finished_at: null, job_run_uid: null, deployment_run_uid: ownedUid, needs: ['migrate'], image_from: 'image', dispatch_authorized_at: null, dispatch_started_at: null, error: { code: 'not_granted', detail: 'The workflow may not deploy crm.' } },
  ],
  code_repository_uid: id(3), code_repository_name: 'MainSequenceCRMAPI', code_repository_branch_uid: branchUid, repository_branch: 'main',
  deployment_runs: [{ uid: ownedUid, target_type: 'resource_release', target_label: 'FastAPI', state: 'queued', created_at: '2026-10-21T08:02:08.286827Z', started_at: '2026-10-21T08:02:08.314019Z', finished_at: null, workflow_step_keys: ['image', 'deploy_api'] }] };
const deploymentRow = { kind: 'deployment_run', uid: deploymentUid, target_type: 'job',
  target: { uid: id(4), name: 'MetaTables security check', display_name: 'MetaTables security check', type: 'job', code_repository: { uid: id(5), name: 'MetaTables' }, code_repository_branch: { uid: id(6), repository_branch: 'main' }, revision: { commit_sha: '36a7af5f4f4954421661e27e75d94f06f961dd9d' } },
  code_repository_branch_uid: id(6), operation: 'build_and_deploy', source: 'repository_event', commit_sha: '36a7af5f4f4954421661e27e75d94f06f961dd9d', state: 'succeeded', outcome: 'runtime_image_ready',
  pipeline: { key: 'job.runtime_image.deploy', version: 1, current_step_key: null, steps: [
    { uid: id(21), sequence: 2, key: 'build_code_repository_image', name: 'Build repository image', kind: 'image_build', required: true, state: 'succeeded', outcome: 'completed', artifact_context: {}, started_at: '2026-10-20T14:16:13.100018Z', finished_at: '2026-10-20T14:20:07.954126Z', error: null },
    { uid: stageUid, sequence: 1, key: 'resolve_revision', name: 'Resolve repository revision', kind: 'source', required: true, state: 'succeeded', outcome: 'completed', artifact_context: {}, started_at: '2026-10-20T14:16:07.423698Z', finished_at: '2026-10-20T14:16:13.100018Z', error: null },
    { uid: id(22), sequence: 3, key: 'verify_image', name: 'Verify repository image', kind: 'validation', required: true, state: 'skipped', outcome: 'skipped', reason: 'image_reused', artifact_context: {}, started_at: null, finished_at: null, error: null },
  ] },
  created_at: '2026-10-20T14:16:04.484983Z', started_at: null, finished_at: '2026-10-20T14:20:10.679287Z', revision_context: { secret: 'private' }, trigger_context: {},
  logs: { state: 'available', url: `/api/v1/deployment-runs/${deploymentUid}/logs/`, retention_expires_at: null }, error: null,
  billing: { scope: 'image_lifecycle', total_cost: 12.5, currency: 'USD', pricing_state: 'priced' }, runtime_billing: { total_cost: 3, currency: 'USD' }, cost_summary: { total_cost: 15.5, currency: 'USD', is_complete: true },
  workflow_run: workflowRow, workflow_step_keys: ['deploy_api'] };
const logRows = [
  { sequence: 3, timestamp: '2026-10-20T14:16:07.668034Z', step_uid: stageUid, source: 'orchestrator', stream: 'stdout', level: 'info', text: 'Resolving deployment revision.', revision_context: { images: [{ uri: 'registry.example/private' }] } },
  { sequence: 4, timestamp: null, step_uid: stageUid, source: 'orchestrator', stream: 'stderr', level: 'warning', text: 'Reusing the previous image.\u0007' },
];

test('packaged Claude worker reads deployment history, one run with its workflow, logs by cursor, and hidden runs without billing fields', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-deployments-contract-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), authorization: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== `Bearer ${token}`) return res.writeHead(401).end('{}');
    if (url.pathname === '/api/v1/deployment-history/') {
      assert.equal(url.searchParams.get('organization_environment_uid'), environmentUid);
      const branch = url.searchParams.get('code_repository_branch_uid');
      const results = branch ? (branch === branchUid ? [workflowRow] : []) : [workflowRow, deploymentRow];
      return res.end(JSON.stringify({ count: results.length, next: null, previous: null, results }));
    }
    if (url.pathname === `/api/v1/deployment-history/${workflowUid}/`) return res.end(JSON.stringify(workflowRow));
    if (url.pathname === `/api/v1/deployment-runs/${deploymentUid}/`) return res.end(JSON.stringify(url.searchParams.get('include') === 'workflow_run' ? deploymentRow : { ...deploymentRow, workflow_run: undefined }));
    if (url.pathname === `/api/v1/deployment-runs/${deploymentUid}/logs/`) {
      const cursor = url.searchParams.get('cursor');
      if (cursor === 'page-two:abc') return res.end(JSON.stringify({ run_uid: deploymentUid, start_time: null, end_time: null, entries: [logRows[1]], next_cursor: null, complete: true, retention_expires_at: null }));
      return res.end(JSON.stringify({ run_uid: deploymentUid, start_time: null, end_time: null, entries: [logRows[0]], next_cursor: 'page-two:abc', complete: false, retention_expires_at: null }));
    }
    // A run the reader may not see, and a history read of a workflow-owned run, both answer 404.
    res.writeHead(404).end(JSON.stringify({ detail: 'Not found.' }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const backend = `http://127.0.0.1:${server.address().port}`;
  const packageRoot = path.resolve(__dirname, '../claude');
  async function run(action, extra = {}) {
    const envelope = { protocolVersion: 1, id: 'deployments-contract', request: { scope: 'projects', request: { action, backend, ...extra } } };
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(packageRoot, 'dist/claudeRunner.js')], { cwd: dir, env: { PATH: process.env.PATH, MAINSEQUENCE_ENDPOINT: backend, MAINSEQUENCE_ACCESS_TOKEN: token }, stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 });
      let output = '';
      child.stdout.on('data', bytes => { output += bytes; }); child.stderr.resume();
      child.on('error', reject);
      child.on('close', code => {
        try {
          assert.equal(code, 0, 'packaged worker exited successfully');
          const result = output.trim().split('\n').map(line => JSON.parse(line)).find(message => message.type === 'result' && message.id === envelope.id)?.result;
          assert.ok(result, 'correlated result');
          assert.doesNotMatch(output, /fixture-platform-token|billing|total_cost|cost_summary|revision_context|registry\.example/, 'credentials, billing and private context never reach the pane');
          resolve(result);
        } catch (error) { reject(error); }
      });
      child.stdin.end(JSON.stringify(envelope));
    });
  }

  const history = await run('deployment-history', { environmentUid });
  assert.equal(history.status, 'success', history.summary);
  assert.equal(history.data.count, 2); assert.equal(history.data.limit, 25); assert.equal(history.data.offset, 0);
  assert.deepEqual(history.data.results.map(entry => [entry.kind, entry.state]), [['workflow_run', 'running'], ['deployment_run', 'succeeded']]);
  const workflow = history.data.results[0];
  assert.equal(workflow.repositoryName, 'MainSequenceCRMAPI'); assert.equal(workflow.branchName, 'main'); assert.equal(workflow.branchUid, branchUid); assert.equal(workflow.commit, '3e3f54b');
  assert.deepEqual(workflow.steps.map(step => [step.id, step.state, step.needs, step.deploymentRunUid]), [['image', 'succeeded', [], ownedUid], ['migrate', 'running', ['image'], null], ['deploy_api', 'pending', ['migrate'], ownedUid]]);
  assert.equal(workflow.steps[0].startedAt, '2026-10-21T08:02:39.569Z', 'prepare_image is timed from its authorization'); assert.equal(workflow.steps[0].durationMs, Date.parse('2026-10-21T08:05:08.808Z') - Date.parse('2026-10-21T08:02:39.569Z'));
  assert.ok(workflow.steps[1].durationMs > 0, 'a running step is timed to now'); assert.equal(workflow.steps[2].error, 'not_granted: The workflow may not deploy crm.');
  assert.deepEqual(workflow.deploymentRuns, [{ uid: ownedUid, targetLabel: 'FastAPI', targetType: 'resource_release', state: 'queued', workflowStepKeys: ['image', 'deploy_api'], createdAt: '2026-10-21T08:02:08.286Z', startedAt: '2026-10-21T08:02:08.314Z', finishedAt: null }]);
  const deployment = history.data.results[1];
  assert.equal(deployment.targetLabel, 'MetaTables security check'); assert.equal(deployment.repositoryName, 'MetaTables'); assert.equal(deployment.branchUid, id(6)); assert.equal(deployment.commit, '36a7af5');
  assert.deepEqual(deployment.steps.map(step => [step.sequence, step.key, step.state, step.reason]), [[1, 'resolve_revision', 'succeeded', ''], [2, 'build_code_repository_image', 'succeeded', ''], [3, 'verify_image', 'skipped', 'image_reused']], 'stages in sequence order with skip reasons');
  assert.equal(deployment.startedAt, '2026-10-20T14:16:07.423Z', 'a run without started_at starts with its first stage'); assert.equal(deployment.durationMs, Date.parse('2026-10-20T14:20:10.679Z') - Date.parse('2026-10-20T14:16:07.423Z'));
  assert.equal(Object.hasOwn(deployment, 'billing'), false); assert.equal(Object.hasOwn(deployment, 'workflowRun'), true);
  const filtered = await run('deployment-history', { environmentUid, codeRepositoryBranchUid: branchUid, limit: 1 });
  assert.equal(filtered.data.count, 1); assert.equal(filtered.data.results[0].uid, workflowUid);
  assert.equal(requests.at(-1).query.code_repository_branch_uid, branchUid); assert.equal(requests.at(-1).query.limit, '1');
  assert.equal((await run('deployment-history', { environmentUid, codeRepositoryBranchUid: id(9) })).data.count, 0);
  assert.equal((await run('deployment-history', { environmentUid, limit: 500 })).error.code, 'INVALID_REQUEST');
  assert.equal((await run('deployment-history', { environmentUid: 'production' })).error.code, 'INVALID_REQUEST');

  const read = await run('deployment-run', { runUid: deploymentUid });
  assert.equal(read.status, 'success', read.summary); assert.equal(read.data.hidden, false); assert.equal(read.data.kind, 'deployment_run');
  assert.equal(requests.at(-1).query.include, 'workflow_run'); assert.equal(read.data.run.workflowRun.uid, workflowUid); assert.deepEqual(read.data.run.workflowStepKeys, ['deploy_api']);
  assert.equal(read.data.run.logsAvailable, true); assert.equal(read.data.run.steps[0].uid, stageUid);
  const readWorkflow = await run('deployment-run', { runUid: workflowUid, kind: 'workflow_run' });
  assert.equal(readWorkflow.status, 'success'); assert.equal(readWorkflow.data.run.kind, 'workflow_run'); assert.equal(requests.at(-1).path, `/api/v1/deployment-history/${workflowUid}/`);
  const hidden = await run('deployment-run', { runUid: hiddenUid });
  assert.equal(hidden.status, 'success'); assert.equal(hidden.data.hidden, true); assert.equal(hidden.data.uid, hiddenUid);
  assert.equal(hidden.summary, "You can't see this deployment. A deployment is shown to the people who can see its release or Job.");
  assert.doesNotMatch(JSON.stringify(hidden), /not found|does not exist/i);
  assert.equal((await run('deployment-run', { runUid: ownedUid, kind: 'workflow_run' })).data.hidden, true, 'a workflow-owned run has no history entry');

  const logs = await run('deployment-logs', { runUid: deploymentUid, stepUid: stageUid, limit: 50 });
  assert.equal(logs.status, 'success', logs.summary); assert.equal(requests.at(-1).query.step_uid, stageUid); assert.equal(requests.at(-1).query.limit, '50');
  assert.deepEqual(logs.data.entries, [{ sequence: 3, timestamp: '2026-10-20T14:16:07.668Z', stepUid: stageUid, source: 'orchestrator', stream: 'stdout', level: 'info', text: 'Resolving deployment revision.' }]);
  assert.equal(logs.data.nextCursor, 'page-two:abc'); assert.equal(logs.data.complete, false); assert.equal(logs.data.stepUid, stageUid);
  const next = await run('deployment-logs', { runUid: deploymentUid, cursor: logs.data.nextCursor });
  assert.equal(requests.at(-1).query.cursor, 'page-two:abc'); assert.equal(requests.at(-1).query.step_uid, undefined);
  assert.deepEqual(next.data.entries.map(entry => [entry.timestamp, entry.text]), [[null, 'Reusing the previous image.']], 'control characters are stripped and a missing timestamp stays null');
  assert.equal(next.data.complete, true); assert.equal(next.data.nextCursor, null);
  assert.equal((await run('deployment-logs', { runUid: hiddenUid })).data.hidden, true);
  assert.equal((await run('deployment-logs', { runUid: deploymentUid, limit: 201 })).error.code, 'INVALID_REQUEST');
  assert.equal((await run('deployment-logs', { runUid: deploymentUid, cursor: 'bad cursor/with spaces' })).error.code, 'INVALID_REQUEST');
  assert.ok(requests.every(request => request.authorization === `Bearer ${token}`));
});
