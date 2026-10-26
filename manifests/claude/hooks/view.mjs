import { TABS, clean, record, rows, resultText, mcpDisplayName, basename, setupKey, deployTarget, allOperations } from './model.mjs';
import { primitives, OPERATION_STATUS, OPERATION_KIND } from './primitives.mjs';
import { renderAgents } from './agentView.mjs';
import { renderProjects } from './projectView.mjs';
import { renderDeployCard, renderDeployments, renderHomeDeployLine } from './deploymentView.mjs';
import { EMBLEM } from './branding.mjs';

const VIEW_NOUN = { Code: 'your repositories', Projects: 'its projects', Agents: 'its agents', Tools: 'its MCP tools' };

export function signedInState(state) {
  const auth = state.results['devtools.auth-status'];
  const session = record(auth?.data);
  return { auth, session, signedIn: auth?.status === 'success' && session.authenticated === true,
    signedOut: auth?.data?.authenticated === false || auth?.error?.code === 'NOT_AUTHENTICATED' };
}

/** Drawn when the host refused a tree or startup failed: nothing is replayed. */
export function renderRecovery(ui, state, actions) {
  return ui.Box({ flexDirection: 'column', gap: 1, padding: 1, children: [
    ui.Text({ weight: 'semibold', children: ['MainSequence could not display this screen.'] }),
    ui.Text({ dimColor: true, children: ['Your running operations have not been restarted.'] }),
    ui.Text({ dimColor: true, size: 'caption', children: [clean([state.paneFault?.phase, state.paneFault?.element].filter(Boolean).join(' · '))] }),
    ui.Button({ key: 'retry-pane', label: 'Retry display', variant: 'primary', onPress: actions.retryPane }),
  ] });
}

/** Host-themed Desktop primitives: a status header, one row of sections, and list-to-detail views. */
export function renderPane(ui, state, actions, options = {}) {
  const p = primitives(ui, state, actions);
  const { Box, Code, Svg, text, muted, caption, heading, title, status, column, inline, buttons, line, card, button, toggle, input, select, row, badge, result, empty } = p;
  const dev = (action, extra) => () => actions.dev(action, extra);
  const project = (action, extra) => () => actions.project(action, extra);
  const mut = (label, callback, detail = label) => () => actions.confirm(label, detail, callback);
  const f = state.fields;
  // Controls wait for this session's own operations; counts and progress cover every session's.
  const busy = (scope, action) => state.operations.some(op => op.status === 'running' && op.label === `${scope} · ${action}`);
  const operations = allOperations(state);
  const running = operations.filter(op => op.status === 'running').length;
  const runningSetups = operations.filter(op => op.setupTarget && op.status === 'running');
  const { auth, session, signedIn, signedOut } = signedInState(state);
  const environments = rows(state.results['devtools.mcp-environments']?.data);
  const environment = environments.find(r => r.uid === f.mcpEnvironment);

  // Header: account, environment, running operations and settings on every view.
  const account = state.initializing ? muted('Checking…')
    : signedIn ? status('success', session.username || 'Signed in')
    : auth?.status === 'failure' ? status('error', 'Connection needs attention')
    : button('login', busy('devtools', 'login') ? 'Opening sign-in…' : 'Sign in', dev('login'), { primary: true, available: !busy('devtools', 'login') });
  const environmentControl = state.environmentsLoading ? muted('Loading environments…')
    : environments.length ? select('mcp-environment', '', environments.map(r => ({ value: r.uid, label: clean(r.name) })), f.mcpEnvironment, actions.selectEnvironment, 'Choose environment')
    : signedIn || signedOut === false ? button('mcp-environments', 'Choose environment', actions.refreshEnvironments, { plain: true, dim: true }) : null;
  const chips = inline([account, environmentControl,
    button('tab-Activity', running ? `${running} running` : 'Activity', () => actions.tab('Activity'), { plain: true, dim: !running && state.tab !== 'Activity' }),
    button('tab-Settings', 'Settings', () => actions.tab('Settings'), { plain: true, dim: state.tab !== 'Settings' }),
  ], { flexWrap: 'wrap', justifyContent: 'flex-end' });
  const brand = inline([Svg({ source: EMBLEM, alt: 'MainSequence emblem', width: 24, height: 24 }), heading('MainSequence')]);
  const navigation = Box({ key: 'section-navigation', flexDirection: 'row', flexWrap: 'wrap', gap: 1, children: TABS.map(tab =>
    button(`tab-${tab}`, tab, () => actions.tab(tab), tab === state.tab ? { primary: true } : { plain: true, dim: true })) });
  const blocker = (() => {
    if (!state.ready) return null;
    if (auth?.status === 'failure') return status('error', auth.summary);
    if (signedOut && VIEW_NOUN[state.tab]) return status('warning', `Sign in to MainSequence to see ${VIEW_NOUN[state.tab]}.`);
    if (['Projects', 'Agents', 'Tools'].includes(state.tab) && !f.mcpEnvironment && !state.environmentsLoading) {
      return inline([status('warning', `Choose an organization environment to see ${VIEW_NOUN[state.tab]}.`),
        !environments.length && !signedOut && button('blocker-environments', 'Load environments', actions.refreshEnvironments, { plain: true })]);
    }
    if (state.tab === 'Code' && !f.baseDir) return inline([status('warning', 'Choose a repositories folder before setting up repositories.'), button('blocker-folder', 'Choose folder', project('pick-folder', { destination: 'baseDir' }), { plain: true })]);
    return null;
  })();
  const header = column([
    options.placement === 'dock' ? inline([brand, Box({ flexGrow: 1 }), chips], { justifyContent: 'space-between', flexWrap: 'wrap' }) : column([brand, chips]),
    navigation, blocker,
    state.tab !== 'Activity' && runningSetups.some(op => !(state.tab === 'Code' && state.codeDetail && !state.codeDetail.root && op.setupTarget === setupKey(f)))
      ? column(runningSetups.filter(op => !(state.tab === 'Code' && state.codeDetail && !state.codeDetail.root && op.setupTarget === setupKey(f))).map(op =>
      inline([status('warning', `Setting up ${op.context}: ${op.progress}`), button(`show-setup-activity-${op.id}`, 'View progress', () => actions.tab('Activity'), { plain: true, dim: true })], { flexWrap: 'wrap' })), { gap: 0 }) : null,
    state.workspaceAttachment && inline([status(state.workspaceAttachment.error ? 'error' : state.workspaceAttachment.running ? 'warning' : 'success', state.workspaceAttachment.message),
      state.workspaceAttachment.error && button('workspace-attach-retry', 'Retry adding repositories', actions.attachWorkspace, { plain: true })], { flexWrap: 'wrap' }),
    state.problem && status('error', state.problem),
  ]);
  const page = body => Box({ flexDirection: 'column', gap: 1, padding: 1, children: [header, ...body.filter(Boolean)] });
  if (!state.booted) return page([muted('Loading MainSequence…')]);
  if (!state.ready) return page([card('Update required', [text('Update Claude Desktop to use MainSequence in a local Code session.')])]);
  // A pending confirmation sits above the view it belongs to; the header and navigation stay.
  const confirmation = state.confirmation && Box({ flexDirection: 'column', gap: 1, paddingX: 1, paddingY: 1, borderStyle: 'round', borderColor: 'warning', children: [
    title(state.confirmation.title),
    state.confirmation.detail.split('\n').length > 3 ? Code({ source: clean(state.confirmation.detail), language: 'text', wrap: 'wrap' }) : text(state.confirmation.detail, { wrap: 'wrap' }),
    buttons([button('confirm-action', 'Confirm', actions.accept, { primary: true }), button('dismiss-confirmation', 'Cancel', actions.dismiss)]),
  ] });
  const gated = blocker && (signedOut || (['Projects', 'Agents', 'Tools'].includes(state.tab) && !f.mcpEnvironment));
  let body = null;

  if (state.tab === 'Home') {
    const projectStatus = record(state.results['devtools.status']?.data), context = record(projectStatus.project);
    const sdk = record(state.results['devtools.sdk-status']?.data);
    const forSession = !f.root || f.root === state.cwd;
    const sdkLine = sdk.updateAvailable === true ? ['warning', `${sdk.installed || 'SDK'} → ${sdk.latest || 'newer'} available`] : sdk.installed ? ['success', `${sdk.installed} up to date`] : null;
    const recent = operations.slice(-3).reverse();
    const steps = [
      !signedIn && !state.initializing && { key: 'login', label: 'Sign in with your browser', detail: 'Browse projects, agents and tools with your MainSequence account.' },
      signedIn && !f.mcpEnvironment && { key: 'environment', label: 'Choose an organization environment', detail: 'Projects, agents and tools are scoped to one environment.' },
      !f.baseDir && { key: 'folder', label: 'Choose a repositories folder', detail: 'Repositories and project workspaces are created there.' },
    ].filter(Boolean);
    body = column([
      steps.length ? card('Next steps', steps.map(step => row(`step-row-${step.key}`, [title(step.label), caption(step.detail)], [
        step.key === 'login' && button('step-login', 'Sign in', dev('login'), { primary: true, available: !busy('devtools', 'login') }),
        step.key === 'environment' && (environments.length ? null : button('step-environments', 'Load environments', actions.refreshEnvironments, { primary: true })),
        step.key === 'folder' && button('step-folder', 'Choose folder', project('pick-folder', { destination: 'baseDir' }), { primary: true }),
      ]))) : null,
      card('This session', [
        row('home-session', [title(basename(state.cwd) || 'Current folder'), caption(state.cwd)], [
          button('home-open-code', 'Open in Code', () => actions.openCode({ root: state.cwd }), { plain: true })]),
        forSession && context.branch && line('Branch', context.branch),
        forSession && sdkLine && line('SDK', sdkLine[1], sdkLine[0]),
        forSession && renderHomeDeployLine(p, state, actions, deployTarget(state, { root: state.cwd })),
        forSession && !state.results['devtools.status'] && caption(busy('devtools', 'status') ? 'Checking the repository…' : 'Repository status has not been checked yet.'),
        !forSession && caption(`Code is targeting ${f.root}.`),
        buttons([button('home-status', busy('devtools', 'status') ? 'Checking…' : 'Check status', actions.checkHomeStatus, { available: !busy('devtools', 'status') }),
          forSession && sdk.updateAvailable === true && sdk.updateSupported === true && button('home-update-sdk', 'Update SDK', mut('Update MainSequence SDK', dev('update-sdk')), { primary: true }),
          signedIn && f.mcpEnvironment && button('home-deployments', 'All deployments', () => actions.openDeployments('home'), { plain: true, dim: true })]),
        forSession && result('devtools.status'),
      ]),
      card('Recent', recent.length ? [
        ...recent.map(op => row(`recent-${op.id}`, [title(op.title || op.label), caption(op.progress)], [badge(OPERATION_STATUS[op.status] || op.status, OPERATION_KIND[op.status])])),
        button('home-activity', 'See all activity', () => actions.tab('Activity'), { plain: true, dim: true }),
      ] : [muted('Nothing has run yet.'), buttons([button('home-projects', 'Set up a project', () => actions.tab('Projects'), { plain: true }), button('home-agents', 'Talk to an agent', () => actions.tab('Agents'), { plain: true })])]),
    ]);
  }

  if (state.tab === 'Code') body = renderCode(p, state, actions, { dev, project, mut, busy, gated, environment });

  if (state.tab === 'Projects') body = gated ? null : renderProjects(ui, state, actions);
  if (state.tab === 'Agents') body = gated ? null : renderAgents(ui, state, actions);
  if (state.tab === 'Tools') body = gated ? null : renderTools(p, state, actions, { dev, mut, busy, environment });

  if (state.tab === 'Activity') body = column([
    inline([heading('Activity'), operations.length ? caption(['running', 'success', 'failure', 'cancelled', 'stale'].map(kind => {
      const count = operations.filter(op => op.status === kind).length; return count ? `${count} ${OPERATION_STATUS[kind].toLowerCase()}` : '';
    }).filter(Boolean).join(' · ')) : null], { justifyContent: 'space-between' }),
    ...(operations.length ? operations.slice().reverse().map(op => column([
      row(`activity-row-${op.id}`, [inline([status(OPERATION_KIND[op.status], OPERATION_STATUS[op.status] || op.status), title(op.title || op.label)]),
        (op.context || op.remote) && caption([op.context, op.remote && `Session ${op.session || 'elsewhere'}`].filter(Boolean).join(' · ')),
        text(op.progress, { wrap: 'wrap', ...(op.status === 'failure' ? { color: 'error' } : {}) })], [
        // Only the session that runs an operation can stop it.
        op.status === 'running' && !op.remote && button(`cancel-${op.id}`, op.cancelled ? 'Cancelling…' : 'Cancel operation', () => actions.cancel(op.id), { plain: true, available: !op.cancelled }),
        op.result && toggle(`activity-${op.id}`, 'Details')]),
      op.result?.effects?.message && status('warning', op.result.effects.message),
      state.expanded[`activity-${op.id}`] && Code({ source: resultText(op.result), language: 'json', wrap: 'wrap' }),
    ])) : [empty('No activity yet', 'Set up a repository, connect an MCP or talk to an agent. Progress and results appear here.',
      [button('activity-projects', 'Open Code', () => actions.tab('Code'), { plain: true }), button('activity-mcp', 'Open Tools', () => actions.tab('Tools'), { plain: true })])]),
  ]);

  if (state.tab === 'Settings') {
    const diagnostics = record(state.results['projects.runtime-diagnostics']?.data);
    body = column([
      card('MainSequence account', [
        state.initializing ? muted('Checking your saved connection…') : signedIn ? status('success', `Signed in as ${session.username || 'MainSequence account'}`) : auth?.status === 'failure' ? status('error', auth.summary) : muted('Sign in with your browser to use projects, agents and tools.'),
        signedIn && caption(session.checked ? 'Connection verified' : 'Using your saved MainSequence session'),
        buttons([!signedIn && button('settings-login', busy('devtools', 'login') ? 'Opening sign-in…' : 'Sign in with browser', dev('login'), { primary: true, available: !busy('devtools', 'login') }),
          button('auth-status', 'Check connection', dev('auth-status', { check: true })),
          signedIn && toggle('connection-actions', 'Manage account')]),
        state.expanded['connection-actions'] && buttons([button('refresh-token', 'Renew session', dev('refresh-token')), button('logout', 'Sign out', mut('Sign out of MainSequence', dev('logout'), 'Remove the saved MainSequence login for this backend.'), { dim: true })]),
        ...['login', 'refresh-token', 'logout'].map(action => state.results[`devtools.${action}`]).filter(value => value?.status === 'failure').map(value => status('error', value.summary)),
      ]),
      card('Workspace', [
        input('baseDir', 'Code repositories folder'),
        buttons([button('pick-base', 'Choose folder', project('pick-folder', { destination: 'baseDir' }), { plain: true })]),
        input('backend', 'Backend URL'),
        input('commandCenterUrl', 'Command Center URL (optional)'),
        caption('Changes apply to every MainSequence session.'),
        state.preferencesLoading && muted('Loading workspace settings…'),
        state.results['projects.workspace-preferences']?.status === 'failure' && status('warning', 'Saved workspace preferences could not be read. Check the displayed values before continuing.'),
      ]),
      card('Advanced', [
        toggle('runtime', 'Runtime & diagnostics'),
        state.expanded.runtime && column([
          line('Claude Code', state.version || 'Unknown'),
          diagnostics.version && line('Plugin', diagnostics.version), diagnostics.nodeVersion && line('Node.js', diagnostics.nodeVersion),
          diagnostics.bundleHealth && line('Plugin files', Object.values(diagnostics.bundleHealth).every(Boolean) ? 'Ready' : 'Needs attention', Object.values(diagnostics.bundleHealth).every(Boolean) ? 'success' : 'error'),
          button('diagnostics', 'Run diagnostics', project('runtime-diagnostics')),
          state.results['projects.runtime-diagnostics']?.status === 'failure' && status('error', state.results['projects.runtime-diagnostics'].summary),
          toggle('runtime-paths', 'Executable overrides'),
          state.expanded['runtime-paths'] && input('nodePath', 'Node.js executable', 'node'),
          state.results['projects.runtime-diagnostics'] && toggle('runtime-details', 'Details'),
          state.expanded['runtime-details'] && Code({ source: resultText(state.results['projects.runtime-diagnostics']), language: 'json', wrap: 'wrap' }),
        ]),
        toggle('local-location', 'Local discovery'),
        state.expanded['local-location'] && column([input('organization', 'Organization folder'), button('local-list', 'Scan local repositories', project('local-repositories'), { available: !!f.baseDir && !!f.organization, reason: 'Needs a repositories folder and an organization folder.' })]),
      ]),
    ]);
  }
  return page([confirmation, Box({ key: 'section-content', children: [body].filter(Boolean) })]);
}

function renderCode(p, state, actions, { dev, project, mut, busy, gated, environment }) {
  const { Code, text, muted, caption, heading, title, status, column, inline, buttons, line, card, button, toggle, input, select, row, badge, result, empty } = p;
  const f = state.fields;
  // Deployments are remote state drawn in place of the Code body: the environment-wide list or one run.
  if (state.deployView) return renderDeployments(p, state, actions, environment);
  const listed = state.results['devtools.repositories'];
  const remote = rows(listed?.data);
  const locals = rows(state.results['projects.local-repositories']?.data);
  const localFor = uid => locals.find(r => String(r.repositoryUid) === String(uid));
  const typeLabel = r => r.code_repository_type === 'vite_react' ? 'Vite / React' : r.primary_language || r.code_repository_type || 'Repository';
  const detail = state.codeDetail;
  if (detail) {
    const selected = remote.find(r => String(r.uid) === String(detail.repositoryUid));
    const local = detail.root;
    const back = button('code-back', '← Code', actions.closeCode, { plain: true, dim: true });
    if (!local) {
      // Remote-only repository: choose a branch, then set it up under the repositories folder.
      const branches = rows(selected?.branches).map(r => ({ value: r.repository_branch, label: r.repository_branch }));
      const name = selected?.code_repository_name || selected?.name || detail.repositoryUid;
      const setup = allOperations(state).findLast(op => op.setupTarget === setupKey(f));
      const settingUp = setup?.status === 'running';
      return column([back, heading(name), caption(`${selected ? typeLabel(selected) : 'Repository'} · not on this computer`),
        card('Set up', [
          select('repository-branch', 'Branch', branches, f.branch, value => actions.field('branch', value)),
          !branches.length && muted('This repository has no branches available for setup yet.'),
          line('Destination', f.baseDir || 'Choose a repositories folder in Settings'),
          toggle('setup-install', state.expanded['setup-install'] ? 'Install dependencies after setup' : 'Install dependencies after setup (off)'),
          buttons([button('setup', settingUp ? 'Setting up…' : 'Set up', () => actions.setup(!!state.expanded['setup-install']),
            { primary: true, available: !!f.branch && !!f.baseDir && !settingUp, reason: settingUp ? '' : !f.baseDir ? 'Choose a repositories folder first.' : !f.branch ? 'Choose a branch first.' : '' })]),
          setup && column([
            status(settingUp ? 'warning' : setup.status === 'success' ? 'success' : setup.status === 'cancelled' ? 'info' : 'error',
              settingUp ? 'Setting up locally…' : setup.status === 'success' ? 'Local setup completed' : setup.status === 'cancelled' ? 'Setup cancelled' : 'Setup failed'),
            caption(setup.context), text(setup.progress, { wrap: 'wrap' }),
            settingUp && !setup.remote && button('cancel-setup', setup.cancelled ? 'Cancelling…' : 'Cancel setup', () => actions.cancel(setup.id), { plain: true, available: !setup.cancelled }),
            setup.result?.effects && status('warning', setup.result.effects.message),
            setup.status === 'failure' && caption('Review the error and any partial changes before starting setup again.'),
            setup.result?.data?.root && button('setup-open', 'Open local repository', () => actions.openCode({ root: setup.result.data.root, repositoryUid: detail.repositoryUid }), { primary: true }),
            button('setup-activity', 'View activity', () => actions.tab('Activity'), { plain: true, dim: true }),
          ], { gap: 0 }),
        ])]);
    }
    const capabilities = record(state.results['devtools.status']?.data).capabilities;
    const context = record(record(state.results['devtools.status']?.data).project);
    const available = action => !Array.isArray(capabilities) || !capabilities.some(c => c.action === action && c.state !== 'available');
    const reason = action => Array.isArray(capabilities) ? capabilities.find(c => c.action === action && c.state !== 'available')?.reason || '' : '';
    const sdk = record(state.results['devtools.sdk-status']?.data);
    const sdkUpdate = available('update-sdk') && sdk.updateSupported === true && sdk.updateAvailable === true;
    const sdkLine = sdk.updateAvailable === true ? ['warning', `${sdk.installed || 'installed'} → ${sdk.latest || 'newer'} available`] : sdk.installed ? ['success', `${sdk.installed} up to date`] : sdk.hint ? ['info', sdk.hint] : null;
    return column([
      inline([back, local === state.cwd && badge('This session')], { justifyContent: 'space-between' }),
      heading(basename(local)), caption(local),
      card('Status', [
        input('root', 'Folder'), buttons([button('pick-root', 'Choose folder', project('pick-folder', { destination: 'root' }), { plain: true, dim: true })]),
        select('project-type', 'Repository type', [{ value: '', label: 'Detect automatically' }, { value: 'python', label: 'Python' }, { value: 'vite_react', label: 'Vite / React' }], f.projectType, value => actions.field('projectType', value)),
        context.branch && line('Branch', `${context.branch}${context.commit ? ` · ${String(context.commit).slice(0, 7)}` : ''}`),
        context.projectType && line('Type', context.projectType === 'vite_react' ? 'Vite / React' : context.projectType),
        sdkLine && line('SDK', sdkLine[1], sdkLine[0]),
        !state.results['devtools.status'] && caption(busy('devtools', 'status') ? 'Checking the repository…' : 'Status has not been checked yet.'),
        buttons([button('project-status', busy('devtools', 'status') ? 'Checking…' : 'Check status', dev('status'), { available: !busy('devtools', 'status') }),
          button('sdk-status', 'Check SDK', dev('sdk-status'), { plain: true }), button('project-resolve', 'Detect repository', dev('resolve'), { plain: true, dim: true })]),
        result('devtools.status'), result('devtools.sdk-status'),
      ]),
      renderDeployCard(p, state, actions, deployTarget(state, detail)),
      card('Dependencies', [
        buttons([button('sync', 'Sync dependencies', mut('Sync dependencies', dev('sync')), { primary: true, available: available('sync'), reason: reason('sync') }),
          button('install', 'Install dependencies', mut('Install dependencies', dev('install')), { available: available('install'), reason: reason('install') }),
          sdkUpdate && button('update-sdk-preview', 'Preview SDK update', dev('update-sdk', { dryRun: true }), { plain: true }),
          sdkUpdate && button('update-sdk', 'Update SDK', mut('Update MainSequence SDK', dev('update-sdk'))),
        ]),
        !sdkUpdate && caption(sdk.hint || 'Check SDK to see whether an automatic update is available.'),
      ]),
      card('Instructions and skills', [
        buttons([button('update-agents', 'Update instructions', mut('Update agent instructions', dev('update-agents')), { available: available('update-agents'), reason: reason('update-agents') }),
          button('install-skills', 'Install skills', mut('Install repository skills', dev('install-skills')), { available: available('install-skills'), reason: reason('install-skills') }),
          toggle('code-skills-more', 'More')]),
        state.expanded['code-skills-more'] && buttons([
          button('skills-preview', 'Preview skill installation', dev('install-skills', { dryRun: true }), { plain: true, available: available('install-skills') }),
          button('skills-sync', 'Sync skills', mut('Sync repository skills', dev('skills-sync')), { plain: true, available: available('skills-sync') }),
          button('env-cleanup', 'Remove old credentials from .env', mut('Remove old credentials', dev('env-cleanup'), 'Remove migrated MainSequence credentials from the repository environment file.'), { plain: true, available: available('env-cleanup') })]),
      ]),
      card('More', [
        buttons([button('open-folder', 'Open folder', dev('open-folder'), { plain: true, available: available('open-folder') }),
          button('signed-terminal', 'Terminal', mut('Open signed terminal', dev('signed-terminal'), 'Open a terminal with the MainSequence repository environment.'), { plain: true, available: available('signed-terminal'), reason: reason('signed-terminal') }),
          toggle('code-container', 'Containers'),
          state.selectedLocal === local && button('delete-local-preview', 'Delete local copy…', project('delete-local-preview'), { plain: true, dim: true })]),
        state.expanded['code-container'] && column([
          input('image', 'Container image', 'mainsequence-project:latest'), input('platform', 'Docker platform', 'linux/arm64'),
          buttons([button('docker-preview', 'Review Docker build', project('docker-preview')),
            button('devcontainer-preview', 'Review container configuration', project('devcontainer-preview')),
            button('open-container', 'Open container', project('open-container'), { plain: true })]),
          result('projects.open-container'),
        ]),
      ]),
    ]);
  }
  // List: the session folder, every remote repository with its local state, and local copies.
  const search = f.codeSearch.trim().toLowerCase();
  const matches = name => !search || String(name || '').toLowerCase().includes(search);
  const items = [];
  const seen = new Set();
  for (const r of remote) {
    const local = localFor(r.uid);
    if (local) seen.add(local.path);
    const name = r.code_repository_name || r.name || r.uid;
    if (!matches(name)) continue;
    if (state.codeFilter === 'local' && !local) continue;
    items.push({ key: `repository-${r.uid}`, name, meta: `${typeLabel(r)}${rows(r.branches).length ? ` · ${rows(r.branches).length} ${rows(r.branches).length === 1 ? 'branch' : 'branches'}` : ''}`, local: local?.path, uid: r.uid });
  }
  for (const local of locals) {
    if (seen.has(local.path) || !matches(local.name) || local.path === state.cwd) continue;
    items.push({ key: `local-${local.path}`, name: local.name, meta: local.isGitRepository === false ? 'Folder' : 'Local repository', local: local.path, uid: local.repositoryUid || '' });
  }
  return column([
    inline([p.grow(p.Input({ key: 'field-codeSearch', value: f.codeSearch, placeholder: 'Search repositories', onInput: value => actions.field('codeSearch', value), onSubmit: value => actions.field('codeSearch', value) })),
      button('code-filter-all', 'All', () => actions.codeFilter('all'), state.codeFilter === 'all' ? {} : { plain: true, dim: true }),
      button('code-filter-local', 'Local', () => actions.codeFilter('local'), state.codeFilter === 'local' ? {} : { plain: true, dim: true }),
      button('list-repositories', state.repositoriesLoading ? 'Loading…' : 'Refresh', actions.refreshRepositories, { plain: true, dim: true, available: !state.repositoriesLoading })], { flexWrap: 'wrap' }),
    !search && state.codeFilter === 'all' && row('code-session', [inline([title(basename(state.cwd) || 'Current folder'), badge('This session')]), caption(state.cwd)],
      [button('code-open-session', 'Open', () => actions.openCode({ root: state.cwd }), { plain: true })]),
    gated ? null : listed?.status === 'failure' && status('error', listed.summary),
    gated ? null : state.results['projects.local-repositories']?.status === 'failure' && status('warning', state.results['projects.local-repositories'].summary),
    ...items.map(item => row(item.key, [inline([title(item.name), item.local && badge('Local', 'success')]), caption(item.meta)], [
      item.local ? button(`open-${item.key}`, 'Open', () => actions.openCode({ root: item.local, repositoryUid: item.uid }), { plain: true })
        : button(`setup-${item.key}`, 'Set up', () => actions.openCode({ repositoryUid: item.uid }), { primary: true })])),
    !gated && listed?.status === 'success' && !items.length && empty(search ? 'No matching repositories' : state.codeFilter === 'local' ? 'No local copies yet' : 'No repositories', search ? 'Try another search.' : 'Repositories available to your account appear here.'),
    !gated && !listed && !state.repositoriesLoading && empty('Repositories', 'Load the repositories available to your MainSequence account.', [button('code-load', 'Load repositories', actions.refreshRepositories, { primary: true })]),
  ]);
}

function renderTools(p, state, actions, { dev, mut, busy, environment }) {
  const { text, muted, caption, heading, title, status, column, inline, buttons, line, card, button, toggle, input, select, row, badge, result, empty } = p;
  const f = state.fields;
  const matches = r => r.mcp_connection?.organization_environment_uid === f.mcpEnvironment;
  const connected = rows(state.results['devtools.mcp-list']?.data).filter(matches);
  const discovered = rows(state.results['devtools.mcp-discover']?.data).filter(matches);
  const registered = Object.values(state.mcpTools);
  const toolCount = release => registered.filter(entry => entry.releaseUid === release).length;
  const connection = connected.find(r => r.resource_release_uid === state.selectedMcp);
  if (state.toolsView === 'detail' && connection) {
    const tools = rows(record(state.results['devtools.mcp-tools']?.data).tools);
    return column([
      button('tools-back', '← Tools', actions.closeTool, { plain: true, dim: true }),
      heading(mcpDisplayName(connection)), caption(`${environment?.name || 'Environment'} · ${toolCount(connection.resource_release_uid)} tools registered for Claude`),
      buttons([button('mcp-tools', busy('devtools', 'mcp-tools') ? 'Loading tools…' : 'Reload tools', dev('mcp-tools'), { plain: true, available: !busy('devtools', 'mcp-tools') }),
        button('mcp-remove', 'Disconnect', mut('Disconnect MCP', dev('mcp-remove'), `Disconnect ${mcpDisplayName(connection)} from ${environment?.name || 'this environment'}.`), { plain: true, dim: true })]),
      state.results['devtools.mcp-tools']?.status === 'failure' && status('error', state.results['devtools.mcp-tools'].summary),
      ...tools.map(tool => row(`tool-${tool.name}`, [title(tool.name), tool.description && caption(tool.description)], [])),
      state.results['devtools.mcp-tools']?.status === 'success' && !tools.length && muted('This MCP exposes no tools.'),
      caption('Tools are available to Claude from the next prompt; each call asks for approval.'),
      toggle('tools-advanced', 'Advanced'),
      state.expanded['tools-advanced'] && card('Call a tool directly', [
        tools.length && select('mcp-tool', 'Tool', tools.map(tool => ({ value: tool.name, label: clean(tool.name) })), f.mcpTool, value => actions.field('mcpTool', value)),
        input('mcpTool', 'Tool name'), input('mcpArguments', 'Arguments (JSON)'),
        buttons([button('mcp-call', 'Call tool', mut('Call MCP tool', dev('mcp-call'), `Call ${f.mcpTool || 'the selected tool'} with the JSON arguments shown. The operation may change remote state.`), { available: !!f.mcpTool, reason: 'Choose a tool first.' }),
          button('mcp-register', 'Re-register tools', actions.refreshTools, { plain: true, dim: true })]),
        caption('Re-register when Claude cannot see tools that this MCP exposes.'),
        result('devtools.mcp-call'), result('mcp.registration'),
      ]),
    ]);
  }
  if (state.toolsView === 'add') {
    const page = state.results['devtools.mcp-discover']?.data;
    const total = page?.count || 0;
    const connectedIds = new Set(connected.map(r => r.resource_release_uid));
    return column([
      button('tools-back', '← Tools', actions.closeTool, { plain: true, dim: true }),
      heading('Add MCP'), caption(`Search the MCPs released in ${environment?.name || 'this environment'}.`),
      inline([p.grow(p.Input({ key: 'field-mcpSearch', value: f.mcpSearch, placeholder: 'Search MCPs', autoFocus: true, onInput: value => actions.field('mcpSearch', value), onSubmit: value => { actions.field('mcpSearch', value); actions.dev('mcp-discover', { offset: 0 }); } })),
        button('mcp-discover', busy('devtools', 'mcp-discover') ? 'Searching…' : 'Search', dev('mcp-discover', { offset: 0 }), { primary: true, available: !busy('devtools', 'mcp-discover') })]),
      ...discovered.map(r => row(`mcp-discovered-${r.resource_release_uid || r.uid}`, [title(mcpDisplayName(r)), caption(r.mcp_connection?.organization_environment_name || environment?.name || '')], [
        connectedIds.has(r.resource_release_uid) ? badge('Connected', 'success')
          : button(`mcp-add-${r.resource_release_uid}`, 'Connect', () => actions.connectMcp(r.resource_release_uid, mcpDisplayName(r)), { available: !!r.resource_release_uid })])),
      state.results['devtools.mcp-discover']?.status === 'failure' && status('error', state.results['devtools.mcp-discover'].summary),
      state.results['devtools.mcp-discover']?.status === 'success' && !discovered.length && muted('No MCPs found in this environment.'),
      state.mcpOffset + discovered.length < total && button('mcp-next', 'Load more', dev('mcp-discover', { offset: state.mcpOffset + 25 }), { plain: true }),
      result('devtools.mcp-add'),
    ]);
  }
  return column([
    inline([heading(`Connected in ${environment?.name || 'environment'}`), button('tools-add', 'Add MCP', actions.openAddMcp, { primary: true })], { justifyContent: 'space-between' }),
    ...connected.map(r => row(`mcp-connected-${r.resource_release_uid}`, [button(`mcp-open-${r.resource_release_uid}`, mcpDisplayName(r), () => actions.openTool(r.resource_release_uid), { plain: true }),
      inline([status('success', 'Connected'), caption(`${toolCount(r.resource_release_uid)} tools`)])], [
      button(`mcp-remove-${r.resource_release_uid}`, 'Disconnect', () => actions.disconnectMcp(r.resource_release_uid, mcpDisplayName(r)), { plain: true, dim: true })])),
    !connected.length && empty('No MCPs connected', 'Connect an MCP release to give Claude its tools in this environment.'),
    state.results['devtools.mcp-list']?.status === 'failure' && status('error', state.results['devtools.mcp-list'].summary),
    (state.results['mcp.registration']?.status === 'failure' || rows(state.results['mcp.registration']?.data?.unavailable).length > 0) && status('warning', state.results['mcp.registration'].summary),
    inline([caption('Tools become available to Claude on the next prompt.'), button('mcp-list', 'Refresh', dev('mcp-list'), { plain: true, dim: true })], { justifyContent: 'space-between' }),
    result('devtools.mcp-remove'),
  ]);
}
