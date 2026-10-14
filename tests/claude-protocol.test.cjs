const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { parseClaudeEnvelope, executeClaudeEnvelope } = require('../dist/hosts/claudeProtocol');

const envelope = (scope, request) => ({ protocolVersion: 1, id: 'test-1', request: { scope, request } });
test('Desktop worker routes structured actions without interpreting shell or model text', async () => {
  const seen = [];
  const handlers = Object.fromEntries(['devtools', 'projects', 'accounts'].map(scope => [scope, async request => {
    seen.push({ scope, request });
    return { schemaVersion: 1, action: request.action, status: 'success', summary: scope };
  }]));
  for (const scope of Object.keys(handlers)) {
    const request = { action: 'list', label: 'literal $(touch bad); `echo bad`' };
    assert.equal((await executeClaudeEnvelope(envelope(scope, request), handlers)).summary, scope);
    assert.deepEqual(seen.at(-1), { scope, request });
  }
});
test('invalid Desktop protocol cannot reach a handler', async () => {
  const dispatch = async () => assert.fail('invalid request dispatched');
  const handlers = { devtools: dispatch, projects: dispatch, accounts: dispatch };
  for (const input of [null, [], {}, { ...envelope('devtools', { action: 'status' }), protocolVersion: 2 },
    envelope('shell', { action: 'exec' }), envelope('devtools', { action: 'rm -rf' }),
    { ...envelope('accounts', { action: 'list' }), id: 'line\nbreak' },
    { ...envelope('devtools', { action: 'status' }), env: { TOKEN: 'not-a-supported-field' } }]) {
    assert.throws(() => parseClaudeEnvelope(input));
    assert.equal((await executeClaudeEnvelope(input, handlers)).error.code, 'INVALID_REQUEST');
  }
});
test('worker reads stdin and returns a correlated diagnostics result without authentication', () => {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../dist/claudeRunner.js')], {
    input: JSON.stringify(envelope('projects', { action: 'runtime-diagnostics' })), encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const message = JSON.parse(result.stdout.trim());
  assert.equal(message.id, 'test-1');
  assert.equal(message.type, 'result');
  assert.equal(message.result.status, 'success');
  assert.equal(message.result.data.bundleHealth.compiledEntry, true);
  assert.equal(message.result.data.capabilities.signedTerminal, false);
});
test('worker rejects malformed and oversized input without echoing it', () => {
  for (const input of ['secret-malformed-fixture', 'x'.repeat(1_000_001)]) {
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../dist/claudeRunner.js')], { input, encoding: 'utf8', timeout: 10_000 });
    const message = JSON.parse(result.stdout.trim());
    assert.equal(message.result.status, 'failure');
    assert.equal(message.result.error.code, 'INVALID_REQUEST');
    assert.ok(!result.stdout.includes('secret-malformed-fixture'));
  }
});
