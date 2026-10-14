import { test, expect, mock } from 'claude-code/testing';

test('Desktop pane renders native controls and dispatches a confirmed structured action', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 });
  mock.store(on);
  mock.env(on, {});
  const requests = [];
  on('session.cwd', () => ({ value: '/fixture/project' }));
  on('session.id', () => ({ value: 'desktop-test-session' }));
  on('session.version', () => ({ value: { version: '2.1.295' } }));
  on('session.start', ($, e) => ({ cwd: e.cwd }));
  on('command.register', () => ({ value: { command: 'ms' } }));
  on('process.spawn', async function* ($, e, next) {
    const envelope = JSON.parse(e.input);
    requests.push(envelope.request);
    yield { stream: 'stdout', text: JSON.stringify({ type: 'result', id: envelope.id,
      result: { schemaVersion: 1, action: envelope.request.request.action, status: 'success', summary: 'Fixture operation completed', data: {} } }) + '\n' };
    return { value: { code: 0, signal: null } };
  });
  await $.session.start({ cwd: '/fixture/project', surface: 'desktop', isInteractive: true });
  const ui = await $.ui.mount({ plugin: 'mainsequence', surface: 'desktop', component: 'Pane', requestId: 'mainsequence', props: {} });
  expect(await ui.find({ key: 'tab-Connection' })).toBeDefined();
  await ui.input({ key: 'field-backend', text: 'https://fixture.example' });
  await ui.press({ key: 'auth-status' });
  await clock.settle();
  expect(requests).toContainEqual({ scope: 'devtools', request: { action: 'auth-status', backend: 'https://fixture.example', check: true } });
  expect(await ui.find({ type: 'Text', text: 'Fixture operation completed' })).toBeDefined();
  await ui.press({ key: 'tab-Current-Project' });
  await ui.press({ key: 'sync' });
  expect(requests.filter(value => value.request.action === 'sync')).toHaveLength(0);
  await ui.press({ key: 'confirm-action' });
  await clock.settle();
  expect(requests).toContainEqual({ scope: 'devtools', request: { action: 'sync', root: '/fixture/project', backend: 'https://fixture.example' } });
  await ui.press({ key: 'tab-Accounts' });
  expect(await ui.find({ key: 'account-five-hour-threshold' })).toBeDefined();
  for (const tab of ['Projects', 'MCP', 'Activity', 'Settings']) await ui.press({ key: `tab-${tab}` });
  await ui.unmount();
});

test('Desktop cancellation closes a waiting native process stream without waiting for its next chunk', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 });
  mock.store(on); mock.env(on, {});
  let closed = false;
  on('session.cwd', () => ({ value: '/fixture/project' }));
  on('session.id', () => ({ value: 'cancel-test' }));
  on('session.version', () => ({ value: { version: '2.1.295' } }));
  on('session.start', ($, e) => ({ cwd: e.cwd }));
  on('command.register', () => ({ value: { command: 'ms' } }));
  on('process.spawn', async function* ($, e, next) {
    try {
      yield { stream: 'stdout', text: JSON.stringify({ type: 'progress', message: 'Fixture waiting' }) + '\n' };
      await new Promise(resolve => next.signal.addEventListener('abort', resolve, { once: true }));
      return { value: { code: 0, signal: null } };
    } finally { closed = true; }
  });
  await $.session.start({ cwd: '/fixture/project', surface: 'desktop', isInteractive: true });
  const ui = await $.ui.mount({ plugin: 'mainsequence', surface: 'desktop', component: 'Pane', requestId: 'mainsequence', props: {} });
  await ui.press({ key: 'auth-status' });
  await clock.settle();
  await ui.press({ key: 'tab-Activity' });
  const cancel = await ui.find({ type: 'Button', text: 'Cancel operation' });
  expect(cancel, 'Cancel operation button exists').toBeDefined();
  await ui.press({ key: cancel.key });
  await clock.settle();
  expect(await ui.find({ type: 'Text', text: 'cancelled' }), 'Cancellation finishes before another process chunk arrives').toBeDefined();
  expect(closed).toBe(true);
  await ui.unmount();
});

test('account changes wait for main-turn completion; native StopFailure recovers without replay', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 }); mock.store(on); mock.env(on, {});
  const requests = [];
  let submitted = 0;
  let modelRequests = 0;
  let delayRecovery = false;
  let finishRecovery;
  on('session.cwd', () => ({ value: '/fixture/project' }));
  on('session.id', () => ({ value: 'recovery-test' }));
  on('session.version', () => ({ value: { version: '2.1.295' } }));
  on('session.start', ($, e) => ({ cwd: e.cwd }));
  on('command.register', () => ({ value: { command: 'ms' } }));
  on('env.set', () => ({ value: undefined }));
  on('fs.read', () => ({ value: JSON.stringify({ claudeAiOauth: { accessToken: 'fixture-only', expiresAt: 1000000 } }) }));
  on('ui.toast', () => ({ value: undefined }));
  on('classic.StopFailure', () => ({}));
  on('turn.start', ($, e) => ({ turnId: e.turnId }));
  on('turn.complete', ($, e) => ({ text: e.answer }));
  on('session.measure', ($, e) => ({ changed: e.changed }));
  on('turn.step', async function* ($, e) { modelRequests++; return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }; });
  on('prompt.submit', () => { submitted++; return { text: 'unexpected' }; });
  on('process.spawn', async function* ($, e) {
    const envelope = JSON.parse(e.input), action = envelope.request.request.action;
    requests.push(envelope.request);
    if (action === 'recover' && delayRecovery) await new Promise(resolve => { finishRecovery = resolve; });
    const data = { accounts: [{ id: 'fixture-account', label: 'Fixture', health: 'ready' }], config: { mode: 'automatic' },
      ...(action === 'select' ? { projection: { accountId: 'fixture-account', generation: 'fixture-generation', slot: '/fixture/slot', credential: { kind: 'file', path: '/fixture/credentials' } } } : {}) };
    yield { stream: 'stdout', text: JSON.stringify({ type: 'result', id: envelope.id, result: { schemaVersion: 1, action, status: 'success', summary: 'Fixture complete', data } }) + '\n' };
    return { value: { code: 0, signal: null } };
  });
  await $.session.start({ cwd: '/fixture/project', surface: 'desktop', isInteractive: true });
  const ui = await $.ui.mount({ plugin: 'mainsequence', surface: 'desktop', component: 'Pane', requestId: 'mainsequence', props: {} });
  await ui.press({ key: 'tab-Accounts' }); await ui.press({ key: 'account-list' }); await clock.settle();
  await ui.select({ key: 'account-choice', value: 'fixture-account' });
  await ui.press({ key: 'account-use' }); await ui.press({ key: 'confirm-action' }); await clock.settle();
  expect(await ui.find({ type: 'Text', text: 'request identity unverified' })).toBeDefined();
  await $.turn.start({ turnId: 'main-1', text: 'fixture turn' });
  const measurement = { changed: ['rateLimits'], context: { window: 200000 }, rateLimits: [] };
  await $.session.measure(measurement); await $.session.measure(measurement); await clock.settle();
  await ui.press({ key: 'account-rotate' }); await ui.press({ key: 'confirm-action' }); await clock.settle();
  expect(requests.filter(value => ['refresh', 'rotate'].includes(value.request.action))).toHaveLength(0);
  await $.turn.complete({ turnId: 'agent-1', agentId: 'agent-1', answer: '', reason: 'answer', durationMs: 1, isAborted: false });
  await clock.settle(); expect(requests.filter(value => value.request.action === 'refresh')).toHaveLength(0);
  await $.turn.complete({ turnId: 'main-1', answer: '', reason: 'answer', durationMs: 2, isAborted: false });
  await clock.settle(); expect(requests.filter(value => value.request.action === 'refresh')).toHaveLength(1);
  await $.turn.start({ turnId: 'main-2', text: 'fixture failure' });
  await $.classic.StopFailure({ hook_event_name: 'StopFailure', session_id: 'recovery-test', transcript_path: '/fixture/transcript', cwd: '/fixture/project', error: 'authentication_failed' });
  await clock.settle(); expect(requests.filter(value => value.request.action === 'recover')).toHaveLength(0);
  await $.turn.complete({ turnId: 'main-2', answer: '', reason: 'error', durationMs: 2, isAborted: false });
  await clock.settle();
  expect(requests).toContainEqual({ scope: 'accounts', request: { action: 'recover', sessionId: 'recovery-test', accountId: 'fixture-account', failure: 'authentication_failed' } });
  expect(submitted).toBe(0);
  delayRecovery = true;
  await $.classic.StopFailure({ hook_event_name: 'StopFailure', session_id: 'recovery-test', transcript_path: '/fixture/transcript', cwd: '/fixture/project', error: 'rate_limit' });
  await clock.settle();
  const blockedStep = $.turn.step({ turnId: 'autonomous', index: 0, model: 'fixture-model', messageCount: 1 });
  for await (const chunk of blockedStep) { /* No model stream is expected while projection is unresolved. */ }
  expect(modelRequests).toBe(0);
  finishRecovery(); await clock.settle();
  const allowedStep = $.turn.step({ turnId: 'autonomous', index: 1, model: 'fixture-model', messageCount: 1 });
  for await (const chunk of allowedStep) { /* The stub records normal model dispatch without network. */ }
  expect(modelRequests).toBe(1);
  const backgroundStep = $.turn.step({ turnId: 'background-turn', agentId: 'background-agent', index: 0, model: 'fixture-model', messageCount: 1 });
  for await (const chunk of backgroundStep) { /* The subagent stays active until its own turn.complete. */ }
  await $.session.measure(measurement); await clock.settle();
  expect(requests.filter(value => value.request.action === 'refresh')).toHaveLength(1);
  await ui.press({ key: 'account-rotate' }); await ui.press({ key: 'confirm-action' }); await clock.settle();
  expect(requests.filter(value => value.request.action === 'rotate')).toHaveLength(0);
  await $.turn.complete({ turnId: 'background-turn', agentId: 'background-agent', answer: '', reason: 'answer', durationMs: 2, isAborted: false });
  await clock.settle(); expect(requests.filter(value => value.request.action === 'refresh')).toHaveLength(2);
  await ui.unmount();
});
