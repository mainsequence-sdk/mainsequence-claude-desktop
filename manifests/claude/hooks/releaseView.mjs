import { clean } from './model.mjs';
import { STATUS } from './primitives.mjs';
import { stateLabel, formatDuration, formatWhen } from './deploymentView.mjs';

/** Releases: read-only history of the environment's APIs, agents and static sites. Nothing here deploys. */
export const HIDDEN_RELEASE = "You can't see this release. A release is shown to the people it is shared with.";
export const RELEASE_DAYS = [7, 30, 90];
const KINDS = [['', 'All kinds'], ['fastapi', 'APIs'], ['harness_agent', 'Agents'], ['static_site', 'Static sites']];
const ACTIVE = new Set(['queued', 'running']);
const SOURCES = { repository_event: 'Repository push', manual: 'Manual', create: 'Created', system_reconciliation: 'Reconciliation' };

/** A run's outcome on the host's status colours: blocked did not deploy, so it reads as a failure here. */
export const runKind = state => ({ succeeded: 'success', failed: 'error', blocked: 'error', queued: 'warning', running: 'warning' })[String(state || '')] || 'info';
export const isDeploying = run => !!run && ACTIVE.has(String(run.state));
export const humanize = code => { const value = clean(code || '').replace(/_/g, ' ').trim(); return value ? value.charAt(0).toUpperCase() + value.slice(1) : ''; };
export const sourceLabel = source => SOURCES[source] || humanize(source);
export const percent = rate => rate === null || rate === undefined || !Number.isFinite(rate) ? '—' : `${Math.round(rate * 100)}%`;
export function ago(iso, nowIso) {
  const then = Date.parse(iso || ''), now = Date.parse(nowIso || '') || Date.now();
  if (!Number.isFinite(then)) return '';
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}
const elapsed = (run, nowIso) => {
  const start = Date.parse(run?.startedAt || run?.createdAt || ''), now = Date.parse(nowIso || '') || Date.now();
  return Number.isFinite(start) ? formatDuration(Math.max(0, now - start)) : '';
};
const stage = run => run.stepsTotal ? `stage ${Math.min(run.stepsDone + 1, run.stepsTotal)} of ${run.stepsTotal}` : 'starting';
const place = row => [row.repositoryName, row.branchName].filter(Boolean).join(' · ');
const revisionText = revision => revision ? `${revision.commit || 'unknown commit'}${revision.configurationRevision !== null && revision.configurationRevision !== undefined ? ` (revision ${revision.configurationRevision})` : ''}` : '';
/** The right-hand summary of a release row: a failure first, else how many of the recent runs deployed. */
export function recentText(row, nowIso) {
  const last = row.lastRun;
  if (!last) return { kind: 'info', text: 'No runs' };
  if (runKind(last.state) === 'error') return { kind: 'error', text: `${stateLabel(last.state)} ${ago(last.finishedAt || last.createdAt, nowIso)}`.trim() };
  const recent = row.recent || [];
  return { kind: 'info', text: `${recent.filter(item => item.state === 'succeeded').length} of ${recent.length} ok` };
}

export function renderReleases(p, state, actions, { environment, target }) {
  return state.releaseDetail ? renderReleaseDetail(p, state, actions) : renderReleaseList(p, state, actions, { environment, target });
}

function dots(p, recent, key) {
  return p.inline((recent || []).slice(0, 10).map((run, index) => p.Text({ key: `${key}-${index}`, color: STATUS[runKind(run.state)].color, children: [STATUS[runKind(run.state)].glyph] })), { key, gap: 0 });
}
function pollNote(p, state, deploying) {
  return state.releasePaused ? p.caption('Auto-refresh paused after an hour.') : deploying ? p.caption('Checking every 30 s while a release deploys.') : null;
}

function renderReleaseList(p, state, actions, { environment, target }) {
  const { muted, caption, heading, status, column, inline, buttons, button, row, badge, card, empty } = p;
  const list = state.releases, entries = list?.results || [], watch = state.releaseWatch;
  const deploying = entries.filter(entry => isDeploying(entry.activeRun));
  return column([
    inline([heading('Releases'), caption(`${environment?.name || 'Environment'}${list ? ` · ${list.count} ${list.count === 1 ? 'release' : 'releases'} · last ${list.days} days` : ''}`)],
      { justifyContent: 'space-between', flexWrap: 'wrap' }),
    buttons([...KINDS.map(([kind, label]) => button(`releases-kind-${kind || 'all'}`, label, () => actions.releasesKind(kind), state.releaseKind === kind ? { primary: true } : { plain: true, dim: true })),
      (target?.branchUid || state.releaseMine) && button('releases-mine', 'This repository', actions.releasesMine, state.releaseMine ? { primary: true } : { plain: true, dim: true })]),
    state.releasesLoading && !list && muted('Loading releases…'),
    state.releasesError && status('error', state.releasesError),
    deploying.length ? card('Deploying', deploying.map(entry => {
      const run = entry.activeRun, watched = watch?.runUid === run.uid;
      return row(`release-active-${entry.uid}`, [
        button(`release-open-active-${entry.uid}`, entry.name || 'Release', () => actions.openRelease(entry.uid), { plain: true }),
        caption([run.commit || 'no commit', stage(run), elapsed(run, list.now)].filter(Boolean).join(' · ')),
      ], [watched ? badge('Watching', 'warning') : button(`release-watch-${entry.uid}`, 'Notify me', () => actions.watchRelease(entry.uid), { plain: true })]);
    })) : null,
    ...entries.map(entry => {
      const summary = recentText(entry, list.now);
      return row(`release-row-${entry.uid}`, [
        inline([button(`release-open-${entry.uid}`, entry.name || 'Release', () => actions.openRelease(entry.uid), { plain: true }), badge(entry.kindLabel || humanize(entry.kind))], { flexWrap: 'wrap' }),
        caption(place(entry) || 'No runs in this window'),
      ], [entry.recent?.length ? dots(p, entry.recent, `release-dots-${entry.uid}`) : null, summary.kind === 'error' ? status('error', summary.text) : caption(summary.text)]);
    }),
    list && !entries.length && !state.releasesLoading && empty('No releases', state.releaseKind || state.releaseMine ? 'No releases match these filters.' : 'APIs, agents and static sites of this environment appear here.'),
    list && entries.length < list.count ? button('releases-more', state.releasesLoading ? 'Loading…' : 'Load more', actions.moreReleases, { plain: true, available: !state.releasesLoading }) : null,
    list?.runsTruncated ? caption(`Run history uses the newest ${list.runsCounted} of ${list.runsInWindow} runs of these ${list.days} days.`) : null,
    entries.length ? caption('Newest run on the left: ● succeeded · ! failed or blocked · ◌ deploying · ○ superseded, cancelled or skipped.') : null,
    inline([pollNote(p, state, deploying.length),
      button('releases-all-deployments', 'All deployments, including jobs and images', () => actions.openDeployments('releases'), { plain: true, dim: true }),
      button('releases-refresh', state.releasesLoading ? 'Refreshing…' : 'Refresh', actions.refreshReleases, { plain: true, dim: true, available: !state.releasesLoading })],
    { justifyContent: 'flex-end', flexWrap: 'wrap' }),
  ]);
}

function tile(p, key, label, value) {
  return p.Box({ key, flexDirection: 'column', gap: 0, paddingX: 1, borderStyle: 'round', borderDimColor: true, children: [p.caption(label), p.title(value)] });
}

function renderReleaseDetail(p, state, actions) {
  const { muted, caption, heading, title, status, column, inline, buttons, button, row, badge } = p;
  const detail = state.releaseDetail, data = detail.data, back = button('release-back', '← Releases', actions.closeRelease, { plain: true, dim: true });
  if (!data) return column([back, detail.error ? status('error', detail.error) : muted('Loading the release…')]);
  if (data.hidden) return column([back, heading('Release'), status('info', HIDDEN_RELEASE)]);
  const release = data.release, stats = data.stats, runs = data.runs || [], last = runs[0], watch = state.releaseWatch;
  const deploying = runs.find(isDeploying);
  const serving = revisionText(release.activeRevision), wanted = revisionText(release.desiredRevision);
  return column([
    back,
    inline([heading(release.name || 'Release'), last ? badge(isDeploying(last) ? 'Deploying' : `Last run ${stateLabel(last.state).toLowerCase()}`, runKind(last.state)) : null], { justifyContent: 'space-between', flexWrap: 'wrap' }),
    caption([release.kindLabel || humanize(release.kind), place(release)].filter(Boolean).join(' · ')),
    serving || wanted ? caption(`${serving ? `Serving ${serving}` : 'Nothing serving yet'}${wanted && wanted !== serving ? ` · wanted ${wanted}` : ''}`) : null,
    detail.error && status('error', detail.error),
    deploying && inline([status('warning', `Deploying ${deploying.commit || ''} · ${stage(deploying)} · ${elapsed(deploying, data.now)}`.replace(/ +·/g, ' ·')),
      watch?.runUid === deploying.uid ? badge('Watching', 'warning') : button('release-watch', 'Notify me', () => actions.watchRelease(release.uid), { plain: true })], { flexWrap: 'wrap' }),
    buttons(RELEASE_DAYS.map(days => button(`release-days-${days}`, `${days} days`, () => actions.releaseDays(days), state.releaseDays === days ? { primary: true } : { plain: true, dim: true }))),
    inline([tile(p, 'release-stat-runs', 'Runs', String(stats.runs)), tile(p, 'release-stat-rate', 'Succeeded', percent(stats.successRate)),
      tile(p, 'release-stat-median', 'Median time', formatDuration(stats.medianMs) || '—'),
      tile(p, 'release-stat-slowest', 'Slowest stage', stats.slowestStage ? `${stats.slowestStage.name} · ${formatDuration(stats.slowestStage.medianMs)}` : '—')], { flexWrap: 'wrap', alignItems: 'stretch' }),
    stats.commonFailure ? caption(`Most common failure: ${humanize(stats.commonFailure.code)} (${stats.commonFailure.count} of ${stats.commonFailure.of})`) : null,
    data.truncated ? caption(`Stats from the newest ${data.counted} of ${data.count} runs.`) : null,
    title('Runs'),
    ...runs.map(run => row(`release-run-${run.uid}`, [
      button(`release-run-open-${run.uid}`, `${formatWhen(run.startedAt || run.createdAt)} · ${run.commit || 'no commit'}`, () => actions.openReleaseRun(run.uid), { plain: true }),
      caption([sourceLabel(run.source), run.stepsTotal ? `${run.stepsDone} of ${run.stepsTotal} stages` : '', formatDuration(run.durationMs), run.error].filter(Boolean).join(' · ')),
    ], [badge(stateLabel(run.state), runKind(run.state))])),
    !runs.length && muted(`No runs in the last ${data.days} days.`),
    inline([pollNote(p, state, !!deploying),
      button('release-refresh', detail.loading ? 'Refreshing…' : 'Refresh', actions.refreshReleases, { plain: true, dim: true, available: !detail.loading })], { justifyContent: 'flex-end', flexWrap: 'wrap' }),
  ]);
}

/** Plain text for the model tool. */
export function describeReleaseRow(row, nowIso) {
  const glyph = STATUS[runKind(row.lastRun?.state)].glyph, stats = row.stats || {};
  const parts = [`${row.lastRun ? glyph : '·'} ${row.name || 'Release'} (${row.kindLabel || humanize(row.kind)})`, place(row) || 'no runs in the window'];
  if (row.lastRun) parts.push(`last run ${stateLabel(row.lastRun.state).toLowerCase()} ${ago(row.lastRun.finishedAt || row.lastRun.createdAt, nowIso)} at ${row.lastRun.commit || 'unknown commit'}`);
  if (stats.runs) parts.push(`${stats.runs} runs, ${percent(stats.successRate)} succeeded`);
  if (row.activeRun) parts.push(`DEPLOYING ${row.activeRun.commit || ''} ${stage(row.activeRun)} (run ${row.activeRun.uid})`.replace(/ +/g, ' '));
  parts.push(`uid ${row.uid}`);
  return parts.join(' · ');
}
export function describeActiveRun(run, nowIso) {
  return `◌ ${run.targetLabel || 'Deployment'} · ${[run.repositoryName, run.branchName].filter(Boolean).join('/') || 'unknown repository'} · ${run.commit || 'no commit'} · ${stateLabel(run.state).toLowerCase()} · ${stage(run)} · running ${elapsed(run, nowIso)} · run ${run.uid}`;
}
export function describeReleaseHistory(data, environment) {
  const release = data.release, stats = data.stats;
  const lines = [`Environment: ${environment}`, `${release.name} (${release.kindLabel || humanize(release.kind)}) · ${place(release) || 'no runs in the window'} · uid ${release.uid}`,
    `Serving: ${revisionText(release.activeRevision) || 'nothing yet'}${release.desiredRevision && revisionText(release.desiredRevision) !== revisionText(release.activeRevision) ? ` · wanted: ${revisionText(release.desiredRevision)}` : ''}`,
    `Last ${data.days} days: ${stats.runs} runs${data.truncated ? ` (newest ${data.counted} of ${data.count})` : ''} · ${stats.succeeded} succeeded, ${stats.failed} failed, ${stats.blocked} blocked, ${stats.superseded} superseded, ${stats.cancelled} cancelled, ${stats.active} deploying · success rate ${percent(stats.successRate)}`,
    `Time (succeeded runs): median ${formatDuration(stats.medianMs) || '—'}, 90th percentile ${formatDuration(stats.p90Ms) || '—'}${stats.slowestStage ? ` · slowest stage ${stats.slowestStage.name} (median ${formatDuration(stats.slowestStage.medianMs)})` : ''}`];
  if (stats.commonFailure) lines.push(`Most common failure: ${stats.commonFailure.code} (${stats.commonFailure.count} of ${stats.commonFailure.of})`);
  lines.push('Runs, newest first:');
  for (const run of (data.runs || []).slice(0, 25)) lines.push(`  ${STATUS[runKind(run.state)].glyph} ${formatWhen(run.startedAt || run.createdAt)} · ${run.commit || 'no commit'} · ${stateLabel(run.state).toLowerCase()} · ${sourceLabel(run.source).toLowerCase()} · ${run.stepsDone}/${run.stepsTotal} stages${run.durationMs !== null && run.durationMs !== undefined ? ` · ${formatDuration(run.durationMs)}` : ''}${run.errorCode || run.error ? ` · ${run.errorCode || ''}${run.error ? ` ${run.error}` : ''}`.replace(/ +/g, ' ') : ''} · run ${run.uid}`);
  if (!(data.runs || []).length) lines.push('  (none)');
  return lines.join('\n');
}
