export const PANE = 'mainsequence';
export const TABS = ['General', 'Projects', 'Current Project', 'MCP', 'Agents', 'Activity'];
export const clean = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '').slice(0, 16000);
export const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export const rows = value => Array.isArray(value) ? value : Array.isArray(value?.results) ? value.results : Array.isArray(value?.items) ? value.items : [];
export const request = (scope, action, values = {}) => ({ scope, request: { action, ...values } });
export function initialState(options = {}) {
  return { tab: 'General', expanded: {}, contextRevision: 0, initializing: false, projectsLoading: false, cwd: '', sessionId: '', ready: false, problem: '', version: '', closed: false,
    fields: { backend: 'https://api.main-sequence.app', root: '', baseDir: '', organization: '', repositoryUid: '', branch: '', projectType: '',
      image: '', platform: '', mcpSearch: '', mcpEnvironment: '', mcpTool: '', mcpArguments: '{}', agentSearch: '',
      nodePath: typeof options.nodePath === 'string' && options.nodePath ? options.nodePath : 'node' },
    editedSettings: new Set(), savedSettings: {}, environmentsLoading: false, environmentSelections: {}, preferencesLoading: false, operations: [], results: {}, selectedRepository: '', selectedLocal: '', selectedMcp: '',
    agentRevision: 0, agentListRevision: 0, agentOffset: 0, agentDetail: null, agentAccount: '', agentTools: {}, activeAgent: null, agentsLoading: false, agentSelection: 0, agentPreparing: {}, agentBindings: {}, agentDrafts: {}, agentSave: Promise.resolve(),
    confirmation: null, sequence: 0, timers: [], mcpTools: {}, mcpOffset: 0, running: new Map() };
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
