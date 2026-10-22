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
  return { tab: 'Home', expanded: {}, initPromise: null, toolRefresh: null, mcpNames: {}, booting: null, booted: false, paneFault: null, selectPages: {}, codeDetail: null, codeFilter: 'all', toolsView: 'list', projectListView: false, homeStatusRequested: false, contextRevision: 0, initializing: false, repositoriesLoading: false, cwd: '', sessionId: '', ready: false, problem: '', version: '', closed: false,
    fields: { backend: 'https://api.main-sequence.app', commandCenterUrl: '', projectSearch: '', root: '', baseDir: '', organization: '', repositoryUid: '', branch: '', projectType: '',
      image: '', platform: '', mcpSearch: '', mcpEnvironment: '', mcpTool: '', mcpArguments: '{}', agentSearch: '', codeSearch: '',
      nodePath: typeof options.nodePath === 'string' && options.nodePath ? options.nodePath : 'node' },
    projectPage: null, projectDetail: null, selectedProject: '', projectWorkspace: null, projectError: '', projectOpenMessage: '', projectsLoading: false, projectLoading: false, projectSetupRunning: false, projectListRevision: 0, projectDetailRevision: 0,
    workspaceAttachment: null, attachedRepositories: new Set(),
    editedSettings: new Set(), savedSettings: {}, environmentsLoading: false, environmentSelections: {}, preferencesLoading: false, operations: [], results: {}, selectedRepository: '', selectedLocal: '', selectedMcp: '',
    agentRevision: 0, agentListRevision: 0, agentOffset: 0, agentDetail: null, agentAccount: '', agentTools: {}, activeAgent: null, agentsLoading: false, agentSelection: 0, agentPreparing: {}, agentBindings: {}, agentDrafts: {}, agentSave: Promise.resolve(),
    agentIcons: {}, agentIconLoads: new Map(), agentIconTimes: {}, agentCommandOutputs: new Map(),
    // Checkouts outside the repositories folder: saved folder per backend and repository, what the
    // platform said about folders already asked about, and which backends' saved folders were checked.
    localFolders: {}, folderIdentity: {}, identifying: new Set(), foldersChecked: new Set(),
    // Deployments: remote state read from the environment's deployment history, never a local operation.
    deployView: '', deployOrigin: 'code', deployHistory: [], deployList: null, deployListLoading: false, deployListError: '',
    deployDetail: null, deployStep: '', deployLogs: null, deployLogsLoading: false, deployLatest: {}, deployRevision: 0,
    deployTimers: { run: null, list: null }, deployPolls: 0, deployPaused: false, paneOpen: false,
    confirmation: null, sequence: 0, timers: [], mcpTools: {}, mcpOffset: 0, running: new Map() };
}
export const sameUid = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
/** devtools' folder slug, for the canonical `<base>/<organization>/projects/<name>-<uid>` layout. */
export const safeSlug = value => String(value || 'code-repository').toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'code-repository';
const separator = folder => String(folder).includes('\\') ? '\\' : '/';
/** The folder the local scan reads and setup clones into, once the organization is known. */
export function organizationRoot(state) {
  const scanned = record(state.results['projects.local-repositories']?.data).organizationRoot;
  if (typeof scanned === 'string' && scanned) return scanned;
  const { baseDir, organization } = state.fields;
  return baseDir && organization ? [baseDir.replace(/[\\/]+$/, ''), safeSlug(organization), 'projects'].join(separator(baseDir)) : '';
}
export function cloneDestination(state, repository) {
  const { baseDir, organization } = state.fields;
  if (!repository?.uid || !baseDir || !organization) return '';
  return [baseDir.replace(/[\\/]+$/, ''), safeSlug(organization), 'projects', `${safeSlug(repository.code_repository_name || repository.name)}-${repository.uid}`].join(separator(baseDir));
}
export const folderKey = (state, root) => `${state.fields.backend.trim()}\n${root}`;
export const savedFolders = state => record(state.localFolders[state.fields.backend.trim()]);
/**
 * A `-<uuid>` folder name names a listed repository, or one of its branches: folders created by
 * earlier tools carry the branch UID. Anything else is not evidence, so the platform is asked instead.
 */
export function suffixRepository(state, root) {
  const trailing = /-([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.exec(basename(root));
  if (!trailing) return '';
  const repository = rows(state.results['devtools.repositories']?.data).find(row => sameUid(row.uid, trailing[1])
    || rows(row.branches).some(branch => sameUid(branch.uid, trailing[1])));
  return repository ? String(repository.uid) : '';
}
const scannedRepository = (state, item) => item.repositoryUid ? String(item.repositoryUid) : suffixRepository(state, item.path);
/** The repository a folder is a checkout of: the local scan, a saved folder, a platform answer, then its folder name. */
export function repositoryForPath(state, root) {
  if (!root) return '';
  const scanned = rows(state.results['projects.local-repositories']?.data).find(item => item.path === root && scannedRepository(state, item));
  if (scanned) return scannedRepository(state, scanned);
  const saved = Object.entries(savedFolders(state)).find(([, folder]) => folder === root);
  if (saved) return saved[0];
  return state.folderIdentity[folderKey(state, root)] || suffixRepository(state, root);
}
/** Where a repository is on this computer: this session's folder, the canonical copy, then a folder opened before. */
export function localPathFor(state, uid) {
  if (!uid) return '';
  if (state.cwd && sameUid(repositoryForPath(state, state.cwd), uid)) return state.cwd;
  const scanned = rows(state.results['projects.local-repositories']?.data).find(item => sameUid(scannedRepository(state, item), uid));
  if (scanned) return scanned.path;
  return Object.entries(savedFolders(state)).find(([key]) => sameUid(key, uid))?.[1] || '';
}
/** Registered branch names across the account's repositories, most common first: fallbacks when a checkout's own branch is not registered. */
export function registeredBranches(state, limit = 8) {
  const counts = new Map();
  for (const repository of rows(state.results['devtools.repositories']?.data)) {
    for (const branch of new Set(rows(repository.branches).map(row => row.repository_branch).filter(name => typeof name === 'string' && name))) counts.set(branch, (counts.get(branch) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([name]) => name);
}
/** The MainSequence repository branch a local folder stands for, from the repositories list and the checked status. */
export function deployTarget(state, { root = '', repositoryUid = '' } = {}) {
  const remote = rows(state.results['devtools.repositories']?.data);
  const context = record(record(state.results['devtools.status']?.data).project);
  const uid = String(repositoryUid || repositoryForPath(state, root) || '').toLowerCase();
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
