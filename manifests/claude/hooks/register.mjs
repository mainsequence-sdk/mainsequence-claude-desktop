import { PANE, initialState, meetsVersion, clean, record, rows, request, actionOptions, fail, publicValue } from './model.mjs';
import { renderPane, renderBand } from './view.mjs';

const sessionActions = new Set(['login', 'logout', 'refresh-token', 'auth-status', 'repositories']);
const update = ($) => $.ui.invalidate('ui.render');
const activeTurn = state => Boolean(state.mainTurnId || state.agentTurns?.size);

async function execute($, state, domain, quiet = false) {
  const action = domain.request.action;
  if (!state.ready || state.closed) return fail(action, state.problem || 'This session is not ready.', 'UNSUPPORTED_ACTION');
  if (state.running.size >= 8) return fail(action, 'Wait for a running operation to finish.', 'PROJECT_BUSY');
  const id = `${state.sessionId}-${++state.sequence}`;
  const op = { id, label: `${domain.scope} · ${action}`, status: 'running', progress: 'Starting…', cancelled: false };
  state.running.set(id, op);
  if (!quiet) { state.operations.push(op); state.operations = state.operations.filter((value, index, all) => value.status === 'running' || index >= all.length - 30); update($); }
  const envelope = { protocolVersion: 1, id, request: domain };
  let result = await runWorker($, state, envelope, op, message => { op.progress = message; if (!quiet) update($); });
  if (domain.scope === 'accounts' && result.status === 'success') {
    const data = record(result.data);
    state.accountData = publicValue(data);
    if (data.projection) {
      const prior = { reference: state.accountReference, selection: state.accountSelection, originalAuth: state.originalAuth,
        token: await $.env.get('CLAUDE_CODE_OAUTH_TOKEN'), slot: await $.env.get('CLAUDE_SECURESTORAGE_CONFIG_DIR') };
      try {
        await projectAccount($, state, data.projection);
        const confirmation = await runWorker($, state, { protocolVersion: 1, id: `${id}-confirm`, request: request('accounts', 'confirm', {
          sessionId: state.sessionId, generation: data.projection.generation,
        }) }, {}, () => {});
        if (confirmation.status !== 'success') throw new Error('Could not confirm account lease');
        state.accountData = publicValue(confirmation.data);
      } catch {
        // Transitions are serialized. Restore precisely the prior account, never a newer choice.
        try {
          await $.env.set('CLAUDE_SECURESTORAGE_CONFIG_DIR', prior.slot);
          await $.env.set('CLAUDE_CODE_OAUTH_TOKEN', prior.token);
        } catch { state.accountBlocked = true; }
        state.accountReference = prior.reference; state.accountSelection = prior.selection;
        state.originalAuth = prior.originalAuth || (state.accountBlocked ? { token: prior.token, slot: prior.slot } : null);
        const rolledBack = await runWorker($, state, { protocolVersion: 1, id: `${id}-rollback`, request: request('accounts', 'cancel-switch', {
          sessionId: state.sessionId, generation: data.projection.generation,
        }) }, {}, () => {}).catch(() => {});
        if (rolledBack?.status === 'success') state.accountData = publicValue(rolledBack.data);
        result = fail(action, 'The stored login could not be applied to this session. Sign in again or restore Desktop sign-in.', 'AUTH_REJECTED');
      }
    }
  }
  // A projection is a private reference, and never part of transcript, activity, or tool results.
  const publicResult = publicValue(result);
  op.status = publicResult.status; op.progress = publicResult.summary; op.result = publicResult;
  state.running.delete(id);
  state.results[`${domain.scope}.${action}`] = publicResult;
  if (!quiet) update($);
  return result;
}

function devRequest(state, action, extra = {}) {
  const f = state.fields;
  const common = actionOptions(state);
  if (sessionActions.has(action)) { delete common.root; delete common.projectType; }
  if (action === 'setup') return request('devtools', action, { ...(f.backend.trim() ? { backend: f.backend.trim() } : {}), repositoryUid: f.repositoryUid,
    branch: f.branch, baseDir: f.baseDir, ...extra });
  if (action.startsWith('mcp-')) {
    const values = { ...(f.backend.trim() ? { backend: f.backend.trim() } : {}) };
    if (['mcp-add', 'mcp-remove', 'mcp-tools', 'mcp-call'].includes(action)) values.releaseUid = state.selectedMcp;
    if (action === 'mcp-discover') Object.assign(values, { search: f.mcpSearch, limit: 25, offset: 0 });
    if (action === 'mcp-call') {
      const args = JSON.parse(f.mcpArguments);
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Arguments must be a JSON object.');
      Object.assign(values, { tool: f.mcpTool, arguments: args });
    }
    return request('devtools', action, { ...values, ...extra });
  }
  return request('devtools', action, { ...common, ...extra });
}

async function runDev($, state, action, extra = {}) {
  let domain;
  try { domain = devRequest(state, action, extra); }
  catch { $.ui.toast('Enter valid JSON object arguments before calling the tool.'); return; }
  if (action === 'mcp-discover') state.mcpOffset = domain.request.offset;
  const result = await execute($, state, domain);
  if (result.status === 'success' && ['mcp-add', 'mcp-remove'].includes(action)) await refreshTools($, state);
  if (result.status === 'success' && ['login', 'logout', 'refresh-token'].includes(action)) await execute($, state, devRequest(state, 'auth-status', { check: true }), true);
  if (result.status === 'success' && !extra.dryRun && ['sync', 'install', 'update-sdk', 'update-agents', 'install-skills', 'skills-sync', 'env-cleanup'].includes(action)) {
    await execute($, state, devRequest(state, 'status'), true);
    if (action === 'update-sdk' || action === 'install') await execute($, state, devRequest(state, 'sdk-status'), true);
  }
  if (result.status === 'success' && action === 'setup') await runProject($, state, 'local-repositories');
  update($);
  return result;
}

async function runProject($, state, action, extra = {}) {
  const f = state.fields;
  const values = { root: action.startsWith('delete-local') ? state.selectedLocal : f.root || state.cwd,
    baseDir: f.baseDir, organization: f.organization, ...(f.image ? { image: f.image } : {}), ...(f.platform ? { platform: f.platform } : {}), ...extra };
  const destination = values.destination; delete values.destination;
  if (action === 'pick-folder') values.initialPath = f[destination] || state.cwd;
  if (action === 'local-repositories') values.repositories = rows(state.results['devtools.repositories']?.data).map(row => ({ uid: row.uid, name: row.code_repository_name || row.name }));
  const result = await execute($, state, request('projects', action, values));
  if (result.status !== 'success') return result;
  const data = record(result.data);
  if (action === 'pick-folder' && typeof data.path === 'string' && ['root', 'baseDir'].includes(destination)) {
    state.fields[destination] = data.path;
    if (destination === 'root') { delete state.results['devtools.status']; delete state.results['devtools.sdk-status']; }
  }
  if (action === 'delete-local-preview') state.confirmation = { title: 'Permanently delete local repository', detail: `${data.root}\n${data.warning || ''}`,
    callback: () => runProject($, state, 'delete-local', { ...values, confirmation: data.confirmation }) };
  if (action === 'docker-preview') state.confirmation = { title: 'Build Docker image', detail: `${data.root}\n${(data.args || []).join(' ')}`,
    callback: () => runProject($, state, 'docker-build', values) };
  if (action === 'devcontainer-preview') state.confirmation = { title: 'Write container configuration', detail: `${data.path}\nBefore:\n${data.before || '(absent)'}\nAfter:\n${data.after}`,
    callback: () => runProject($, state, 'devcontainer-write', { ...values, expectedDigest: data.expectedDigest }) };
  if (action === 'delete-local') { state.selectedLocal = ''; await runProject($, state, 'local-repositories'); }
  update($);
  return result;
}

async function runAccount($, state, action, extra = {}, quiet = false) {
  if (!state.accountsReady) return fail(action, 'Account APIs are unavailable in this session.', 'UNSUPPORTED_ACTION');
  const values = { sessionId: state.sessionId,
    ...(!['list', 'add', 'rotate', 'configure', 'refresh', 'release'].includes(action) && state.selectedAccount ? { accountId: state.selectedAccount } : {}),
    ...(action === 'add' && state.fields.accountLabel ? { label: state.fields.accountLabel } : {}), ...extra };
  const changesIdentity = ['select', 'rotate', 'refresh', 'release', 'recover'].includes(action);
  const work = async () => {
    if (changesIdentity && activeTurn(state)) {
      const result = fail(action, 'Wait for the current Claude turn to finish before changing its request account.', 'PROJECT_BUSY');
      state.results[`accounts.${action}`] = result; $.ui.toast(result.summary); return result;
    }
    if (!changesIdentity) return execute($, state, request('accounts', action, values), quiet);
    state.accountTransition = true;
    try { return await execute($, state, request('accounts', action, values), quiet); }
    finally { state.accountTransition = false; }
  };
  const result = await (changesIdentity ? queueAccount(state, work) : work());
  if (result.status === 'success' && action === 'configure') state.accountDraft = null;
  if (result.status === 'success' && action === 'add') {
    const added = rows(record(result.data).accounts).at(-1);
    if (added) state.selectedAccount = added.id;
  }
  update($);
  return result;
}

async function signInAll($, state) {
  if (state.signingInAll) return;
  state.signingInAll = true; update($);
  try {
    for (const account of rows(state.accountData?.accounts).filter(row => row.health === 'login-needed')) {
      const result = await runAccount($, state, 'login', { accountId: account.id });
      if (result.status !== 'success' || state.closed) break;
    }
  } finally { state.signingInAll = false; update($); }
}

function accountDraft(state) {
  if (!state.accountDraft) state.accountDraft = { ...record(state.accountData?.config), display: { ...record(state.accountData?.config?.display) } };
  return state.accountDraft;
}

async function saveAccountSettings($, state) {
  const config = accountDraft(state);
  const fiveHourThreshold = Number(config.fiveHourThreshold ?? 90), weeklyThreshold = Number(config.weeklyThreshold ?? 95);
  if (![fiveHourThreshold, weeklyThreshold].every(value => Number.isFinite(value) && value > 0 && value <= 100)) {
    $.ui.toast('Usage thresholds must be greater than 0 and no more than 100.'); return;
  }
  await runAccount($, state, 'configure', { config: { ...config, fiveHourThreshold, weeklyThreshold } });
}

function queueAccount(state, work) {
  const pending = state.accountQueue.then(work, work);
  state.accountQueue = pending.catch(() => undefined);
  return pending;
}

async function releaseAccount($, state) {
  return queueAccount(state, async () => {
    if (activeTurn(state)) { $.ui.toast('Wait for the current Claude turn to finish before restoring Desktop sign-in.'); return; }
    state.accountTransition = true;
    try {
      await restoreAccount($, state);
      await execute($, state, request('accounts', 'release', { sessionId: state.sessionId }));
    } finally { state.accountTransition = false; }
    update($);
  });
}

async function drainAutomaticAccountWork($, state) {
  if (activeTurn(state) || state.closed || !state.accountReference || state.accountData?.config?.mode !== 'automatic') return;
  const failure = state.pendingAccountFailure;
  const refresh = state.pendingAccountRefresh;
  state.pendingAccountFailure = null; state.pendingAccountRefresh = false;
  if (!failure && !refresh) return;
  const result = await runAccount($, state, failure ? 'recover' : 'refresh', failure ? { failure } : {}, !failure);
  if (result.error?.code === 'PROJECT_BUSY') {
    if (failure) state.pendingAccountFailure = failure; else state.pendingAccountRefresh = true;
  } else if (failure) $.ui.toast(result.status === 'success'
    ? 'An eligible account was prepared for your next request. Review the session state before submitting again; nothing was replayed.'
    : 'Automatic account recovery could not complete. Review Accounts and Activity.');
  update($);
}

function toolName(release, name) {
  const value = `${release}:${name}`;
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619) >>> 0;
  return `ms_${String(name).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 42)}_${hash.toString(16)}`;
}

async function refreshTools($, state) {
  const listed = await execute($, state, devRequest(state, 'mcp-list'), true);
  if (listed.status !== 'success') { state.results['mcp.registration'] = publicValue(listed); update($); return; }
  const next = {};
  const unavailable = [];
  for (const connection of rows(listed.data)) {
    const releaseUid = connection.resource_release_uid;
    const backend = connection.backend;
    const answer = await execute($, state, request('devtools', 'mcp-tools', { backend, releaseUid }), true);
    if (answer.status !== 'success') { unavailable.push(clean(connection.name)); continue; }
    for (const tool of rows(record(answer.data).tools).slice(0, 80)) {
      const name = toolName(releaseUid, tool.name);
      const full = `mcp__${$.plugin.name}__${name}`;
      next[full] = { backend, releaseUid, tool: tool.name };
      await $.tool.register({ name, description: clean(`MainSequence ${connection.name}: ${tool.description || tool.name}`), inputSchema: record(tool.inputSchema) });
    }
  }
  // Removed servers' previously registered names are refused by the handler below.
  state.mcpTools = next;
  state.results['mcp.registration'] = { schemaVersion: 1, action: 'mcp-registration', status: 'success',
    summary: `${Object.keys(next).length} MainSequence tools available from the next prompt.`, data: { unavailable } };
  update($);
}

function actionsFor($, state) {
  const background = work => { void Promise.resolve(work).catch(() => $.ui.toast('The action could not complete. Check Activity and diagnostics.')); };
  return {
    open: () => background($.ui.open({ id: PANE, title: 'MainSequence', focus: true })),
    tab: tab => { state.tab = tab; update($); },
    field: (key, value) => {
      if (Object.hasOwn(state.fields, key)) {
        state.fields[key] = String(value);
        if (key === 'repositoryUid') state.fields.branch = '';
        if (key === 'root' || key === 'projectType' || key === 'backend') { delete state.results['devtools.status']; delete state.results['devtools.sdk-status']; }
      }
      update($);
    },
    selectLocal: value => { state.selectedLocal = value; update($); },
    selectAccount: value => { state.selectedAccount = value; update($); },
    selectMcp: value => { state.selectedMcp = value; update($); },
    useLocal: () => { state.fields.root = state.selectedLocal; delete state.results['devtools.status']; delete state.results['devtools.sdk-status']; state.tab = 'Current Project'; update($); },
    dev: (action, extra) => background(runDev($, state, action, extra)),
    project: (action, extra) => background(runProject($, state, action, extra)),
    account: (action, extra) => background(runAccount($, state, action, extra)),
    signInAll: () => background(signInAll($, state)),
    accountSetting: (key, value) => { const draft = accountDraft(state); if (key.startsWith('display.')) draft.display[key.slice(8)] = value; else draft[key] = value; update($); },
    accountEligibility: id => { const draft = accountDraft(state); const ids = draft.eligibleAccountIds || rows(state.accountData?.accounts).map(row => row.id);
      draft.eligibleAccountIds = ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]; update($); },
    saveAccountSettings: () => background(saveAccountSettings($, state)),
    releaseAccount: () => background(releaseAccount($, state)),
    refreshTools: () => background(refreshTools($, state)),
    confirm: (title, detail, callback) => { state.confirmation = { title, detail, callback }; update($); },
    dismiss: () => { state.confirmation = null; update($); },
    accept: () => { const confirmation = state.confirmation; state.confirmation = null; update($); if (confirmation) background(confirmation.callback()); },
    cancel: id => { const op = state.operations.find(value => value.id === id); if (op?.cancel) { op.progress = 'Cancelling…'; background(op.cancel()); update($); } },
    saveSettings: () => background($.store.set('settings', { backend: state.fields.backend, baseDir: state.fields.baseDir,
      organization: state.fields.organization, nodePath: state.fields.nodePath, claudeExecutable: state.fields.claudeExecutable }).then(() => $.ui.toast('MainSequence settings saved.'))),
  };
}

async function boot($, state, e) {
  state.closed = false;
  state.cwd = await $.session.cwd(); state.fields.root = state.cwd;
  state.sessionId = await $.session.id();
  const version = await $.session.version();
  state.version = typeof version === 'string' ? version : version?.version || version?.full || '';
  // The loader validates every named API. Reading an API method as a value is forbidden.
  state.ready = meetsVersion(state.version, [2, 1, 286]);
  state.accountsReady = state.ready;
  state.problem = state.ready ? '' : 'Update Claude Desktop: this mod needs bundled Claude Code 2.1.286+ and streaming process support.';
  const saved = record(await $.store.get('settings'));
  for (const key of ['backend', 'baseDir', 'organization', 'nodePath', 'claudeExecutable']) if (typeof saved[key] === 'string') state.fields[key] = saved[key];
  await $.command.register({ name: 'ms', description: 'Open MainSequence developer tools', immediate: true });
  state.timers.push($.clock.every(60_000, () => {
    if (state.accountReference && !state.closed) void runAccount($, state, 'list', {}, true).catch(() => {});
  }));
  update($);
}

export function register(on, options = {}) {
  const state = initialState(options);
  on('session.start', async ($, e, next) => { await boot($, state, e); return next(e); });
  on('command.run', { command: 'ms' }, async ($) => { await $.ui.open({ id: PANE, title: 'MainSequence', focus: true }); return {}; });
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.hasSurvey) return next(e);
    return renderBand($.ui.resolve(e), state, actionsFor($, state), await next(e));
  });
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e);
    return renderPane($.ui.resolve(e), state, actionsFor($, state));
  });
  on('tool.call', { tool: /^mcp__mainsequence__/ }, async ($, e) => {
    const entry = state.mcpTools[e.tool];
    if (!entry) return { deny: 'This MainSequence MCP tool is no longer connected. Refresh MainSequence tools.' };
    const answer = await $.ui.ask(`Run MainSequence tool ${entry.tool}?`, ['Run tool', 'Cancel']);
    if (answer !== 'Run tool') return { deny: 'The user cancelled this MainSequence action.' };
    const { tool, tool_use_id, agentId, ...arguments_ } = e;
    const result = await execute($, state, request('devtools', 'mcp-call', { ...entry, arguments: arguments_ }));
    return { result: publicValue(result), ...(result.status !== 'success' ? { isError: true } : {}) };
  }).catch(() => ({ deny: 'MainSequence could not confirm or run this tool call.' }));
  on('prompt.submit', async ($, e, next) => {
    const valid = await queueAccount(state, async () => {
      if (state.accountBlocked) return false;
      if (!state.accountReference) return true;
      try { await projectAccount($, state, state.accountReference, true); return true; }
      catch { $.ui.toast('The selected Claude login needs renewal. Sign in again or deliberately use Desktop sign-in.'); return false; }
    });
    if (!valid) return { drop: 'The selected Claude account could not be renewed. This prompt was not sent.' };
    return next(e);
  }).catch(() => ({ drop: 'MainSequence could not verify the selected account. This prompt was not sent.' }));
  on('turn.start', async ($, e, next) => {
    state.mainTurnId = e.turnId; update($);
    return next(e);
  });
  on('turn.step', async function* ($, e, next) {
    if (state.accountTransition || state.accountBlocked) {
      try { $.ui.toast('The request account is changing or needs attention. No model request was sent; check Accounts before submitting again.'); } catch { /* Keep this boundary closed even when the host cannot display a notice. */ }
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null };
    }
    if (e.agentId) state.agentTurns.add(e.turnId);
    return yield* next(e);
  });
  on('turn.complete', async ($, e, next) => {
    if (e.agentId) state.agentTurns.delete(e.turnId);
    if (!e.agentId && (!state.mainTurnId || state.mainTurnId === e.turnId)) {
      state.mainTurnId = null;
    }
    void drainAutomaticAccountWork($, state).catch(() => {}); update($);
    return next(e);
  });
  on('session.measure', async ($, e, next) => {
    if (state.accountReference && state.accountData?.config?.mode === 'automatic' && e.changed?.includes('rateLimits')) {
      state.pendingAccountRefresh = true;
      void drainAutomaticAccountWork($, state).catch(() => {});
    }
    return next(e);
  });
  on('classic.StopFailure', async ($, e, next) => {
    if (state.accountReference && state.accountData?.config?.mode === 'automatic' && !e.agent_id
      && ['rate_limit', 'authentication_failed'].includes(e.error)) {
      state.pendingAccountFailure = e.error;
      void drainAutomaticAccountWork($, state).catch(() => {});
    }
    return next(e);
  });
  on('session.end', async ($, e, next) => {
    state.mainTurnId = null;
    state.agentTurns.clear();
    for (const op of state.running.values()) if (op.status === 'running' && op.cancel) void op.cancel().catch(() => {});
    for (const timer of state.timers) timer.cancel();
    await state.accountQueue;
    await restoreAccount($, state).catch(() => {});
    if (state.accountsReady) await runAccount($, state, 'release', {}, true).catch(() => {});
    state.closed = true;
    return next(e);
  });
}


/** The engine's streaming process API takes input, not stdin (verified in 2.1.295). */
export async function runWorker($, state, envelope, operation, onProgress) {
  const input = JSON.stringify(envelope);
  if (input.length > 1_000_000) return fail(envelope.request.request.action, 'The request is too large.', 'INVALID_REQUEST');
  let child;
  let timer;
  let pending = '';
  let bytes = 0;
  let answer;
  let invalid = false;
  let timedOut = false;
  try {
    child = $.process.spawn({ argv: [state.fields.nodePath, `${$.plugin.root}/dist/claudeRunner.js`], cwd: state.cwd, input,
      ...(state.fields.claudeExecutable ? { env: { MAINSEQUENCE_CLAUDE_EXECUTABLE: state.fields.claudeExecutable } } : {}) });
    operation.cancel = () => { operation.cancelled = true; return child.return({ code: null, signal: 'SIGTERM' }); };
    timer = $.clock.after(1_800_000, () => { timedOut = true; return child.return({ code: null, signal: 'SIGTERM' }); });
    for await (const chunk of child) {
      if (chunk.stream !== 'stdout') continue; // Child stderr is private and never rendered.
      bytes += chunk.text.length;
      if (bytes > 4_000_000) { invalid = true; break; }
      pending += chunk.text;
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch { invalid = true; break; }
        if (message.id !== undefined && message.id !== envelope.id) { invalid = true; break; }
        if (message.type === 'progress' && typeof message.message === 'string' && !answer) onProgress(clean(message.message));
        else if (message.type === 'result' && !answer && message.result?.schemaVersion === 1
          && ['success', 'failure', 'cancelled'].includes(message.result.status) && typeof message.result.summary === 'string') answer = message.result;
        else { invalid = true; break; }
      }
      if (invalid) break;
    }
    const exit = await child.result;
    if (answer && !invalid && !pending.trim() && exit.code === 0) return answer;
  } catch { /* Only a fixed error reaches the UI; exceptions can hold private child output. */ }
  finally { timer?.cancel(); operation.cancel = undefined; }
  const action = envelope.request.request.action;
  return operation.cancelled ? fail(action, 'The operation was cancelled.', 'CANCELLED', true)
    : timedOut ? fail(action, 'The operation timed out.', 'PROCESS_TIMEOUT', true)
    : fail(action, 'The MainSequence worker did not report a valid result. Check Node 22+ and the plugin installation.', 'PROCESS_FAILED', true);
}

/** A credential is read only into this call stack and projected into the engine environment. */
export async function projectAccount($, state, projection, reassert = false) {
  const ref = projection?.credential;
  if (!ref || typeof projection.slot !== 'string' || typeof projection.generation !== 'string') throw new Error('Invalid credential reference');
  let serialized;
  if (ref.kind === 'keychain' && typeof ref.service === 'string' && typeof ref.user === 'string') {
    const response = await $.process.run(['/usr/bin/security', 'find-generic-password', '-a', ref.user, '-w', '-s', ref.service], { timeoutMs: 10_000 });
    if (response.exitCode !== 0) throw new Error('Stored sign-in is unavailable');
    serialized = response.stdout;
  } else if (ref.kind === 'file' && typeof ref.path === 'string') serialized = await $.fs.read(ref.path);
  else throw new Error('Unsupported credential reference');
  const parsed = JSON.parse(serialized);
  const credential = parsed?.claudeAiOauth;
  if (typeof credential?.accessToken !== 'string' || !credential.accessToken || typeof credential.expiresAt !== 'number'
    || credential.expiresAt <= await $.clock.now() + 60_000) throw new Error('Stored sign-in needs renewal');
  if (!state.originalAuth) state.originalAuth = {
    token: await $.env.get('CLAUDE_CODE_OAUTH_TOKEN'), slot: await $.env.get('CLAUDE_SECURESTORAGE_CONFIG_DIR'),
  };
  // Keep both switches in the same callback. Failed projection restores the prior engine values.
  const beforeToken = await $.env.get('CLAUDE_CODE_OAUTH_TOKEN');
  const beforeSlot = await $.env.get('CLAUDE_SECURESTORAGE_CONFIG_DIR');
  if (!reassert && activeTurn(state)) throw new Error('Wait for the active turn to finish');
  try {
    await $.env.set('CLAUDE_SECURESTORAGE_CONFIG_DIR', projection.slot || undefined);
    await $.env.set('CLAUDE_CODE_OAUTH_TOKEN', credential.accessToken);
  } catch {
    await $.env.set('CLAUDE_SECURESTORAGE_CONFIG_DIR', beforeSlot);
    await $.env.set('CLAUDE_CODE_OAUTH_TOKEN', beforeToken);
    throw new Error('The engine refused the account change');
  }
  state.accountReference = projection;
  state.accountBlocked = false;
  state.accountSelection = `${projection.accountId} · request identity unverified`;
}

export async function restoreAccount($, state) {
  if (state.originalAuth) {
    await $.env.set('CLAUDE_SECURESTORAGE_CONFIG_DIR', state.originalAuth.slot);
    await $.env.set('CLAUDE_CODE_OAUTH_TOKEN', state.originalAuth.token);
  }
  state.originalAuth = null;
  state.accountReference = null;
  state.accountBlocked = false;
  state.accountSelection = 'Desktop sign-in';
}
