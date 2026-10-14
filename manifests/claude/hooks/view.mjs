import { TABS, clean, record, rows, resultText } from './model.mjs';

/** A native Desktop element tree. No DOM, webview, shell command entry, or model calls. */
export function renderPane(ui, state, actions) {
  const { Box, Text, Button, Input, Select, Code } = ui;
  const text = value => Text({ children: [clean(value)] });
  const column = children => Box({ flexDirection: 'column', gap: 1, children: children.filter(Boolean) });
  const buttons = children => Box({ flexDirection: 'row', flexWrap: 'wrap', gap: 1, children: children.filter(Boolean) });
  const button = (key, label, callback, available = true) => available
    ? Button({ key, label, onPress: callback }) : text(`${label} · unavailable`);
  const input = (key, label, placeholder = '') => Input({ key: `field-${key}`, label, value: state.fields[key] || '', placeholder,
    onInput: value => actions.field(key, value), onSubmit: value => actions.field(key, value) });
  const select = (key, label, options, value, callback) => options.length ? Select({ key, label,
    options: options.some(o => o.value === value) ? options : [{ value: '', label: `Choose ${label.toLowerCase()}` }, ...options],
    value: options.some(o => o.value === value) ? value : '', onSelect: callback }) : text(`No ${label.toLowerCase()} available.`);
  const result = key => state.results[key] ? column([text(state.results[key].summary),
    state.results[key].effects && text(state.results[key].effects.message),
    state.results[key].data !== undefined && Code({ source: resultText(state.results[key]), language: 'json', wrap: 'wrap' })]) : null;
  const dev = (action, extra) => () => actions.dev(action, extra);
  const project = (action, extra) => () => actions.project(action, extra);
  const account = (action, extra) => () => actions.account(action, extra);
  const mut = (label, callback, detail = label) => () => actions.confirm(label, detail, callback);
  const f = state.fields;
  const header = column([text(`MainSequence · ${state.cwd || 'Waiting for session'} · Claude Code ${state.version || 'unknown'}`),
    buttons(TABS.map(tab => button(`tab-${tab.replaceAll(' ', '-')}`, tab === state.tab ? `• ${tab}` : tab, () => actions.tab(tab)))),
    state.problem && text(state.problem)]);
  if (state.confirmation) return column([header, text(state.confirmation.title), text(state.confirmation.detail),
    buttons([button('confirm-action', 'Confirm', actions.accept), button('dismiss-confirmation', 'Cancel', actions.dismiss)])]);
  if (!state.ready) return column([header, text('MainSequence requires a local Claude Desktop Code session with function hooks and process streaming enabled.')]);
  let body;
  if (state.tab === 'Connection') body = column([
    input('backend', 'MainSequence backend', 'https://your-mainsequence-server'),
    text('Your MainSequence login is separate from the Claude account used for model requests.'),
    buttons([button('login', 'Sign in to MainSequence', dev('login')), button('auth-status', 'Check connection', dev('auth-status', { check: true })),
      button('refresh-token', 'Renew login', dev('refresh-token')), button('logout', 'Sign out', mut('Sign out of MainSequence', dev('logout'), 'Remove the saved MainSequence login for this backend.'))]),
    result('devtools.auth-status'), result('devtools.login'), result('devtools.logout'),
  ]);
  if (state.tab === 'Projects') {
    const repositories = rows(state.results['devtools.repositories']?.data);
    const selected = repositories.find(row => row.uid === f.repositoryUid);
    const branches = rows(selected?.branches).map(row => ({ value: row.repository_branch, label: row.repository_branch }));
    const locals = rows(state.results['projects.local-repositories']?.data);
    body = column([
      buttons([button('list-repositories', 'Refresh remote repositories', dev('repositories'))]),
      select('remote-repository', 'Remote repository', repositories.map(row => ({ value: String(row.uid ?? row.repository_uid ?? row.id ?? ''), label: clean(row.code_repository_name ?? row.name ?? row.repository_name ?? row.slug ?? row.uid) })).filter(o => o.value), f.repositoryUid,
        value => actions.field('repositoryUid', value)),
      input('repositoryUid', 'Repository UID'), branches.length ? select('repository-branch', 'Branch', branches, f.branch, value => actions.field('branch', value)) : input('branch', 'Branch'), input('baseDir', 'Local repositories folder'),
      button('pick-base', 'Choose folder', project('pick-folder', { destination: 'baseDir' })),
      buttons([button('setup', 'Set up repository', mut('Set up repository', dev('setup'), 'Clone the selected repository into the local repositories folder.'), !!f.repositoryUid && !!f.branch && !!f.baseDir),
        button('setup-install', 'Set up and install', mut('Set up and install repository', dev('setup', { install: true }), 'Clone the repository and install its dependencies.'), !!f.repositoryUid && !!f.branch && !!f.baseDir)]),
      input('organization', 'Organization folder'), button('local-list', 'Refresh local repositories', project('local-repositories')),
      select('local-repository', 'Local repository', locals.map(row => ({ value: row.path, label: clean(row.name) })), state.selectedLocal, actions.selectLocal),
      buttons([button('use-local', 'Use selected repository', () => actions.useLocal(), !!state.selectedLocal),
        button('delete-local-preview', 'Review local deletion', project('delete-local-preview'), !!state.selectedLocal)]),
      result('devtools.setup'), result('projects.local-repositories'),
    ]);
  }
  if (state.tab === 'Current Project') {
    const capabilities = record(state.results['devtools.status']?.data).capabilities;
    const available = action => !Array.isArray(capabilities) || !capabilities.some(c => c.action === action && c.state !== 'available');
    const sdk = record(state.results['devtools.sdk-status']?.data);
    const sdkUpdate = available('update-sdk') && sdk.updateSupported === true && sdk.updateAvailable === true;
    body = column([
      input('root', 'Project folder'), button('pick-root', 'Choose project folder', project('pick-folder', { destination: 'root' })),
      select('project-type', 'Project type', [{ value: '', label: 'Detect automatically' }, { value: 'python', label: 'Python' }, { value: 'vite_react', label: 'Vite / React' }], f.projectType, value => actions.field('projectType', value)),
      buttons([button('project-status', 'Refresh status', dev('status')), button('project-resolve', 'Resolve repository', dev('resolve')), button('sdk-status', 'SDK status', dev('sdk-status'))]),
      buttons([button('sync', 'Sync dependencies', mut('Sync dependencies', dev('sync')), available('sync')),
        button('install', 'Install dependencies', mut('Install dependencies', dev('install')), available('install')),
        button('update-sdk-preview', 'Preview SDK update', dev('update-sdk', { dryRun: true }), sdkUpdate),
        button('update-sdk', 'Update SDK', mut('Update MainSequence SDK', dev('update-sdk')), sdkUpdate)]),
      !sdkUpdate && text(sdk.hint || 'Check SDK status to see whether this project supports an available automatic update.'),
      buttons([button('update-agents', 'Update agent instructions', mut('Update agent instructions', dev('update-agents')), available('update-agents')),
        button('skills-preview', 'Preview skill installation', dev('install-skills', { dryRun: true }), available('install-skills')),
        button('install-skills', 'Install skills', mut('Install project skills', dev('install-skills')), available('install-skills')),
        button('skills-sync', 'Sync skills', mut('Sync project skills', dev('skills-sync')), available('skills-sync')),
        button('env-cleanup', 'Clean legacy environment credentials', mut('Clean legacy credentials', dev('env-cleanup'), 'Remove migrated MainSequence credentials from the project environment file.'), available('env-cleanup'))]),
      buttons([button('open-folder', 'Open folder', dev('open-folder'), available('open-folder')),
        button('signed-terminal', 'Open signed terminal', mut('Open signed terminal', dev('signed-terminal'), 'Open a terminal with the MainSequence project environment.'), available('signed-terminal'))]),
      input('image', 'Container image', 'mainsequence-project:latest'), input('platform', 'Docker platform', 'linux/arm64'),
      buttons([button('docker-preview', 'Review Docker build', project('docker-preview')),
        button('devcontainer-preview', 'Review container configuration', project('devcontainer-preview')),
        button('open-container', 'Open container', project('open-container'))]),
      result('devtools.status'), result('devtools.sdk-status'), result('projects.open-container'),
    ]);
  }
  if (state.tab === 'Accounts') {
    const data = record(state.accountData);
    const accounts = rows(data.accounts);
    const config = record(data.config);
    const draft = state.accountDraft || config;
    const display = record(draft.display);
    const date = value => { const parsed = new Date(value); return value && Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : 'unknown'; };
    const choice = (key, label, values, value, callback) => select(key, label, values.map(value => ({ value, label: value })), value, callback);
    const setting = (key, value) => actions.accountSetting(key, value);
    const meter = (usage, style, showPercent, label) => {
      if (style === 'none') return null;
      if (typeof usage?.percentUsed !== 'number') return text(`${label}: usage unavailable`);
      const used = Math.max(0, Math.min(100, usage.percentUsed));
      const fill = display.fill === 'used' ? used : 100 - used;
      const units = Math.round(fill / 10);
      const graphic = style === 'pie' ? ['○', '◔', '◑', '◕', '●'][Math.round(fill / 25)]
        : style === 'braille' ? '⣿'.repeat(units) + '⣀'.repeat(10 - units) : '▰'.repeat(units) + '▱'.repeat(10 - units);
      return text(`${label}: ${graphic} ${display.fill === 'used' ? 'used' : 'remaining'}${showPercent === false ? '' : ` · ${used}% used`} · resets ${date(usage.resetsAt)}`);
    };
    const card = row => column([
      text(`${row.id === data.session?.activeId ? (display.active === 'tile' ? '▣ ' : display.active === 'dim' ? '◦ ' : '┃ ') : ''}${row.label || row.email || row.id} · ${row.health || 'unknown'}`),
      text(`${row.email || 'Email unavailable'} · Plan: ${row.plan || 'unknown'} · Organization: ${row.organizationName || row.organizationId || 'unknown'}`),
      text(`Login expires: ${date(row.expiresAt)} · Refresh expires: ${date(row.refreshExpiresAt)} · Active sessions: ${row.usedBySessions || 0}`),
      row.healthReason && text(row.healthReason),
      meter(row.usage?.fiveHour, display.session || 'braille', display.sessionPercent, 'Five-hour window'),
      meter(row.usage?.week, display.week || 'bars', display.weekPercent, 'Weekly window'),
      text(`Usage checked: ${date(row.usage?.checkedAt)}`),
      button(`eligible-${row.id}`, (draft.eligibleAccountIds === undefined || draft.eligibleAccountIds.includes(row.id)) ? 'Eligible for rotation · exclude' : 'Excluded from rotation · include',
        () => actions.accountEligibility(row.id), state.accountsReady),
    ]);
    body = column([
      text(`Session request account: ${state.accountSelection}. Desktop’s app login is managed separately.`),
      (state.mainTurnId || state.agentTurns?.size) && text('A Claude turn is active. Account changes are available after it finishes; automatic checks wait for that boundary.'),
      !state.accountsReady && text('Claude account APIs are unavailable in this session. Check diagnostics and the bundled engine version.'),
      input('accountLabel', 'Account label'),
      buttons([button('account-list', 'Refresh accounts', account('list'), state.accountsReady),
        button('account-add', 'Add account', mut('Add Claude account', account('add')), state.accountsReady),
        button('account-refresh', 'Check logins and usage', account('refresh'), state.accountsReady)]),
      select('account-choice', 'Claude account', accounts.map(row => ({ value: row.id, label: clean(`${row.label || row.email || row.id} · ${typeof row.health === 'string' ? row.health : row.health?.kind || 'unknown'}`) })), state.selectedAccount, actions.selectAccount),
      buttons([button('account-login', 'Sign in selected account', account('login'), state.accountsReady && !!state.selectedAccount),
        button('account-login-all', state.signingInAll ? 'Signing in accounts…' : 'Sign in all accounts needing login', mut('Sign in saved accounts', actions.signInAll, 'Open sign-in for each account that needs login, one at a time. Use Activity to cancel the current sign-in.'), state.accountsReady && !state.signingInAll && accounts.some(row => row.health === 'login-needed')),
        button('account-cancel-login', 'Cancel sign-in', account('cancel-login'), state.accountsReady && !!state.selectedAccount),
        button('account-use', 'Use for this session', mut('Change Claude request account', account('select'), 'Change which stored Claude login this Code session uses for subsequent model requests. The Desktop app account is unchanged.'), state.accountsReady && !!state.selectedAccount),
        button('account-remove', 'Remove selected account', mut('Remove Claude account', account('remove'), 'Remove this saved login only if no session holds it. This cannot be undone without signing in again.'), state.accountsReady && !!state.selectedAccount)]),
      buttons([button('account-rotate', 'Rotate now', mut('Rotate Claude request account', account('rotate'), 'Choose an eligible saved account for this Code session.'), state.accountsReady),
        button('account-release', 'Use Desktop sign-in again', mut('Restore Desktop sign-in', actions.releaseAccount), state.accountsReady),
        button('account-automatic', config.mode === 'automatic' ? 'Disable automatic rotation' : 'Enable automatic rotation',
          mut('Change automatic rotation', account('configure', { config: { ...config, mode: config.mode === 'automatic' ? 'manual' : 'automatic' } }), 'Automatic mode can change the request account between turns when usage or authentication requires it. It does not submit prompts.'), state.accountsReady && !!state.accountReference)]),
      ...accounts.map(card),
      text('Rotation settings'),
      Input({ key: 'account-five-hour-threshold', label: 'Five-hour usage threshold (%)', value: String(draft.fiveHourThreshold ?? 90), onInput: value => setting('fiveHourThreshold', value), onSubmit: value => setting('fiveHourThreshold', value) }),
      Input({ key: 'account-weekly-threshold', label: 'Weekly usage threshold (%)', value: String(draft.weeklyThreshold ?? 95), onInput: value => setting('weeklyThreshold', value), onSubmit: value => setting('weeklyThreshold', value) }),
      choice('account-organization-policy', 'Organization policy', ['same organization', 'any organization'], draft.sameOrganizationOnly === false ? 'any organization' : 'same organization', value => setting('sameOrganizationOnly', value === 'same organization')),
      choice('account-session-style', 'Five-hour display', ['bars', 'pie', 'braille', 'none'], display.session || 'braille', value => setting('display.session', value)),
      choice('account-week-style', 'Weekly display', ['bars', 'pie', 'braille', 'none'], display.week || 'bars', value => setting('display.week', value)),
      choice('account-fill-style', 'Display fill', ['left', 'used'], display.fill || 'left', value => setting('display.fill', value)),
      choice('account-active-style', 'Active account marker', ['lines', 'tile', 'dim'], display.active || 'lines', value => setting('display.active', value)),
      choice('account-session-percent', 'Five-hour percentage', ['show', 'hide'], display.sessionPercent === false ? 'hide' : 'show', value => setting('display.sessionPercent', value === 'show')),
      choice('account-week-percent', 'Weekly percentage', ['show', 'hide'], display.weekPercent === false ? 'hide' : 'show', value => setting('display.weekPercent', value === 'show')),
      button('account-save-settings', 'Save rotation and display settings', mut('Save account settings', actions.saveAccountSettings, 'Apply the displayed thresholds, organization policy, eligible accounts, and display preferences.'), state.accountsReady && !!state.accountDraft),
      ...rows(data.leases).filter(lease => lease.stale && lease.sessionId !== state.sessionId).map(lease => column([
        text(`Account ${lease.accountId} is reserved by session ${lease.sessionId}. Last heartbeat: ${date(lease.heartbeatAt)}`),
        button(`release-lease-${lease.sessionId}`, 'Release reservation for closed session', mut('Confirm the other session is closed', account('release-stale', { leaseSessionId: lease.sessionId, acknowledgeSessionClosed: true }), 'Only confirm after that Code session has closed. Releasing an active reservation can allow another session to remove its login.')),
      ])),
      result('accounts.select'), result('accounts.rotate'),
    ]);
  }
  if (state.tab === 'MCP') {
    const discovered = rows(state.results['devtools.mcp-discover']?.data);
    const connected = rows(state.results['devtools.mcp-list']?.data);
    const tools = record(state.results['devtools.mcp-tools']?.data).tools;
    body = column([
      input('mcpSearch', 'Search project MCPs'), buttons([button('mcp-discover', 'Find project MCPs', dev('mcp-discover', { offset: 0 })),
        button('mcp-next', 'Next page', dev('mcp-discover', { offset: state.mcpOffset + 25 }), discovered.length > 0), button('mcp-list', 'Refresh connections', dev('mcp-list'))]),
      select('mcp-discovered', 'Discovered MCP', discovered.map(row => ({ value: row.resource_release_uid || row.uid, label: clean(`${row.name} · ${row.mcp_connection?.organization_environment_name || ''}`) })), state.selectedMcp, actions.selectMcp),
      button('mcp-add', 'Connect selected MCP', mut('Connect project MCP', dev('mcp-add')), !!state.selectedMcp),
      select('mcp-connected', 'Connected MCP', connected.map(row => ({ value: row.resource_release_uid, label: clean(`${row.name} · ${row.mcp_connection?.organization_environment_name || ''}`) })), state.selectedMcp, actions.selectMcp),
      buttons([button('mcp-tools', 'View tools', dev('mcp-tools'), !!state.selectedMcp),
        button('mcp-remove', 'Disconnect selected MCP', mut('Disconnect project MCP', dev('mcp-remove')), !!state.selectedMcp),
        button('mcp-register', 'Refresh Claude tools', actions.refreshTools)]),
      Array.isArray(tools) && select('mcp-tool', 'MCP tool', tools.map(tool => ({ value: tool.name, label: clean(tool.name) })), f.mcpTool, value => actions.field('mcpTool', value)),
      input('mcpTool', 'Tool name'), input('mcpArguments', 'Arguments (JSON object)'),
      button('mcp-call', 'Review and call tool', mut('Call project MCP tool', dev('mcp-call'), `Call ${f.mcpTool || 'the selected tool'} with the JSON arguments shown. The operation may change remote state.`), !!state.selectedMcp && !!f.mcpTool),
      result('devtools.mcp-tools'), result('devtools.mcp-call'), result('mcp.registration'),
    ]);
  }
  if (state.tab === 'Activity') body = column(state.operations.length ? state.operations.slice().reverse().map(op => column([
    text(`${op.label} · ${op.status}`), text(op.progress), op.status === 'running' && button(`cancel-${op.id}`, 'Cancel operation', () => actions.cancel(op.id)),
    op.result && Code({ source: resultText(op.result), language: 'json', wrap: 'wrap' }),
  ])) : [text('No operations have run in this session.')]);
  if (state.tab === 'Settings') body = column([
    input('nodePath', 'Node 22+ executable'), input('claudeExecutable', 'Claude executable for account sign-in', 'Automatically locate the Desktop bundled engine'),
    button('save-settings', 'Save these settings', actions.saveSettings),
    button('diagnostics', 'Run diagnostics', project('runtime-diagnostics')), result('projects.runtime-diagnostics'),
    text('Folder, signed-terminal, and container actions report availability from the host. An unavailable host action never silently opens a different client.'),
  ]);
  return column([header, body, state.operations.some(op => op.status === 'running') && text('Operations are running. Open Activity for progress or cancellation.')]);
}

export function renderBand(ui, state, actions, beneath) {
  const { Box, Text, Button } = ui;
  return Box({ flexDirection: 'row', gap: 1, children: [beneath,
    Button({ key: 'mainsequence-open', label: 'MainSequence', onPress: actions.open }),
    Text({ children: [state.operations.some(op => op.status === 'running') ? 'Working · view Activity' : state.accountSelection] }),
  ].filter(Boolean) });
}
