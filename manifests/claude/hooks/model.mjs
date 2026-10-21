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
export function initialState(options = {}) {
  return { tab: 'Home', expanded: {}, initPromise: null, toolRefresh: null, booting: null, booted: false, paneFault: null, selectPages: {}, codeDetail: null, codeFilter: 'all', toolsView: 'list', projectListView: false, homeStatusRequested: false, contextRevision: 0, initializing: false, repositoriesLoading: false, cwd: '', sessionId: '', ready: false, problem: '', version: '', closed: false,
    fields: { backend: 'https://api.main-sequence.app', commandCenterUrl: '', projectSearch: '', root: '', baseDir: '', organization: '', repositoryUid: '', branch: '', projectType: '',
      image: '', platform: '', mcpSearch: '', mcpEnvironment: '', mcpTool: '', mcpArguments: '{}', agentSearch: '', codeSearch: '',
      nodePath: typeof options.nodePath === 'string' && options.nodePath ? options.nodePath : 'node' },
    projectPage: null, projectDetail: null, selectedProject: '', projectWorkspace: null, projectError: '', projectOpenMessage: '', projectsLoading: false, projectLoading: false, projectSetupRunning: false, projectListRevision: 0, projectDetailRevision: 0,
    workspaceAttachment: null, attachedRepositories: new Set(),
    editedSettings: new Set(), savedSettings: {}, environmentsLoading: false, environmentSelections: {}, preferencesLoading: false, operations: [], results: {}, selectedRepository: '', selectedLocal: '', selectedMcp: '',
    agentRevision: 0, agentListRevision: 0, agentOffset: 0, agentDetail: null, agentAccount: '', agentTools: {}, activeAgent: null, agentsLoading: false, agentSelection: 0, agentPreparing: {}, agentBindings: {}, agentDrafts: {}, agentSave: Promise.resolve(),
    agentIcons: {}, agentIconLoads: new Map(), agentIconTimes: {}, agentCommandOutputs: new Map(),
    // Deployments: remote state read from the environment's deployment history, never a local operation.
    deployView: '', deployOrigin: 'code', deployHistory: [], deployList: null, deployListLoading: false, deployListError: '',
    deployDetail: null, deployStep: '', deployLogs: null, deployLogsLoading: false, deployLatest: {}, deployRevision: 0,
    deployTimers: { run: null, list: null }, deployPolls: 0, deployPaused: false, paneOpen: false,
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
