import { TABS, PANE, initialState, meetsVersion, clean, record, rows, request, actionOptions, fail, publicValue } from './model.mjs';
import { renderPane } from './view.mjs';

const sessionActions = new Set(['login', 'logout', 'refresh-token', 'auth-status', 'repositories']);
const update = ($) => $.ui.invalidate('ui.render');

function operationTitle(action) {
  return ({ 'auth-status': 'Check MainSequence connection', login: 'Sign in to MainSequence', logout: 'Sign out of MainSequence',
    'refresh-token': 'Renew MainSequence session', repositories: 'Refresh code repositories', setup: 'Set up repository',
    status: 'Check project status', sync: 'Sync dependencies', install: 'Install dependencies', 'sdk-status': 'Check SDK',
    'mcp-discover': 'Find project MCPs', 'mcp-list': 'Refresh MCP connections', 'mcp-add': 'Connect project MCP',
    'mcp-remove': 'Disconnect project MCP', 'mcp-tools': 'Read MCP tools', 'mcp-call': 'Call MCP tool',
    'local-repositories': 'Discover local repositories' })[action] || action.replaceAll('-', ' ');
}

async function execute($, state, domain, quiet = false) {
  const action = domain.request.action;
  const contextRevision = state.contextRevision;
  if (!state.ready || state.closed) return fail(action, state.problem || 'This session is not ready.', 'UNSUPPORTED_ACTION');
  if (state.running.size >= 8) return fail(action, 'Wait for a running operation to finish.', 'PROJECT_BUSY');
  const id = `${state.sessionId}-${++state.sequence}`;
  const op = { id, title: operationTitle(action), context: domain.request.environmentUid ? `Environment: ${environmentLabel(state)}` : domain.scope === 'devtools' && !sessionActions.has(action) ? domain.request.root || 'MainSequence' : 'MainSequence', label: `${domain.scope} · ${action}`, status: 'running', progress: 'Starting…', cancelled: false };
  state.running.set(id, op);
  if (!quiet) { state.operations.push(op); state.operations = state.operations.filter((value, index, all) => value.status === 'running' || index >= all.length - 30); update($); }
  const envelope = { protocolVersion: 1, id, request: domain };
  let result = await runWorker($, state, envelope, op, message => { op.progress = message; if (!quiet) update($); });
  const publicResult = publicValue(result);
  op.status = publicResult.status; op.progress = publicResult.summary; op.result = publicResult;
  state.running.delete(id);
  if (contextRevision === state.contextRevision && !state.closed) state.results[`${domain.scope}.${action}`] = publicResult;
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
    if (action !== 'mcp-environments') {
      if (!f.mcpEnvironment) throw new Error('Choose an organization environment in MCP first.');
      values.environmentUid = f.mcpEnvironment;
    }
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
  const revision = state.contextRevision;
  let domain;
  if (state.preferencesLoading) { $.ui.toast('Workspace settings are loading.'); return; }
  try { domain = devRequest(state, action, extra); }
  catch { $.ui.toast(action.startsWith('mcp-') && !state.fields.mcpEnvironment ? 'Choose an organization environment in MCP first.' : 'Enter valid JSON object arguments before calling the tool.'); return; }
  if (action === 'mcp-discover') state.mcpOffset = domain.request.offset;
  const result = await execute($, state, domain);
  if (state.closed || revision !== state.contextRevision) return result;
  if (result.status === 'success' && ['mcp-add', 'mcp-remove'].includes(action)) await refreshTools($, state);
  if (result.status === 'success' && ['login', 'logout', 'refresh-token'].includes(action)) await execute($, state, devRequest(state, 'auth-status', { check: true }), true);
  if (result.status === 'success' && !extra.dryRun && ['sync', 'install', 'update-sdk', 'update-agents', 'install-skills', 'skills-sync', 'env-cleanup'].includes(action)) {
    await execute($, state, devRequest(state, 'status'), true);
    if (action === 'update-sdk' || action === 'install') await execute($, state, devRequest(state, 'sdk-status'), true);
  }
  if (result.status === 'success' && action === 'logout') {
    clearMcp($, state); state.fields.mcpEnvironment = ''; delete state.results['devtools.mcp-environments']; state.selectedLocal = ''; state.fields.repositoryUid = ''; state.fields.branch = '';
    for (const key of ['devtools.repositories', 'projects.local-repositories', 'devtools.mcp-list', 'devtools.mcp-discover', 'devtools.mcp-tools']) delete state.results[key];
  }
  if (result.status === 'success' && action === 'setup') await runProject($, state, 'local-repositories');
  update($);
  return result;
}

async function runProject($, state, action, extra = {}) {
  const revision = state.contextRevision;
  const f = state.fields;
  const values = { root: action.startsWith('delete-local') ? state.selectedLocal : f.root || state.cwd,
    baseDir: f.baseDir, organization: f.organization, ...(f.image ? { image: f.image } : {}), ...(f.platform ? { platform: f.platform } : {}), ...extra };
  const destination = values.destination; delete values.destination;
  if (action === 'pick-folder') values.initialPath = f[destination] || state.cwd;
  if (action === 'local-repositories') values.repositories = rows(state.results['devtools.repositories']?.data).map(row => ({ uid: row.uid, name: row.code_repository_name || row.name }));
  const result = await execute($, state, request('projects', action, values));
  if (state.closed || result.status !== 'success' || revision !== state.contextRevision) return result;
  const data = record(result.data);
  if (action === 'workspace-profile' && typeof data.organization === 'string') state.fields.organization = data.organization;
  if (action === 'pick-folder' && typeof data.path === 'string' && ['root', 'baseDir'].includes(destination)) {
    state.editedSettings.add(destination); state.fields[destination] = data.path;
    if (destination === 'baseDir') { state.contextRevision++; state.selectedLocal = ''; delete state.results['projects.local-repositories']; }
    if (destination === 'root') { state.contextRevision++; state.confirmation = null; delete state.results['devtools.status']; delete state.results['devtools.sdk-status']; }
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

function toolName(backend, environment, release, name) {
  const value = `${backend}:${environment}:${release}:${name}`;
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619) >>> 0;
  return `ms_${String(name).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 42)}_${hash.toString(16)}`;
}

async function refreshTools($, state) {
  const revision = state.contextRevision;
  state.mcpTools = {};
  if (!state.fields.mcpEnvironment || state.preferencesLoading) return;
  const environmentUid = state.fields.mcpEnvironment;
  const listed = await execute($, state, devRequest(state, 'mcp-list'), true);
  if (state.closed || revision !== state.contextRevision) return;
  if (listed.status !== 'success') { state.results['mcp.registration'] = publicValue(listed); update($); return; }
  const next = {};
  const unavailable = [];
  for (const connection of rows(listed.data)) {
    if (connection.mcp_connection?.organization_environment_uid !== environmentUid) continue;
    const releaseUid = connection.resource_release_uid;
    const backend = connection.backend;
    const answer = await execute($, state, request('devtools', 'mcp-tools', { backend, environmentUid, releaseUid }), true);
    if (state.closed || revision !== state.contextRevision) return;
    if (answer.status !== 'success') { unavailable.push(clean(connection.name)); continue; }
    for (const tool of rows(record(answer.data).tools).slice(0, 80)) {
      const name = toolName(backend, environmentUid, releaseUid, tool.name);
      const full = `mcp__${$.plugin.name}__${name}`;
      next[full] = { backend, environmentUid, releaseUid, tool: tool.name };
      await $.tool.register({ name, description: clean(`MainSequence ${connection.name} [${environmentLabel(state)}]: ${tool.description || tool.name}`), inputSchema: record(tool.inputSchema) });
      if (state.closed || revision !== state.contextRevision) return;
    }
  }
  // Removed servers' previously registered names are refused by the handler below.
  if (state.closed || revision !== state.contextRevision) return;
  state.mcpTools = next;
  state.results['mcp.registration'] = { schemaVersion: 1, action: 'mcp-registration', status: 'success',
    summary: `${Object.keys(next).length} MainSequence tools available from the next prompt.`, data: { unavailable } };
  update($);
}

function environmentLabel(state) {
  return rows(state.results['devtools.mcp-environments']?.data).find(row => row.uid === state.fields.mcpEnvironment)?.name || state.fields.mcpEnvironment;
}
function clearMcp($, state) {
  state.contextRevision++; state.mcpTools = {}; state.selectedMcp = ''; state.confirmation = null;
  state.fields.mcpTool = ''; state.mcpOffset = 0;
  for (const key of ['devtools.mcp-discover', 'devtools.mcp-list', 'devtools.mcp-tools', 'devtools.mcp-call', 'mcp.registration']) delete state.results[key];
  for (const op of state.running.values()) if (op.label.startsWith('devtools · mcp-') && op.cancel) void op.cancel().catch(() => {});
  update($);
}
async function selectEnvironment($, state, uid, persist = true) {
  if (uid && !rows(state.results['devtools.mcp-environments']?.data).some(row => row.uid === uid)) return;
  clearMcp($, state); state.fields.mcpEnvironment = uid;
  const revision = state.contextRevision, backend = state.fields.backend;
  state.environmentSelections[backend] = uid;
  if (persist) {
    const previous = record(await $.store.get('mcp-environments'));
    if (revision === state.contextRevision && !state.closed) await $.store.set('mcp-environments', { ...previous, [backend]: uid });
  }
  if (!uid || revision !== state.contextRevision || state.closed) return;
  await refreshTools($, state);
  if (revision === state.contextRevision) await runDev($, state, 'mcp-discover');
}
async function loadEnvironments($, state) {
  if (state.environmentsLoading || state.preferencesLoading) return;
  state.environmentsLoading = true; const revision = state.contextRevision; update($);
  try {
    const result = await execute($, state, request('devtools', 'mcp-environments', { backend: state.fields.backend }), true);
    if (revision !== state.contextRevision || state.closed) return;
    if (result.status !== 'success') { clearMcp($, state); state.fields.mcpEnvironment = ''; return; }
    const selected = state.fields.mcpEnvironment || state.environmentSelections[state.fields.backend];
    const uid = rows(result.data).some(row => row.uid === selected) ? selected : '';
    await selectEnvironment($, state, uid, false);
  } finally { state.environmentsLoading = false; update($); }
}

function actionsFor($, state) {
  const background = work => { void Promise.resolve(work).catch(() => $.ui.toast('The action could not complete. Check Activity and diagnostics.')); };
  return {
    open: () => background($.ui.open({ id: PANE, title: 'MainSequence', focus: true })),
    tab: tab => {
      if (!TABS.includes(tab)) return;
      state.tab = tab; state.confirmation = null; update($);
      if (tab === 'MCP' && !state.results['devtools.mcp-environments']) background(loadEnvironments($, state));
      if (tab === 'Projects' && !state.results['devtools.repositories']) background(loadProjects($, state));
      if (tab === 'Current Project' && !state.results['devtools.status']) background(runDev($, state, 'status'));
    },
    refreshEnvironments: () => background(loadEnvironments($, state)),
    selectEnvironment: uid => background(selectEnvironment($, state, uid)),
    toggle: key => { state.expanded[key] = !state.expanded[key]; update($); },
    refreshProjects: () => background(loadProjects($, state)),
    chooseRepository: uid => {
      state.fields.repositoryUid = uid;
      const branches = rows(rows(state.results['devtools.repositories']?.data).find(row => row.uid === uid)?.branches);
      state.fields.branch = branches.length === 1 ? branches[0].repository_branch : '';
      update($);
    },
    field: (key, value) => {
      if (Object.hasOwn(state.fields, key)) {
        state.editedSettings.add(key);
        state.fields[key] = String(value);
        if (key === 'repositoryUid') state.fields.branch = '';
        if (key === 'backend') {
          clearMcp($, state); state.fields.mcpEnvironment = '';
          state.contextRevision++;
          state.fields.repositoryUid = ''; state.fields.branch = ''; state.fields.organization = ''; state.selectedLocal = '';
          for (const resultKey of Object.keys(state.results)) delete state.results[resultKey];
          state.selectedMcp = ''; state.mcpTools = {}; state.confirmation = null;
        }
        if (key === 'baseDir') { state.contextRevision++; state.selectedLocal = ''; delete state.results['projects.local-repositories']; }
        if (key === 'root' || key === 'projectType') { state.contextRevision++; state.confirmation = null; }
        if (key === 'root' || key === 'projectType' || key === 'backend') { delete state.results['devtools.status']; delete state.results['devtools.sdk-status']; }
      }
      update($);
    },
    selectLocal: value => { state.selectedLocal = value; update($); },
    selectMcp: value => { state.selectedMcp = value; update($); },
    useLocal: () => { state.contextRevision++; state.confirmation = null; state.fields.root = state.selectedLocal; delete state.results['devtools.status']; delete state.results['devtools.sdk-status']; state.tab = 'Current Project'; update($); },
    dev: (action, extra) => background(runDev($, state, action, extra)),
    project: (action, extra) => background(runProject($, state, action, extra)),
    refreshTools: () => background(refreshTools($, state)),
    confirm: (title, detail, callback) => { state.confirmation = { title, detail, callback }; update($); },
    dismiss: () => { state.confirmation = null; update($); },
    accept: () => { const confirmation = state.confirmation; state.confirmation = null; update($); if (confirmation) background(confirmation.callback()); },
    cancel: id => { const op = state.operations.find(value => value.id === id); if (op?.cancel) { op.progress = 'Cancelling…'; background(op.cancel()); update($); } },
    saveSettings: () => background(saveSettings($, state)),
  };
}

async function saveSettings($, state) {
  const saved = record(await $.store.get('settings'));
  await $.store.set('settings', { ...saved, backend: state.fields.backend, baseDir: state.fields.baseDir,
    organization: state.fields.organization, nodePath: state.fields.nodePath });
  $.ui.toast('MainSequence settings saved.');
}

async function boot($, state, e) {
  state.closed = false;
  state.cwd = await $.session.cwd(); state.fields.root = state.cwd;
  state.sessionId = await $.session.id();
  const version = await $.session.version();
  state.version = typeof version === 'string' ? version : version?.version || version?.full || '';
  // The loader validates every named API. Reading an API method as a value is forbidden.
  state.ready = meetsVersion(state.version, [2, 1, 286]);
  state.problem = state.ready ? '' : 'Update Claude Desktop: this mod needs bundled Claude Code 2.1.286+ and streaming process support.';
  const home = await $.env.get('HOME') || await $.env.get('USERPROFILE');
  if (typeof home === 'string' && home.trim()) state.fields.baseDir = `${home.replace(/[\\/]+$/, '')}${home.includes('\\') ? '\\' : '/'}mainsequence`;
  const saved = record(await $.store.get('settings'));
  state.savedSettings = saved;
  state.environmentSelections = record(await $.store.get('mcp-environments'));
  for (const key of ['backend', 'baseDir', 'organization', 'nodePath']) if (typeof saved[key] === 'string' && saved[key].trim()) state.fields[key] = saved[key];
  await $.command.register({ name: 'ms', description: 'Open MainSequence developer tools', immediate: true });
  if (e.surface === 'desktop') {
    state.preferencesLoading = true;
    // Register the native pane without stealing focus or adding a composer band.
    await $.ui.open({ id: PANE, title: 'MainSequence' });
    state.timers.push($.clock.after(0, () => { void initializeWorkspace($, state).catch(() => { state.initializing = false; state.preferencesLoading = false; update($); }); }));
  }
  update($);
}

async function initializeWorkspace($, state) {
  if (!state.ready || state.closed) { state.preferencesLoading = false; return; }
  state.initializing = true; update($);
  try {
    const preferences = await execute($, state, request('projects', 'workspace-preferences'), true);
    if (state.closed) return;
    for (const key of ['backend', 'baseDir']) {
      if (!state.editedSettings.has(key) && !String(state.savedSettings[key] || '').trim()
        && typeof preferences.data?.[key] === 'string' && preferences.data[key].trim()) state.fields[key] = preferences.data[key];
    }
    state.preferencesLoading = false; update($);
    await execute($, state, devRequest(state, 'auth-status', { check: false }), true);
    if (state.tab === 'MCP' || state.environmentSelections[state.fields.backend]) await loadEnvironments($, state);
  } finally { state.initializing = false; state.preferencesLoading = false; update($); }
}

async function loadProjects($, state) {
  if (state.projectsLoading) return;
  state.projectsLoading = true; update($);
  const revision = state.contextRevision;
  try {
    const listed = await runDev($, state, 'repositories');
    if (state.closed || revision !== state.contextRevision || listed?.status !== 'success') return;
    if (!state.fields.organization && state.fields.backend) await runProject($, state, 'workspace-profile', { backend: state.fields.backend });
    if (state.closed || revision !== state.contextRevision) return;
    if (state.fields.baseDir && state.fields.organization) await runProject($, state, 'local-repositories');
  } finally { state.projectsLoading = false; update($); }
}

export function register(on, options = {}) {
  const state = initialState(options);
  on('session.start', async ($, e, next) => { await boot($, state, e); return next(e); });
  on('command.run', { command: 'ms' }, async ($) => { await $.ui.open({ id: PANE, title: 'MainSequence', focus: true }); return {}; });
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e);
    return renderPane($.ui.resolve(e), state, actionsFor($, state));
  });
  on('tool.call', { tool: /^mcp__mainsequence__/ }, async ($, e) => {
    const entry = state.mcpTools[e.tool];
    if (!entry || entry.environmentUid !== state.fields.mcpEnvironment) return { deny: 'This MainSequence MCP tool is no longer connected. Refresh MainSequence tools.' };
    const revision = state.contextRevision;
    const answer = await $.ui.ask(`Run MainSequence tool ${entry.tool} in ${environmentLabel(state)}?`, ['Run tool', 'Cancel']);
    if (answer !== 'Run tool') return { deny: 'The user cancelled this MainSequence action.' };
    if (state.closed || revision !== state.contextRevision || state.mcpTools[e.tool] !== entry) return { deny: 'The selected environment changed. Review the tool in the current environment.' };
    const { tool, tool_use_id, agentId, ...arguments_ } = e;
    const result = await execute($, state, request('devtools', 'mcp-call', { ...entry, arguments: arguments_ }));
    return { result: publicValue(result), ...(result.status !== 'success' ? { isError: true } : {}) };
  }).catch(() => ({ deny: 'MainSequence could not confirm or run this tool call.' }));
  on('session.end', async ($, e, next) => {
    state.closed = true;
    for (const op of state.running.values()) if (op.status === 'running' && op.cancel) void op.cancel().catch(() => {});
    for (const timer of state.timers) timer.cancel();
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
    child = $.process.spawn({ argv: [state.fields.nodePath, `${$.plugin.root}/dist/claudeRunner.js`], cwd: state.cwd, input });
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
