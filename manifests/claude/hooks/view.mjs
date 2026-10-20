import { TABS, clean, record, rows, resultText, mcpDisplayName, setupKey, selectPage } from './model.mjs';
import { renderAgents } from './agentView.mjs';
import { EMBLEM } from './branding.mjs';

export function renderRecovery(ui, state, actions) {
  return ui.Box({ flexDirection: 'column', gap: 1, padding: 1, children: [
    ui.Text({ children: ['MainSequence could not display this screen.'] }),
    ui.Text({ children: ['Your running operations have not been restarted.'] }),
    ui.Text({ children: [clean([state.paneFault?.phase, state.paneFault?.element].filter(Boolean).join(' · '))] }),
    ui.Button({ key: 'retry-pane', label: 'Retry display', onPress: actions.retryPane }),
  ] });
}

/** Host-themed Desktop primitives in unframed sections. No custom palette or DOM. */
export function renderPane(ui, state, actions) {
  const { Box, Text, Button, Input, Select, Code, Svg } = ui;
  const text = (value, props = {}) => Text({ ...props, children: [clean(value)] });
  const muted = value => text(value, { dimColor: true });
  const title = value => text(value, { bold: true });
  const column = children => Box({ flexDirection: 'column', gap: 1, children: children.filter(Boolean) });
  const buttons = children => Box({ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 1, children: children.filter(Boolean) });
  const line = (label, value) => Box({ flexDirection: 'row', justifyContent: 'space-between', gap: 2, children: [muted(label), text(value, { wrap: 'wrap' })] });
  const card = (heading, children, control) => Box({ flexDirection: 'column', gap: 1, paddingY: 1,
    children: [Box({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 1, children: [title(heading), control].filter(Boolean) }), ...children.filter(Boolean)] });
  const button = (key, label, callback, available = true) => available ? Button({ key, label, onPress: callback }) : null;
  const toggle = (key, label) => Button({ key: `toggle-${key}`, label: `${state.expanded[key] ? '▾' : '▸'} ${label}`, onPress: () => actions.toggle(key) });
  const input = (key, label, placeholder = '') => column([muted(label), Input({ key: `field-${key}`, value: state.fields[key] || '', placeholder,
    onInput: value => actions.field(key, value), onSubmit: value => actions.field(key, value) })]);
  const select = (key, label, options, value, callback, showLabel = true) => {
    const page = selectPage(options, value, state.selectPages[key]);
    if (!page.total) return null;
    const choices = page.entries.some(option => option.value === value) ? page.entries
      : [page.selected || { value: '', label: `Choose ${label.toLowerCase()}` }, ...page.entries];
    return column([showLabel && muted(label), Select({ key, options: choices, value: page.selected ? value : '', onSelect: callback }),
      page.count > 1 && buttons([
        button(`${key}-previous`, 'Previous', () => actions.selectPage(key, page.page - 1), page.page > 0),
        muted(`${page.start}–${page.end} of ${page.total}`),
        button(`${key}-next`, 'Next', () => actions.selectPage(key, page.page + 1), page.page + 1 < page.count),
      ]),
    ]);
  };
  const result = key => {
    const value = state.results[key];
    if (!value) return null;
    return column([text(value.summary, { dimColor: value.status === 'success' }), value.effects && text(value.effects.message),
      value.data !== undefined && toggle(`result-${key}`, 'Technical details'), state.expanded[`result-${key}`] && Code({ source: resultText(value), language: 'json', wrap: 'wrap' })]);
  };
  const dev = (action, extra) => () => actions.dev(action, extra);
  const project = (action, extra) => () => actions.project(action, extra);
  const mut = (label, callback, detail = label) => () => actions.confirm(label, detail, callback);
  const f = state.fields;
  const busy = (scope, action) => state.operations.some(op => op.status === 'running' && op.label === `${scope} · ${action}`);
  const section = state.tab;
  const runningSetups = state.operations.filter(op => op.setupTarget && op.status === 'running');
  const headerEnvironments = rows(state.results['devtools.mcp-environments']?.data);
  const sharedEnvironment = ['MCP', 'Agents'].includes(section) ? column([
    Box({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 1, children: [
      text('Organization environment'), button('mcp-environments', 'Refresh', actions.refreshEnvironments, !state.environmentsLoading),
    ].filter(Boolean) }),
    state.environmentsLoading && muted('Loading organization environments…'),
    select('mcp-environment', 'environment', headerEnvironments.map(row => ({ value: row.uid, label: clean(row.name) })),
      f.mcpEnvironment, actions.selectEnvironment, false),
    muted('Used by MCP tools and agents.'),
    state.results['devtools.mcp-environments']?.status === 'failure' && text(state.results['devtools.mcp-environments'].summary),
    !state.environmentsLoading && state.results['devtools.mcp-environments']?.status === 'success' && !headerEnvironments.length && muted('No organization environments are available for this account.'),
  ]) : null;
  const header = Box({ flexDirection: 'column', gap: 2, children: [
    Box({ flexDirection: 'row', alignItems: 'center', gap: 1, paddingY: 1, children: [Svg({ source: EMBLEM, alt: 'MainSequence emblem', width: 28, height: 28 }), title('MainSequence')] }),
    Box({ key: 'section-navigation', flexDirection: 'column', gap: 1,
      children: [TABS.slice(0, 3), TABS.slice(3)].map(group => buttons(group.map(tab =>
        Button({ key: `tab-${tab.replaceAll(' ', '-')}`, label: `${tab === state.tab ? '✓ ' : ''}${tab === 'Current Project' ? 'Current project' : tab}`,
          dimColor: tab !== state.tab, onPress: () => actions.tab(tab) })
      ))),
    }),
    sharedEnvironment,
    state.problem && text(state.problem),
    section !== 'Projects' && section !== 'Activity' && runningSetups.length > 0 && column([
      ...runningSetups.map(op => text(`Setting up ${op.context}: ${op.progress}`)),
      button('show-setup-activity', 'View setup progress', () => actions.tab('Activity')),
    ]),
  ].filter(Boolean) });
  const page = body => Box({ flexDirection: 'column', gap: 2, padding: 1, children: [header, ...body.filter(Boolean)] });
  if (state.confirmation) return page([card(state.confirmation.title, [text(state.confirmation.detail), buttons([button('dismiss-confirmation', 'Cancel', actions.dismiss), button('confirm-action', 'Confirm', actions.accept)])])]);
  if (!state.booted) return page([text('Loading MainSequence…')]);
  if (!state.ready) return page([card('Update required', [text('Update Claude Desktop to use MainSequence in a local Code session.')])]);
  let body;
  if (state.tab === 'General') {
    const auth = state.results['devtools.auth-status'];
    const session = record(auth?.data);
    const signedIn = auth?.status === 'success' && session.authenticated === true;
    const diagnostics = record(state.results['projects.runtime-diagnostics']?.data);
    body = column([
      card('MainSequence account', [
        state.initializing ? muted('Checking your saved connection…') : title(signedIn ? 'Signed in' : auth?.status === 'failure' ? 'Connection needs attention' : 'Sign in to get started'),
        signedIn && text(session.username || 'MainSequence account'),
        signedIn && muted(session.checked ? 'Connection verified' : 'Using your saved MainSequence session'),
        !signedIn && muted('Connect in your browser to browse and set up your repositories.'),
        auth?.status === 'failure' && text(auth.summary),
        buttons([button('login', busy('devtools', 'login') ? 'Opening sign-in…' : 'Sign in with browser', dev('login'), !signedIn && !busy('devtools', 'login')),
          button('auth-status', 'Check connection', dev('auth-status', { check: true })),
          signedIn && toggle('connection-actions', 'Manage account')]),
        state.expanded['connection-actions'] && buttons([button('refresh-token', 'Renew session', dev('refresh-token')), button('logout', 'Sign out', mut('Sign out of MainSequence', dev('logout'), 'Remove the saved MainSequence login for this backend.'))]),
        ['login', 'refresh-token', 'logout'].map(action => state.results[`devtools.${action}`]).filter(value => value?.status === 'failure').map(value => text(value.summary)).length
          ? column(['login', 'refresh-token', 'logout'].map(action => state.results[`devtools.${action}`]).filter(value => value?.status === 'failure').map(value => text(value.summary))) : null,
      ]),
      card('Workspace settings', [
        input('backend', 'Backend URL'),
        input('baseDir', 'Code repositories folder'),
        muted('These values are used now. Save settings keeps your edits for future sessions.'),
        state.preferencesLoading && muted('Loading workspace settings…'),
        state.results['projects.workspace-preferences']?.status === 'failure' && muted('Saved workspace preferences could not be read. Check the displayed values before continuing.'),
        buttons([button('pick-base', 'Choose folder', project('pick-folder', { destination: 'baseDir' })), button('save-settings', 'Save settings', actions.saveSettings)]),
      ]),
      card('Advanced', [
        muted('Runtime troubleshooting and optional overrides.'), toggle('runtime', 'Runtime & diagnostics'),
        state.expanded.runtime && column([
          line('Claude Code', state.version || 'Unknown'),
          diagnostics.version && line('Plugin', diagnostics.version), diagnostics.nodeVersion && line('Node.js', diagnostics.nodeVersion),
          diagnostics.bundleHealth && line('Plugin files', Object.values(diagnostics.bundleHealth).every(Boolean) ? 'Ready' : 'Needs attention'),
          button('diagnostics', 'Run diagnostics', project('runtime-diagnostics')),
          state.results['projects.runtime-diagnostics']?.status === 'failure' && text(state.results['projects.runtime-diagnostics'].summary),
          toggle('runtime-paths', 'Executable overrides'),
          state.expanded['runtime-paths'] && column([input('nodePath', 'Node.js executable', 'node'), button('save-runtime-settings', 'Save overrides', actions.saveSettings)]),
          state.results['projects.runtime-diagnostics'] && toggle('runtime-details', 'Technical details'),
          state.expanded['runtime-details'] && Code({ source: resultText(state.results['projects.runtime-diagnostics']), language: 'json', wrap: 'wrap' }),
        ]),
      ]),
    ]);
  }
  if (state.tab === 'Projects') {
    const listed = state.results['devtools.repositories'];
    const repositories = rows(listed?.data);
    const selected = repositories.find(row => row.uid === f.repositoryUid);
    const branches = rows(selected?.branches).map(row => ({ value: row.repository_branch, label: row.repository_branch }));
    const locals = rows(state.results['projects.local-repositories']?.data);
    const selectedLocal = locals.find(row => String(row.repositoryUid) === String(f.repositoryUid));
    const setup = state.operations.findLast(op => op.setupTarget === setupKey(f));
    const settingUp = setup?.status === 'running';
    body = column([
      card('Code repositories', [
        state.projectsLoading && muted('Loading your repositories…'),
        listed?.status === 'failure' && text(listed.summary),
        listed?.status === 'success' && !repositories.length && muted('No code repositories are available for this account.'),
        select('remote-repository', 'Repository', repositories.map(row => ({ value: String(row.uid), label: clean(row.code_repository_name || row.name || row.uid) })), f.repositoryUid, actions.chooseRepository),
        selected && line('Type', selected.code_repository_type === 'vite_react' ? 'Vite / React' : selected.primary_language || selected.code_repository_type || 'Project'),
        selected && select('repository-branch', 'Branch', branches, f.branch, value => actions.field('branch', value)),
        selected && !branches.length && muted('This repository has no branches available for setup yet.'),
        selected && !selectedLocal && column([
          line('Destination', f.baseDir || 'Choose a folder in General'),
          buttons([
            Button({ key: 'setup', label: settingUp ? 'Setting up…' : 'Set up locally', disabled: settingUp || !f.branch || !f.baseDir, onPress: () => actions.setup(false) }),
            Button({ key: 'setup-install', label: 'Set up & install', disabled: settingUp || !f.branch || !f.baseDir, onPress: () => actions.setup(true) }),
          ]),
        ]),
        selectedLocal && column([line('Local copy', selectedLocal.path), button('use-repository', 'Manage local project', () => { actions.selectLocal(selectedLocal.path); actions.useLocal(); })]),
        setup && column([
          title(settingUp ? 'Setting up locally…' : setup.status === 'success' ? 'Local setup completed' : setup.status === 'cancelled' ? 'Setup cancelled' : 'Setup failed'),
          text(setup.context), text(setup.progress),
          settingUp && button('cancel-setup', setup.cancelled ? 'Cancelling…' : 'Cancel setup', () => actions.cancel(setup.id), !setup.cancelled),
          setup.result?.effects && text(setup.result.effects.message),
          setup.result?.data?.root && column([
            line('Local folder', setup.result.data.root),
            button('setup-open-folder', 'Open folder', dev('open-folder', { root: setup.result.data.root })),
            button('setup-manage', 'Manage local project', () => { actions.selectLocal(setup.result.data.root); actions.useLocal(); }),
          ]),
          setup.status === 'failure' && text('Review the error and any partial changes before starting setup again.'),
          button('setup-activity', 'View activity', () => actions.tab('Activity')),
        ]),
      ], button('list-repositories', 'Refresh', actions.refreshProjects, !state.projectsLoading)),
      card('On this computer', [
        locals.length ? select('local-repository', 'Local project', locals.map(row => ({ value: row.path, label: clean(row.name) })), state.selectedLocal, actions.selectLocal)
          : muted(f.organization ? 'No local copies found in your repositories folder.' : 'Load your repositories to discover local copies.'),
        state.selectedLocal && buttons([button('use-local', 'Manage project', actions.useLocal), button('delete-local-preview', 'Delete local copy…', project('delete-local-preview'))]),
        state.results['projects.local-repositories']?.status === 'failure' && text(state.results['projects.local-repositories'].summary),
        toggle('local-location', 'Local discovery settings'),
        state.expanded['local-location'] && column([input('organization', 'Organization folder'), button('local-list', 'Scan local repositories', project('local-repositories'), !!f.baseDir && !!f.organization)]),
      ]),
    ]);
  }
  if (state.tab === 'Current Project') {
    const capabilities = record(state.results['devtools.status']?.data).capabilities;
    const available = action => !Array.isArray(capabilities) || !capabilities.some(c => c.action === action && c.state !== 'available');
    const sdk = record(state.results['devtools.sdk-status']?.data);
    const sdkUpdate = available('update-sdk') && sdk.updateSupported === true && sdk.updateAvailable === true;
    body = column([
      card('Project', [
      input('root', 'Project folder'), button('pick-root', 'Choose project folder', project('pick-folder', { destination: 'root' })),
      select('project-type', 'Project type', [{ value: '', label: 'Detect automatically' }, { value: 'python', label: 'Python' }, { value: 'vite_react', label: 'Vite / React' }], f.projectType, value => actions.field('projectType', value)),
      buttons([button('project-status', 'Refresh status', dev('status')), button('project-resolve', 'Identify repository', dev('resolve')), button('sdk-status', 'Check SDK', dev('sdk-status'))]),
      result('devtools.status'), result('devtools.sdk-status'),
      ]),
      card('Dependencies & SDK', [
      buttons([button('sync', 'Sync dependencies', mut('Sync dependencies', dev('sync')), available('sync')),
        button('install', 'Install dependencies', mut('Install dependencies', dev('install')), available('install')),
        button('update-sdk-preview', 'Preview SDK update', dev('update-sdk', { dryRun: true }), sdkUpdate),
        button('update-sdk', 'Update SDK', mut('Update MainSequence SDK', dev('update-sdk')), sdkUpdate)]),
      !sdkUpdate && text(sdk.hint || 'Check SDK status to see whether this project supports an available automatic update.'),
      ]),
      card('Project instructions', [
      buttons([button('update-agents', 'Update agent instructions', mut('Update agent instructions', dev('update-agents')), available('update-agents')),
        button('skills-preview', 'Preview skill installation', dev('install-skills', { dryRun: true }), available('install-skills')),
        button('install-skills', 'Install skills', mut('Install project skills', dev('install-skills')), available('install-skills')),
        button('skills-sync', 'Sync skills', mut('Sync project skills', dev('skills-sync')), available('skills-sync')),
        button('env-cleanup', 'Clean legacy environment credentials', mut('Clean legacy credentials', dev('env-cleanup'), 'Remove migrated MainSequence credentials from the project environment file.'), available('env-cleanup'))]),
      ]),
      card('Workspace tools', [
      buttons([button('open-folder', 'Open folder', dev('open-folder'), available('open-folder')),
        button('signed-terminal', 'Open signed terminal', mut('Open signed terminal', dev('signed-terminal'), 'Open a terminal with the MainSequence project environment.'), available('signed-terminal'))]),
      input('image', 'Container image', 'mainsequence-project:latest'), input('platform', 'Docker platform', 'linux/arm64'),
      buttons([button('docker-preview', 'Review Docker build', project('docker-preview')),
        button('devcontainer-preview', 'Review container configuration', project('devcontainer-preview')),
        button('open-container', 'Open container', project('open-container'))]),
      result('projects.open-container'),
      ]),
    ]);
  }
  if (state.tab === 'MCP') {
    const environments = rows(state.results['devtools.mcp-environments']?.data);
    const environment = environments.find(row => row.uid === f.mcpEnvironment);
    const matches = row => row.mcp_connection?.organization_environment_uid === f.mcpEnvironment;
    const label = row => clean(`${mcpDisplayName(row)} · ${row.mcp_connection?.organization_environment_name || environment?.name || 'Unknown environment'}`);
    const discovered = rows(state.results['devtools.mcp-discover']?.data).filter(matches);
    const connected = rows(state.results['devtools.mcp-list']?.data).filter(matches);
    const tools = record(state.results['devtools.mcp-tools']?.data).tools;
    body = column([
      environment && card('Find project MCPs', [
      input('mcpSearch', 'Search project MCPs'), buttons([button('mcp-discover', 'Find project MCPs', dev('mcp-discover', { offset: 0 })),
        button('mcp-next', 'Next page', dev('mcp-discover', { offset: state.mcpOffset + 25 }), state.mcpOffset + discovered.length < (state.results['devtools.mcp-discover']?.data?.count || 0)), button('mcp-list', 'Refresh connections', dev('mcp-list'))]),
      select('mcp-discovered', 'Discovered MCP', discovered.map(row => ({ value: row.resource_release_uid || row.uid, label: label(row) })), state.selectedMcp, actions.selectMcp),
      button('mcp-add', 'Connect selected MCP', mut('Connect project MCP', dev('mcp-add')), discovered.some(row => row.resource_release_uid === state.selectedMcp)),
      !discovered.length && state.results['devtools.mcp-discover']?.status === 'success' && muted('No MCPs found in this environment.'),
      result('devtools.mcp-discover'),
      ]),
      environment && card('Connected MCPs', [
      select('mcp-connected', 'Connected MCP', connected.map(row => ({ value: row.resource_release_uid, label: label(row) })), state.selectedMcp, actions.selectMcp),
      buttons([button('mcp-tools', 'View tools', dev('mcp-tools'), !!state.selectedMcp),
        button('mcp-remove', 'Disconnect selected MCP', mut('Disconnect project MCP', dev('mcp-remove')), !!state.selectedMcp),
        button('mcp-register', 'Refresh Claude tools', actions.refreshTools)]),
      ]),
      environment && card('Tool explorer', [
      busy('devtools', 'mcp-tools') && muted('Loading MCP tools…'),
      Array.isArray(tools) && select('mcp-tool', 'MCP tool', tools.map(tool => ({ value: tool.name, label: clean(tool.name) })), f.mcpTool, value => actions.field('mcpTool', value)),
      Array.isArray(tools) && tools.find(tool => tool.name === f.mcpTool)?.description && text(tools.find(tool => tool.name === f.mcpTool).description),
      Array.isArray(tools) && !tools.length && muted('This MCP exposes no tools.'),
      input('mcpTool', 'Tool name'), input('mcpArguments', 'Arguments (JSON object)'),
      button('mcp-call', 'Review and call tool', mut('Call project MCP tool', dev('mcp-call'), `Call ${f.mcpTool || 'the selected tool'} with the JSON arguments shown. The operation may change remote state.`), !!state.selectedMcp && !!f.mcpTool),
      state.selectedMcp && line('Environment', environment.name),
      result('devtools.mcp-tools'), result('devtools.mcp-call'), result('mcp.registration'),
      ]),
    ]);
  }
  if (state.tab === 'Agents') body = renderAgents(ui, state, actions);
  if (state.tab === 'Activity') body = column([
    card('Session activity', [
      muted('Repository setup, project tasks, MCP actions and agent conversations from this session.'),
      state.operations.length ? line('This session', ['running', 'success', 'failure', 'cancelled'].map(status => { const count = state.operations.filter(op => op.status === status).length; return count ? `${count} ${{ running: 'running', success: 'completed', failure: 'failed', cancelled: 'cancelled' }[status]}` : ''; }).filter(Boolean).join(' · ')) : null,
    ]),
    ...(state.operations.length ? state.operations.slice().reverse().map(op => card(op.title || op.label, [
      line('Status', { running: 'Running', success: 'Completed', failure: 'Failed', cancelled: 'Cancelled' }[op.status] || op.status),
      op.context && muted(op.context), text(op.progress),
      op.status === 'running' && button(`cancel-${op.id}`, op.cancelled ? 'Cancelling…' : 'Cancel operation', () => actions.cancel(op.id), !op.cancelled),
      op.result?.effects?.message && text(op.result.effects.message),
      op.result && toggle(`activity-${op.id}`, 'View details'),
      state.expanded[`activity-${op.id}`] && Code({ source: resultText(op.result), language: 'json', wrap: 'wrap' }),
    ])) : [card('No activity yet', [
      muted('Start a repository setup, run a project task or connect an MCP. Its progress and result will appear here.'),
      buttons([button('activity-projects', 'Browse projects', () => actions.tab('Projects')), button('activity-mcp', 'Find MCPs', () => actions.tab('MCP'))]),
    ])]),
  ]);
  return page([Box({ key: 'section-content', children: [body] })]);
}
