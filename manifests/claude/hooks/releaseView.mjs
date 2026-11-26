import { clean } from './model.mjs';
import { STATUS } from './primitives.mjs';
import { stateLabel, formatDuration, formatWhen, blockedText } from './deploymentView.mjs';

/** Releases: the environment's deployment history of resource releases, as in Command Center. Nothing here deploys. */
export const RELEASE_DAYS = [1, 7, 30, 90];
/** The history opens on the last day; longer windows are read only when chosen. */
export const HISTORY_DAYS = 1;
export const dayLabel = days => days === 1 ? '1 day' : `${days} days`;
/** `last day`, `last 7 days`. */
export const windowText = days => days === 1 ? 'last day' : `last ${days} days`;
const KINDS = [['', 'All types'], ['fastapi', 'APIs'], ['harness_agent', 'Agents'], ['static_site', 'Static sites']];
const ACTIVE = new Set(['queued', 'running']);
const SOURCES = { repository_event: 'Repository event', manual: 'Manual', create: 'Create', system_reconciliation: 'System reconciliation' };

/** Command Center's state tones on the host's status colours. */
export const deploymentKind = state => ({ succeeded: 'success', failed: 'error', blocked: 'warning', running: 'warning' })[String(state || '')] || 'info';
export const isDeploying = deployment => !!deployment && ACTIVE.has(String(deployment.state));
export const humanize = code => { const value = clean(code || '').replace(/_/g, ' ').trim(); return value ? value.charAt(0).toUpperCase() + value.slice(1) : ''; };
export const sourceLabel = source => SOURCES[source] || humanize(source);
export function ago(iso, nowIso) {
  const then = Date.parse(iso || ''), now = Date.parse(nowIso || '') || Date.now();
  if (!Number.isFinite(then)) return '';
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}
const two = value => String(value).padStart(2, '0');
/** The zone `formatWhen` writes in: `UTC+01:00`, or `UTC`. */
export function zoneLabel(nowIso) {
  const at = Date.parse(nowIso || ''), offset = -new Date(Number.isFinite(at) ? at : Date.now()).getTimezoneOffset();
  if (!offset) return 'UTC';
  const minutes = Math.abs(offset);
  return `UTC${offset > 0 ? '+' : '-'}${two(Math.floor(minutes / 60))}:${two(minutes % 60)}`;
}
/** `2026-11-19 14:32 (2d ago)`: the date and time first, how long ago after it. */
export function stamp(iso, nowIso) {
  const at = formatWhen(iso);
  if (!at) return '';
  const since = ago(iso, nowIso);
  return since ? `${at} (${since})` : at;
}
/** `09:40:21`: when the history was last read or checked, in the machine's zone. */
export function clockTime(iso) {
  const at = new Date(Date.parse(iso || ''));
  return Number.isFinite(at.getTime()) ? `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}` : '';
}
const startOf = deployment => deployment?.startedAt || deployment?.createdAt || '';
/** Names repeat across repositories (several releases are named `app`), so the repository leads; an agent goes by its own name. */
export const deploymentTitle = deployment => [deployment?.repositoryName, deployment?.agentName || deployment?.releaseName].filter(Boolean).join(' · ') || 'Deployment';
function duration(deployment, nowIso) {
  if (!isDeploying(deployment)) return formatDuration(deployment.durationMs);
  const start = Date.parse(startOf(deployment)), now = Date.parse(nowIso || '') || Date.now();
  return Number.isFinite(start) ? `${formatDuration(Math.max(0, now - start))} so far` : 'In progress';
}
/** Why a deployment did not deploy: its error, else the workflow step that blocked it, else its outcome. */
export const reasonText = deployment => deployment.error || (deployment.state === 'blocked' && blockedText(deployment.blockedBy))
  || (['failed', 'blocked'].includes(deployment.state) ? humanize(deployment.outcome) : '');
/** `6 of 6 stages`, and the stage it is at or stopped at. */
export function progressText(deployment) {
  const steps = deployment.steps || [];
  if (!steps.length) return '';
  const at = deployment.state === 'succeeded' ? null : steps.find(step => ['running', 'failed', 'blocked', 'stopped'].includes(step.state));
  return `${steps.filter(step => step.state === 'succeeded').length} of ${steps.length} stages${at?.name ? ` · ${at.name}` : ''}`;
}

export function renderReleases(p, state, actions, { environment, target }) {
  const { caption, heading, status, column, inline, buttons, button, row, badge, empty, progress, Text } = p;
  const list = state.releases, entries = list?.results || [], watch = state.releaseWatch;
  // A read the person started shows a bar until it answers: above the rows, or by Load more for the next page.
  const reading = state.releasesLoading && state.releasesReading;
  return column([
    // Refresh sits beside the heading, where it shows without scrolling past the history. It always reads again:
    // a read already under way is overtaken, never waited for.
    inline([column([heading('Deployment history'), caption(`${environment?.name || 'Environment'}${list ? ` · ${list.count} ${list.count === 1 ? 'deployment' : 'deployments'} · ${windowText(list.days)}${clockTime(list.now) ? ` · updated ${clockTime(list.now)}` : ''}` : ''}`)], { gap: 0 }),
      button('releases-refresh', state.releasesLoading ? 'Refreshing…' : 'Refresh', actions.refreshReleases)],
      { justifyContent: 'space-between', flexWrap: 'wrap' }),
    state.releasePaused ? caption('Auto-refresh paused after an hour. Refresh starts it again.') : list ? caption('Checks for new deployments every 30 s.') : null,
    buttons([...KINDS.map(([kind, label]) => button(`releases-kind-${kind || 'all'}`, label, () => actions.releasesKind(kind), state.releaseKind === kind ? { primary: true } : { plain: true, dim: true })),
      (target?.branchUid || state.releaseMine) && button('releases-mine', 'This repository', actions.releasesMine, state.releaseMine ? { primary: true } : { plain: true, dim: true })]),
    buttons(RELEASE_DAYS.map(days => button(`releases-days-${days}`, dayLabel(days), () => actions.releaseDays(days), state.releaseDays === days ? { primary: true } : { plain: true, dim: true }))),
    reading && !reading.more && progress('releases-reading', reading.label),
    state.releasesError && status('error', state.releasesError),
    ...entries.map(entry => {
      const steps = entry.steps || [], kind = deploymentKind(entry.state);
      return row(`release-deployment-${entry.uid}`, [
        inline([button(`release-open-${entry.uid}`, deploymentTitle(entry), () => actions.openReleaseDeployment(entry.uid), { plain: true }), badge(entry.kindLabel)], { flexWrap: 'wrap' }),
        caption([entry.branchName, entry.commit || 'no commit', stamp(startOf(entry), list.now)].filter(Boolean).join(' · ')),
        inline([steps.length ? inline(steps.slice(0, 40).map((step, index) => Text({ key: `release-stage-${entry.uid}-${index}`, color: STATUS[deploymentKind(step.state)].color, children: [STATUS[deploymentKind(step.state)].glyph] })),
          { key: `release-stages-${entry.uid}`, gap: 0 }) : null,
        caption([progressText(entry), duration(entry, list.now), sourceLabel(entry.source)].filter(Boolean).join(' · '))], { flexWrap: 'wrap' }),
        reasonText(entry) ? caption(reasonText(entry), { color: STATUS[kind].color, dimColor: false }) : null,
      ], [status(kind, stateLabel(entry.state)), !isDeploying(entry) ? null : watch?.runUid === entry.uid ? badge('Watching', 'warning')
        : button(`release-watch-${entry.uid}`, 'Notify me', () => actions.watchRelease(entry.uid), { plain: true })]);
    }),
    list && !entries.length && !state.releasesLoading && empty(`No deployments in the ${windowText(list.days)}`,
      `${state.releaseKind || state.releaseMine ? 'Nothing matching these filters was deployed.' : 'No resource release was deployed.'}${list.days < RELEASE_DAYS.at(-1) ? ' Choose a longer window for older deployments.' : ''}`),
    reading && reading.more && progress('releases-reading-more', reading.label),
    list && entries.length < list.count ? button('releases-more', state.releasesLoading ? 'Loading…' : 'Load more', actions.moreReleases, { plain: true, available: !state.releasesLoading }) : null,
    entries.length ? caption(`Newest first. Times in ${zoneLabel(list.now)}.`) : null,
  ]);
}

/** Plain text for the model tool. */
export function describeDeployment(deployment, nowIso) {
  return [`${STATUS[deploymentKind(deployment.state)].glyph} started ${stamp(startOf(deployment), nowIso) || 'at an unknown time'}${deployment.finishedAt ? `, ended ${formatWhen(deployment.finishedAt)}` : ''}`,
    `${deploymentTitle(deployment)}${deployment.agentName && deployment.releaseName ? ` [${deployment.releaseName}]` : ''} (${deployment.kindLabel})`,
    deployment.branchName, deployment.commit || 'no commit', stateLabel(deployment.state).toLowerCase(), progressText(deployment), duration(deployment, nowIso),
    sourceLabel(deployment.source).toLowerCase(), reasonText(deployment), `deployment ${deployment.uid}`, deployment.releaseUid && `release ${deployment.releaseUid}`].filter(Boolean).join(' · ');
}
