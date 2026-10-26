export const PANE = 'mainsequence';
export const TABS = ['Home', 'Code', 'Projects', 'Agents', 'Tools'];
export const VIEWS = [...TABS, 'Settings', 'Activity'];
export const basename = value => String(value || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(value || '');
export const clean = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '').slice(0, 16000);
export const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export const rows = value => Array.isArray(value) ? value : Array.isArray(value?.results) ? value.results : Array.isArray(value?.items) ? value.items : [];
export const request = (scope, action, values = {}) => ({ scope, request: { action, ...values } });
// Branches share a clone destination, so a second branch cannot run concurrently.
export const setupKey = values => JSON.stringify([values.backend?.trim() || '', String(values.repositoryUid || ''), values.baseDir]);
// Claude rejects the entire pane when a Select has more than 64 options.
// Reserve one slot for the placeholder or the selection on another page.
export function selectPage(options, value, requestedPage = 0) {
  const seen = new Set();
  const entries = options.filter(option => typeof option.value === 'string' && !seen.has(option.value) && seen.add(option.value));
  const size = 63, count = Math.ceil(entries.length / size);
  const page = Math.max(0, Math.min(Number.isInteger(requestedPage) ? requestedPage : 0, count - 1));
  const visible = entries.slice(page * size, (page + 1) * size);
  const selected = entries.find(option => option.value === value);
  return { entries: visible, selected, page, count, total: entries.length, start: page * size + 1, end: page * size + visible.length };
}
/** The composer handle for an agent: `/ms @back-office-helper …` names its target. */
export const agentHandle = name => clean(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'agent';
export function mcpDisplayName(value) {
  const name = [value?.display_name, value?.name].find(name => typeof name === 'string' && clean(name).trim());
  return name ? clean(name).trim() : 'Unnamed MCP';
}
/** Settings every MainSequence session shares. The session's own folder (`root`) is never one of them. */
export const SHARED_SETTINGS = ['backend', 'baseDir', 'organization', 'nodePath', 'commandCenterUrl'];
export const SEARCH_FIELDS = [['project', 'projectSearch'], ['agent', 'agentSearch'], ['code', 'codeSearch'], ['mcp', 'mcpSearch']];
/** The screen every session draws alike: the section, its open details and searches. The This session card is not in it. */
export function viewSnapshot(state) {
  const f = state.fields, code = state.codeDetail, detail = state.deployDetail;
  return { tab: state.tab, context: `${f.backend}\n${f.mcpEnvironment}`,
    search: Object.fromEntries(SEARCH_FIELDS.map(([key, field]) => [key, f[field] || ''])), codeFilter: state.codeFilter,
    code: code ? { root: code.root || '', repositoryUid: String(code.repositoryUid || '') } : null,
    deploy: state.deployView === 'list' ? { view: 'list', uid: '', kind: '', origin: state.deployOrigin }
      : state.deployView === 'detail' && detail ? { view: 'detail', uid: detail.uid, kind: detail.kind, origin: state.deployOrigin } : null,
    project: { uid: state.selectedProject || '', list: !!state.projectListView, offset: Number(state.projectPage?.offset) || 0 },
    tools: { view: state.toolsView, uid: state.toolsView === 'detail' ? state.selectedMcp || '' : '' },
    agent: { uid: state.agentDetail?.uid || '', offset: state.agentOffset || 0 } };
}
// Reads draw the session's own screen; every other operation is published to the other sessions' Activity.
const READ_ACTIONS = new Set(['auth-status', 'repositories', 'status', 'sdk-status', 'mcp-environments', 'mcp-discover', 'mcp-list', 'mcp-tools', 'mcp-catalog',
  'organization-projects', 'organization-project', 'local-repositories', 'workspace-profile', 'workspace-preferences', 'runtime-diagnostics', 'read-project-workspace',
  'pick-folder', 'delete-local-preview', 'docker-preview', 'devcontainer-preview']);
export const ACTIVITY_STALE_MS = 180000, ACTIVITY_KEEP_MS = 7 * 86400000;
const ACTIVITY_STATES = new Set(['running', 'success', 'failure', 'cancelled']);
export const publishedOperation = op => !READ_ACTIONS.has(String(op.label).split(' · ').pop());
/** What a session publishes of one operation: the row Activity draws, never result data. */
export function activityEntry(op) {
  const result = op.result && { status: op.result.status, summary: clean(op.result.summary).slice(0, 500),
    ...(op.result.effects?.message ? { effects: { message: clean(op.result.effects.message).slice(0, 500) } } : {}) };
  return { id: clean(op.id), title: clean(op.title), context: clean(op.context).slice(0, 300), label: clean(op.label), status: op.status,
    progress: clean(op.progress).slice(0, 500), startedAt: Number(op.startedAt) || 0,
    ...(op.setupTarget ? { setupTarget: op.setupTarget, destination: clean(op.destination) } : {}), ...(result ? { result } : {}) };
}
/** The other sessions' published operations, oldest first. A running one whose session stopped reporting is drawn as interrupted. */
export function remoteOperations(published, now) {
  const operations = [];
  for (const { session, at, operations: entries } of published) {
    const stale = now - at > ACTIVITY_STALE_MS;
    for (const entry of rows(entries)) {
      if (!entry || typeof entry.id !== 'string' || !ACTIVITY_STATES.has(entry.status)) continue;
      operations.push({ ...entry, startedAt: Number(entry.startedAt) || 0, remote: true, session: clean(session),
        ...(stale && entry.status === 'running' ? { status: 'stale', progress: 'Stopped reporting: its Claude session may have closed.' } : {}) });
    }
  }
  return operations.sort((a, b) => a.startedAt - b.startedAt).slice(-50);
}
/** This session's operations and the other sessions', in the order they started. */
export function allOperations(state) {
  const order = op => op.startedAt || Number.MAX_SAFE_INTEGER;
  return [...state.remoteOperations, ...state.operations].sort((a, b) => order(a) - order(b));
}
export function initialState(options = {}) {
  return { tab: 'Home', expanded: {}, initPromise: null, toolRefresh: null, mcpNames: {}, booting: null, booted: false, paneFault: null, selectPages: {}, codeDetail: null, codeFilter: 'all', toolsView: 'list', projectListView: false, homeStatusRequested: false, contextRevision: 0, initializing: false, repositoriesLoading: false, cwd: '', sessionId: '', ready: false, problem: '', version: '', closed: false,
    // Shared with the other sessions through the plugin store: the JSON each key last held here, and the writers' timers.
    shared: { settings: '', environments: '', view: '', signals: null }, remoteOperations: [], syncing: null, syncedAt: 0, syncTimer: null,
    settingsTimer: null, viewTimer: null, activityTimer: null, activityHeartbeat: null, activityPublished: false,
    fields: { backend: 'https://api.main-sequence.app', commandCenterUrl: '', projectSearch: '', root: '', baseDir: '', organization: '', repositoryUid: '', branch: '', projectType: '',
      image: '', platform: '', mcpSearch: '', mcpEnvironment: '', mcpTool: '', mcpArguments: '{}', agentSearch: '', codeSearch: '',
      nodePath: typeof options.nodePath === 'string' && options.nodePath ? options.nodePath : 'node' },
    projectPage: null, projectDetail: null, selectedProject: '', projectWorkspace: null, projectError: '', projectOpenMessage: '', projectsLoading: false, projectLoading: false, projectSetupRunning: false, projectListRevision: 0, projectDetailRevision: 0,
    workspaceAttachment: null, attachedRepositories: new Set(),
    editedSettings: new Set(), savedSettings: {}, environmentsLoading: false, environmentSelections: {}, preferencesLoading: false, operations: [], results: {}, selectedRepository: '', selectedLocal: '', selectedMcp: '',
    agentRevision: 0, agentListRevision: 0, agentOffset: 0, agentDetail: null, agentAccount: '', agentTools: {}, activeAgent: null, agentsLoading: false, agentSelection: 0, agentPreparing: {}, agentBindings: {}, agentDrafts: {}, agentSave: Promise.resolve(),
    agentIcons: {}, agentIconLoads: new Map(), agentIconTimes: {}, agentIconTimer: null, agentIconRetry: null, agentIconPolls: 0, agentCommandOutputs: new Map(),
    // Deployments: remote state read from the environment's deployment history, never a local operation.
    deployView: '', deployOrigin: 'code', deployHistory: [], deployList: null, deployListLoading: false, deployListError: '',
    deployDetail: null, deployStep: '', deployLogs: null, deployLogsLoading: false, deployLatest: {}, deployRevision: 0,
    deployTimers: { run: null, list: null }, deployPolls: 0, deployPaused: false, paneOpen: false,
    // The plugin's own release: the worker's answer to plugin-version, merged with plugin-update's.
    plugin: {}, pluginCheck: null, pluginCheckedAt: 0, pluginUpdating: false, pluginHelp: '',
    confirmation: null, sequence: 0, timers: [], mcpTools: {}, mcpOffset: 0, running: new Map() };
}
/** The MainSequence repository branch a local folder stands for, from the repositories list and the checked status. */
export function deployTarget(state, { root = '', repositoryUid = '' } = {}) {
  const remote = rows(state.results['devtools.repositories']?.data);
  const locals = rows(state.results['projects.local-repositories']?.data);
  const context = record(record(state.results['devtools.status']?.data).project);
  const trailing = /-([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.exec(basename(root));
  const uid = String(repositoryUid || locals.find(local => local.path === root)?.repositoryUid || (trailing ? trailing[1] : '') || '').toLowerCase();
  const repository = remote.find(row => String(row.uid).toLowerCase() === uid);
  const branches = rows(repository?.branches);
  // The checked status describes the operation target; a single registered branch needs no check.
  const branchName = (root && state.fields.root === root && context.branch) || (branches.length === 1 ? branches[0].repository_branch : '')
    || (state.fields.repositoryUid === uid ? state.fields.branch : '') || '';
  const branch = branches.find(row => row.repository_branch === branchName);
  return { repositoryUid: uid, repositoryName: repository?.code_repository_name || '', branchName, branchUid: branch?.uid ? String(branch.uid) : '' };
}
export function meetsVersion(value, minimum = [2, 1, 296]) {
  const match = String(value || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  for (let i = 0; i < 3; i++) { if (parts[i] !== minimum[i]) return parts[i] > minimum[i]; }
  return true;
}
export function publicValue(value, depth = 0) {
  if (depth > 8) return '[nested content]';
  if (Array.isArray(value)) return value.slice(0, 100).map(item => publicValue(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/^(accessToken|refreshToken|access|refresh|token|password|secret|credentialReference|credentialRef|projection)$/i.test(key))
    .map(([key, item]) => [clean(key), publicValue(item, depth + 1)]));
  return typeof value === 'string' ? clean(value) : value;
}
export function resultText(result) {
  return clean([result?.summary, result?.effects?.message,
    result?.data === undefined ? '' : JSON.stringify(publicValue(result.data), null, 2)].filter(Boolean).join('\n\n'));
}
export function fail(action, message, code = 'PROCESS_FAILED', uncertain = false) {
  return { schemaVersion: 1, action, status: code === 'CANCELLED' ? 'cancelled' : 'failure', summary: message,
    error: { code, message }, ...(uncertain ? { effects: { state: 'partial-or-uncertain', message: 'The operation stopped before reporting completion. Inspect changes before retrying.' } } : {}) };
}
export function actionOptions(state) {
  const f = state.fields;
  return { ...(f.backend.trim() ? { backend: f.backend.trim() } : {}), root: f.root || state.cwd,
    ...(f.projectType ? { projectType: f.projectType } : {}) };
}
