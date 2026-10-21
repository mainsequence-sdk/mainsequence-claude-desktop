import { clean } from './model.mjs';
import { STATUS } from './primitives.mjs';

/** Command Center's wording for a run that answers 404: it never says whether the record exists. */
export const HIDDEN_DEPLOYMENT = "You can't see this deployment. A deployment is shown to the people who can see its release or Job.";
const ACTIVE = new Set(['pending', 'queued', 'running']);
/** One state vocabulary for runs, workflow steps and deployment stages, mapped onto the host's status colours. */
const STEP_KIND = { succeeded: 'success', completed: 'success', active: 'success', running: 'warning',
  failed: 'error', error: 'error', errored: 'error', cancelled: 'info', canceled: 'info', pending: 'info', queued: 'info',
  blocked: 'info', skipped: 'info', superseded: 'info', stopped: 'info' };
const COLOUR = { success: '#2f9e5b', warning: '#d99a1b', error: '#d64545', info: '#8a8a8a' };

export const stepKind = state => STEP_KIND[String(state || '').toLowerCase()] || 'info';
export const stateLabel = state => { const value = clean(state || 'unknown').replace(/_/g, ' '); return value.charAt(0).toUpperCase() + value.slice(1); };
export const kindLabel = run => run?.kind === 'workflow_run' ? 'Workflow run' : 'Deployment';
export const isActiveRun = run => !!run && (ACTIVE.has(String(run.state)) || (run.deploymentRuns || []).some(owned => ACTIVE.has(String(owned.state))));
export const runTitle = run => run.kind === 'workflow_run' ? `${run.repositoryName || 'Workflow'} · ${run.workflowPath ? run.workflowPath.split('/').pop() : 'workflow'}` : run.targetLabel || run.repositoryName || 'Deployment';
export const stepLabel = step => step.key || step.name || step.id || 'step';
const parse = value => { const time = value ? Date.parse(value) : NaN; return Number.isFinite(time) ? time : null; };
const two = value => String(value).padStart(2, '0');

export function formatDuration(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '';
  const seconds = Math.floor(ms / 1000), minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60);
  if (hours) return `${hours}h ${minutes % 60}m`;
  if (minutes) return `${minutes}m ${seconds % 60}s`;
  return seconds ? `${seconds}s` : '<1s';
}
export function formatWhen(iso) {
  const time = parse(iso);
  if (time === null) return '';
  const date = new Date(time);
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}
/** `HH:MM:SS.mmm` for a log line; entries without a timestamp keep the column aligned. */
export function logTimestamp(iso) {
  const time = parse(iso);
  if (time === null) return '            ';
  const date = new Date(time);
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}
export const failedStep = run => (run?.steps || []).find(step => stepKind(step.state) === 'error') || null;
/** A workflow run opens its first failed step, else its deploy step, else the first; a deployment its first failed, else running, else first stage. */
export function defaultStep(run) {
  const steps = run?.steps || [];
  return failedStep(run) || (run?.kind === 'workflow_run' ? steps.find(step => step.operation === 'deploy') : steps.find(step => stepKind(step.state) === 'warning')) || steps[0] || null;
}
/** Where a step's logs come from: a deployment run (optionally one stage), or a reason there are none. */
export function logSource(run, step) {
  if (!run || !step) return { reason: 'Choose a step to see its logs.' };
  if (run.kind === 'deployment_run') return { runUid: run.uid, stepUid: step.uid || null };
  if (step.deploymentRunUid) return (run.deploymentRuns || []).some(owned => owned.uid === step.deploymentRunUid) ? { runUid: step.deploymentRunUid, stepUid: null } : { reason: HIDDEN_DEPLOYMENT };
  if (step.operation === 'run_job') return { reason: 'Job run logs are shown in Command Center.' };
  if (['pending', 'blocked', 'skipped', 'superseded'].includes(String(step.state))) return { reason: `This step did not run${step.reason ? `: ${step.reason.replace(/_/g, ' ')}` : ''}.` };
  return { reason: 'This step has no deployment logs.' };
}
export function logText(entries, limit = 90000) {
  const lines = entries.slice().sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)).map(entry => `${logTimestamp(entry.timestamp)} ${entry.text}`);
  let text = lines.join('\n');
  if (text.length > limit) text = `… earlier lines omitted\n${text.slice(text.length - limit)}`;
  return text;
}

/** Step bars on the run's clock: small markup, fixed colours by state, labels in the host's text colour. */
export function timelineSvg(run, nowIso) {
  const steps = (run?.steps || []).slice(0, 40);
  const now = parse(nowIso) ?? Date.now();
  const starts = steps.map(step => parse(step.startedAt)).filter(value => value !== null);
  const t0 = parse(run.startedAt) ?? parse(run.createdAt) ?? (starts.length ? Math.min(...starts) : now);
  const ends = steps.map(step => parse(step.finishedAt) ?? (parse(step.startedAt) !== null && stepKind(step.state) === 'warning' ? now : parse(step.startedAt))).filter(value => value !== null);
  const t1 = Math.max(parse(run.finishedAt) ?? (isActiveRun(run) ? now : t0), ...ends, t0 + 1000);
  const span = Math.max(1, t1 - t0);
  const W = 360, L = 112, R = 10, ROW = 14, PAD = 4, H = PAD * 2 + ROW * Math.max(1, steps.length);
  const x = time => L + Math.max(0, Math.min(1, (time - t0) / span)) * (W - L - R);
  const escape = value => String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
  const parts = steps.map((step, index) => {
    const y = PAD + index * ROW, colour = COLOUR[stepKind(step.state)];
    const label = `<text x="0" y="${y + 10}" font-size="10" font-family="system-ui,sans-serif" fill="currentColor">${escape(clean(stepLabel(step)).slice(0, 18))}</text>`;
    const start = parse(step.startedAt);
    if (start === null) return `${label}<circle cx="${W - R - 2}" cy="${y + 7}" r="3" fill="none" stroke="${colour}" stroke-width="1.5"/>`;
    const end = parse(step.finishedAt) ?? (stepKind(step.state) === 'warning' ? now : start);
    const x0 = x(start), x1 = Math.max(x0 + 2, x(end));
    return `${label}<rect x="${x0.toFixed(1)}" y="${y + 3}" width="${(x1 - x0).toFixed(1)}" height="8" rx="2" fill="${colour}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><style>:root{color:#202020}@media(prefers-color-scheme:dark){:root{color:#eeeeee}}</style>`
    + `<line x1="${L}" y1="${PAD}" x2="${L}" y2="${H - PAD}" stroke="#8a8a8a" stroke-opacity="0.4"/>${parts.join('')}</svg>`;
}

/** Plain text for the model tool: identity, state, timings, steps in plan order and owned runs. */
export function describeRun(run, nowIso) {
  const glyph = state => STATUS[stepKind(state)].glyph;
  const lines = [`${run.repositoryName || 'Unknown repository'} · ${run.branchName || 'unknown branch'} · ${run.commit || 'no commit'}`,
    `${kindLabel(run)}${run.kind === 'workflow_run' ? ` ${run.workflowPath}` : run.targetLabel ? ` of ${run.targetLabel}` : ''} — ${stateLabel(run.state)}${run.outcome ? ` (${run.outcome})` : ''}${run.reason ? ` · ${run.reason}` : ''}`,
    `${run.startedAt ? `Started ${formatWhen(run.startedAt)}` : `Created ${formatWhen(run.createdAt)}`}${run.finishedAt ? ` · finished ${formatWhen(run.finishedAt)}` : ''}${run.durationMs !== null && run.durationMs !== undefined ? ` · ${formatDuration(run.durationMs)}${isActiveRun(run) ? ` as of ${formatWhen(nowIso)}` : ''}` : ''}`];
  if (run.error) lines.push(`Error: ${run.error}`);
  lines.push('Steps:');
  for (const step of run.steps || []) {
    const detail = [step.operation && `${step.operation}${step.resourceKey ? ` · ${step.resourceKey}` : ''}`, step.kind && step.kind].filter(Boolean).join(' ');
    lines.push(`  ${glyph(step.state)} ${stepLabel(step)}${detail ? ` (${detail})` : ''} — ${stateLabel(step.state).toLowerCase()}${step.durationMs !== null && step.durationMs !== undefined ? ` · ${formatDuration(step.durationMs)}` : ''}${step.needs?.length ? ` · needs ${step.needs.join(', ')}` : ''}${step.reason ? ` · ${step.reason.replace(/_/g, ' ')}` : ''}${step.error ? ` · ${step.error}` : ''}`);
  }
  if (!(run.steps || []).length) lines.push('  (none yet)');
  if (run.deploymentRuns?.length) lines.push(`Deployments: ${run.deploymentRuns.map(owned => `${owned.targetLabel || owned.targetType} — ${stateLabel(owned.state).toLowerCase()}`).join(' · ')}`);
  if (run.kind === 'deployment_run' && run.workflowRun) lines.push(`Started by workflow run ${run.workflowRun.workflowPath} (${run.workflowRun.uid}) — ${stateLabel(run.workflowRun.state).toLowerCase()}`);
  lines.push(`Run uid: ${run.uid}`);
  return lines.join('\n');
}

function glyphs(p, steps, key) {
  const done = steps.filter(step => stepKind(step.state) === 'success').length;
  return p.inline([...steps.slice(0, 40).map((step, index) => p.Text({ key: `${key}-${index}`, color: STATUS[stepKind(step.state)].color, children: [STATUS[stepKind(step.state)].glyph] })),
    p.caption(`${done}/${steps.length} steps`)], { key, flexWrap: 'wrap' });
}
const runMeta = run => [run.repositoryName, run.branchName, run.commit].filter(Boolean).join(' · ');
const runTiming = run => `${run.startedAt ? `Started ${formatWhen(run.startedAt)}` : run.createdAt ? `Created ${formatWhen(run.createdAt)}` : 'Not started'}${run.finishedAt ? ` · finished ${formatWhen(run.finishedAt)}` : ''}${run.durationMs !== null && run.durationMs !== undefined ? ` · ${formatDuration(run.durationMs)}` : ''}`;

/** The Code detail card: the latest run of the checked-out branch, its progress rail and the way into the detail and list. */
export function renderDeployCard(p, state, actions, target) {
  const { caption, muted, status, column, inline, buttons, button, badge, card } = p;
  const environment = state.fields.mcpEnvironment;
  const latest = target.branchUid ? state.deployLatest[target.branchUid] : null, entry = latest?.entry;
  return card('Deploys', [
    !environment && caption('Choose an organization environment in the header to see deployments.'),
    environment && !target.branchUid && caption(target.repositoryUid ? 'Check status to match this checkout with its MainSequence branch.' : 'This folder is not a known MainSequence repository checkout.'),
    environment && target.branchUid && latest?.loading && !entry && muted('Loading deployments…'),
    latest?.error && status('error', latest.error),
    entry && column([
      inline([status(stepKind(entry.state), stateLabel(entry.state)), badge(kindLabel(entry)), entry.kind === 'deployment_run' && entry.targetLabel && caption(entry.targetLabel)], { flexWrap: 'wrap' }),
      caption(runMeta(entry) || runMeta(target) || 'Repository unknown'), caption(runTiming(entry)),
      entry.steps?.length ? glyphs(p, entry.steps, `deploy-rail-${entry.uid}`) : null,
      buttons([button(`deploy-open-${entry.uid}`, 'Open run', () => actions.openDeployment(entry.uid, entry.kind, 'code'), { primary: true })]),
    ], { gap: 0 }),
    environment && target.branchUid && latest && !latest.loading && !latest.error && !entry && muted('No deployments for this branch yet.'),
    environment && buttons([button('deploy-all', 'All deployments', () => actions.openDeployments('code'), { plain: true }),
      target.branchUid && button('deploy-refresh', latest?.loading ? 'Refreshing…' : 'Refresh', actions.refreshDeployments, { plain: true, dim: true, available: !latest?.loading })]),
  ]);
}

/** One Home line: the latest run of the session repository's branch, when that branch is known. */
export function renderHomeDeployLine(p, state, actions, target) {
  const latest = target.branchUid ? state.deployLatest[target.branchUid] : null, entry = latest?.entry;
  if (!entry) return null;
  return p.row('home-deploy', [p.inline([p.muted('Deploy'), p.status(stepKind(entry.state), `${stateLabel(entry.state)} · ${kindLabel(entry)}`)], { flexWrap: 'wrap' }), p.caption(`${runMeta(entry)} · ${runTiming(entry)}`)],
    [p.button('home-deploy-view', 'View', () => actions.openDeployment(entry.uid, entry.kind, 'home'), { plain: true })]);
}

/** The environment-wide list and the run detail, drawn in place of the Code section's own body. */
export function renderDeployments(p, state, actions, environment) {
  const { Code, Svg, Text, muted, caption, heading, title, status, column, inline, buttons, line, card, button, row, badge, empty } = p;
  if (state.deployView === 'list') {
    const list = state.deployList, entries = list?.entries || [];
    return column([
      button('deploy-back', '← Code', actions.closeDeployments, { plain: true, dim: true }),
      inline([heading('Deployments'), list && caption(`${environment?.name || 'Environment'} · ${list.count} ${list.count === 1 ? 'entry' : 'entries'}`)], { justifyContent: 'space-between', flexWrap: 'wrap' }),
      state.deployListLoading && !entries.length && muted('Loading deployments…'),
      state.deployListError && status('error', state.deployListError),
      ...entries.map(entry => row(`deploy-row-${entry.uid}`, [
        inline([Text({ color: STATUS[stepKind(entry.state)].color, children: [STATUS[stepKind(entry.state)].glyph] }),
          button(`deploy-open-${entry.uid}`, runTitle(entry), () => actions.openDeployment(entry.uid, entry.kind, 'list'), { plain: true })]),
        caption(`${runMeta(entry)} · ${runTiming(entry)}`),
        entry.steps?.length ? glyphs(p, entry.steps, `deploy-rail-${entry.uid}`) : null,
      ], [badge(stateLabel(entry.state), stepKind(entry.state)), badge(kindLabel(entry))])),
      list && !entries.length && !state.deployListLoading && empty('No deployments', 'Deployments and workflow runs of this environment appear here.'),
      list && entries.length < list.count ? button('deploy-more', state.deployListLoading ? 'Loading…' : 'Load more', actions.moreDeployments, { plain: true, available: !state.deployListLoading }) : null,
      inline([state.deployPaused ? caption('Auto-refresh paused after an hour.') : entries.some(isActiveRun) ? caption('Refreshing every 30 s while a run is active.') : null,
        button('deploy-refresh', state.deployListLoading ? 'Refreshing…' : 'Refresh', actions.refreshDeployments, { plain: true, dim: true, available: !state.deployListLoading })], { justifyContent: 'flex-end' }),
    ]);
  }
  const detail = state.deployDetail;
  const back = button('deploy-back', state.deployHistory.length ? '← Workflow run' : state.deployOrigin === 'list' ? '← Deployments' : state.deployOrigin === 'home' ? '← Home' : '← Code', actions.deployBack, { plain: true, dim: true });
  if (!detail) return column([back, muted('Loading the run…')]);
  if (detail.hidden) return column([back, heading(detail.kind === 'workflow_run' ? 'Workflow run' : 'Deployment'), status('info', HIDDEN_DEPLOYMENT)]);
  const run = detail.run;
  if (!run) return column([back, heading('Deployment'), detail.error ? status('error', detail.error) : muted('Loading the run…'),
    detail.error && button('deploy-retry', 'Try again', actions.refreshDeployments, { plain: true })]);
  const steps = run.steps || [];
  const selected = steps.find(step => step.id === state.deployStep) || defaultStep(run);
  const source = logSource(run, selected), logs = state.deployLogs;
  const current = !!logs && !source.reason && logs.runUid === source.runUid && (logs.stepUid || null) === (source.stepUid || null);
  const ownedListed = uid => (run.deploymentRuns || []).some(owned => owned.uid === uid);
  return column([
    back,
    inline([heading(runTitle(run)), badge(kindLabel(run))], { flexWrap: 'wrap' }),
    status(stepKind(run.state), `${stateLabel(run.state)}${run.outcome ? ` · ${run.outcome.replace(/_/g, ' ')}` : ''}${run.reason ? ` · ${run.reason.replace(/_/g, ' ')}` : ''}`),
    caption(`${runMeta(run) || 'Repository unknown'}${run.workflowPath ? ` · ${run.workflowPath}` : ''}${run.kind === 'deployment_run' && run.targetLabel ? ` · ${run.targetLabel}` : ''}`),
    caption(`${runTiming(run)}${isActiveRun(run) ? ` · as of ${formatWhen(detail.now)}` : ''}`),
    run.error && status('error', run.error),
    detail.error && status('warning', detail.error),
    run.kind === 'deployment_run' && run.workflowRun && inline([caption(`Started by workflow ${run.workflowRun.workflowPath}${run.workflowStepKeys?.length ? ` · serves ${run.workflowStepKeys.join(', ')}` : ''}`),
      button(`deploy-workflow-${run.workflowRun.uid}`, 'Open workflow run', () => actions.openDeployment(run.workflowRun.uid, 'workflow_run', 'detail'), { plain: true })], { flexWrap: 'wrap' }),
    // Native keys live on Boxes; the Svg is a plain image inside its keyed slot, like agent icons.
    steps.length ? p.Box({ key: 'deploy-timeline', flexShrink: 0, children: [Svg({ source: timelineSvg(run, detail.now), alt: `Timeline of ${steps.length} ${run.kind === 'workflow_run' ? 'steps' : 'stages'} on the run's clock`, width: 360, isInteractive: false })] }) : null,
    inline([title(run.kind === 'workflow_run' ? 'Steps' : 'Stages'), isActiveRun(run) && caption(state.deployPaused ? 'Auto-refresh paused after an hour.' : 'Refreshing every 10 s while active.')], { justifyContent: 'space-between', flexWrap: 'wrap' }),
    ...steps.map(step => row(`deploy-step-row-${step.id}`, [
      button(`deploy-step-${step.id}`, `${STATUS[stepKind(step.state)].glyph} ${stepLabel(step)}`, () => actions.selectDeployStep(step.id), selected?.id === step.id ? {} : { plain: true }),
      caption([step.operation && `${step.operation}${step.resourceKey ? ` · ${step.resourceKey}` : ''}`, step.name && step.name !== step.key && step.name, step.kind, step.needs?.length && `needs ${step.needs.join(', ')}`,
        step.reason && step.reason.replace(/_/g, ' ')].filter(Boolean).join(' · ')),
    ], [badge(stateLabel(step.state), stepKind(step.state)), step.durationMs !== null && step.durationMs !== undefined ? badge(formatDuration(step.durationMs)) : null])),
    !steps.length && muted('This run has no steps yet.'),
    selected && card(`${run.kind === 'workflow_run' ? 'Step' : 'Stage'} ${stepLabel(selected)}`, [
      line('State', stateLabel(selected.state), stepKind(selected.state)),
      selected.startedAt && line('Started', formatWhen(selected.startedAt)),
      selected.finishedAt && line('Finished', formatWhen(selected.finishedAt)),
      selected.durationMs !== null && selected.durationMs !== undefined && line('Duration', formatDuration(selected.durationMs)),
      selected.needs?.length && line('Needs', selected.needs.join(', ')),
      selected.outcome && line('Outcome', selected.outcome.replace(/_/g, ' ')),
      selected.reason && line(stepKind(selected.state) === 'info' ? 'Skip reason' : 'Reason', selected.reason.replace(/_/g, ' ')),
      selected.error && status('error', selected.error),
      selected.deploymentRunUid && (ownedListed(selected.deploymentRunUid)
        ? button(`deploy-step-open-${selected.deploymentRunUid}`, 'Open deployment', () => actions.openDeployment(selected.deploymentRunUid, 'deployment_run', 'detail'), { plain: true })
        : caption(HIDDEN_DEPLOYMENT)),
    ]),
    selected && column([
      inline([title('Logs'), source.reason ? null : caption(source.stepUid ? stepLabel(selected) : run.kind === 'workflow_run' ? `deployment ${source.runUid.slice(0, 8)}` : 'all stages')]),
      source.reason && muted(source.reason),
      !source.reason && state.deployLogsLoading && (!current || !logs.entries.length) && muted('Loading logs…'),
      current && logs.hidden && status('info', HIDDEN_DEPLOYMENT),
      current && logs.error && status('error', logs.error),
      current && !logs.hidden && !logs.error && (logs.entries.length ? p.Box({ key: 'deploy-logs', children: [Code({ source: logText(logs.entries), language: 'text', wrap: 'wrap' })] })
        : muted(logs.complete ? 'No log entries for this step.' : 'No log entries yet.')),
      current && !logs.hidden && buttons([
        button('deploy-logs-older', 'Older', actions.deployLogsOlder, { plain: true, available: logs.previous.length > 0 && !state.deployLogsLoading }),
        caption(`${logs.entries.length} ${logs.entries.length === 1 ? 'entry' : 'entries'}${logs.complete ? '' : ' · more available'}`),
        button('deploy-logs-newer', 'Newer', actions.deployLogsNewer, { plain: true, available: !!logs.nextCursor && !state.deployLogsLoading }),
        button('deploy-logs-refresh', 'Refresh', actions.refreshDeployments, { plain: true, dim: true, available: !state.deployLogsLoading }),
      ]),
    ], { gap: 0 }),
    run.kind === 'workflow_run' && run.deploymentRuns?.length ? title('Deployments') : null,
    ...(run.kind === 'workflow_run' ? run.deploymentRuns || [] : []).map(owned => row(`deploy-owned-${owned.uid}`, [
      button(`deploy-open-${owned.uid}`, owned.targetLabel || owned.targetType || owned.uid, () => actions.openDeployment(owned.uid, 'deployment_run', 'detail'), { plain: true }),
      caption([owned.targetType, owned.workflowStepKeys?.length && `serves ${owned.workflowStepKeys.join(', ')}`, owned.startedAt && `started ${formatWhen(owned.startedAt)}`].filter(Boolean).join(' · ')),
    ], [badge(stateLabel(owned.state), stepKind(owned.state))])),
  ]);
}
