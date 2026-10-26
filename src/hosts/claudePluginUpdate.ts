import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ActionResult, HostServices, ToolingError } from '@dev-mainsequence/devtools';
import { claudeFailure } from './claudeProtocol';

/** The running plugin's version against the published catalog, and Claude's own plugin updater. */
export type ClaudePluginUpdateRequest = { action: 'plugin-version' } | { action: 'plugin-update' };
export const CLAUDE_PLUGIN_UPDATE_ACTIONS = new Set(['plugin-version', 'plugin-update']);
export const CLAUDE_MARKETPLACE = 'mainsequence-desktop';
export const CLAUDE_PLUGIN_ID = `mainsequence@${CLAUDE_MARKETPLACE}`;
/** What Claude installs from: the marketplace catalog on this repository's default branch. */
export const CLAUDE_CATALOG_URL = 'https://raw.githubusercontent.com/mainsequence-sdk/mainsequence-claude-desktop/main/.claude-plugin/marketplace.json';
export type ClaudePluginUpdateOptions = {
  host: HostServices; signal?: AbortSignal; env?: NodeJS.ProcessEnv; cwd?: string;
  /** The running plugin's version, from its build-info.json. */
  version?: string;
  fetch?: typeof fetch;
  /** The process that spawned this worker; Claude's engine when the pane runs it. */
  parentExecutable?: () => Promise<string | undefined>;
};

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const ENGINE = /^claude(?:\.exe)?$/;
const SCOPES = new Set(['user', 'project', 'local']);
const CATALOG_LIMIT = 256_000;

const split = (value: string): [number[], string] => {
  const dash = value.indexOf('-');
  return [(dash < 0 ? value : value.slice(0, dash)).split('.').map(Number), dash < 0 ? '' : value.slice(dash + 1)];
};
/** Orders x.y.z versions; a prerelease sorts before its release. Anything else compares equal. */
export function compareVersions(a: string, b: string): number {
  if (!VERSION.test(a) || !VERSION.test(b)) return 0;
  const [coreA, preA] = split(a), [coreB, preB] = split(b);
  for (let i = 0; i < 3; i++) if (coreA[i] !== coreB[i]) return coreA[i] > coreB[i] ? 1 : -1;
  if (preA === preB) return 0;
  if (!preA || !preB) return preA ? -1 : 1;
  return Math.sign(preA.localeCompare(preB, 'en', { numeric: true }));
}

/** Where the plugin stands: an update to install, one installed that needs a new session, or neither. */
export function updateStatus(running: string, installed: string | null, latest: string | null) {
  if (!VERSION.test(running)) return 'unknown';
  const newest = installed && compareVersions(installed, running) > 0 ? installed : running;
  if (latest && compareVersions(latest, newest) > 0) return 'update_available';
  if (newest !== running) return 'restart_required';
  return latest ? 'current' : 'unknown';
}

export function createClaudePluginUpdate(options: ClaudePluginUpdateOptions) {
  const env = { ...process.env, ...options.env };
  const running = options.version ?? 'unknown';

  async function parentExecutable(): Promise<string | undefined> {
    if (process.platform === 'linux') return fs.readlink(`/proc/${process.ppid}/exe`).catch(() => undefined);
    if (process.platform !== 'darwin') return undefined;
    const result = await options.host.runProcess({ executable: '/bin/ps', args: ['-o', 'comm=', '-p', String(process.ppid)], cwd: '/', signal: options.signal, timeoutMs: 5_000 });
    return result.exitCode === 0 ? result.stdout.trim() || undefined : undefined;
  }
  /** Claude's engine: the process running this worker, or the one Claude names for its children. */
  async function engine(): Promise<string | undefined> {
    for (const candidate of [await (options.parentExecutable ?? parentExecutable)(), env.CLAUDE_CODE_EXECPATH]) {
      if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || !ENGINE.test(path.basename(candidate))) continue;
      if (await fs.stat(candidate).then(item => item.isFile(), () => false)) return candidate;
    }
    return undefined;
  }
  async function claude(executable: string, args: string[], timeoutMs: number) {
    const result = await options.host.runProcess({ executable, args, cwd: options.cwd ?? process.cwd(), env, signal: options.signal, timeoutMs });
    if (result.cancelled) throw new ToolingError('CANCELLED', 'The action was cancelled.');
    return result;
  }
  /** The installed copy Claude will load in the next session; it can be newer than the running one. */
  async function installed(executable: string): Promise<{ version: string; scope?: string } | undefined> {
    const result = await claude(executable, ['plugin', 'list', '--json'], 30_000);
    if (result.exitCode !== 0) return undefined;
    let rows: unknown;
    try { rows = JSON.parse(result.stdout); } catch { return undefined; }
    const row = Array.isArray(rows) ? rows.find(item => item?.id === CLAUDE_PLUGIN_ID) : undefined;
    if (typeof row?.version !== 'string' || !VERSION.test(row.version)) return undefined;
    return { version: row.version, ...(SCOPES.has(row.scope) ? { scope: row.scope } : {}) };
  }
  async function latest(): Promise<string> {
    const signal = AbortSignal.any([AbortSignal.timeout(10_000), ...(options.signal ? [options.signal] : [])]);
    const response = await (options.fetch ?? fetch)(CLAUDE_CATALOG_URL, { signal, headers: { accept: 'application/json' } });
    const text = response.ok ? await response.text() : '';
    if (!text || text.length > CATALOG_LIMIT) throw new Error('catalog');
    const plugins = JSON.parse(text)?.plugins;
    const version = Array.isArray(plugins) ? plugins.find(item => item?.name === 'mainsequence')?.version : undefined;
    if (typeof version !== 'string' || !VERSION.test(version)) throw new Error('catalog');
    return version;
  }

  async function dispatch(request: ClaudePluginUpdateRequest): Promise<ActionResult> {
    const action = request?.action || 'unknown';
    try {
      options.signal?.throwIfAborted();
      const executable = await engine();
      const before = executable ? await installed(executable) : undefined;
      if (request.action === 'plugin-version') {
        const newest = await latest().catch(() => {
          if (options.signal?.aborted) throw new ToolingError('CANCELLED', 'The action was cancelled.');
          return null;
        });
        const status = updateStatus(running, before?.version ?? null, newest);
        const summary = status === 'update_available' ? `MainSequence ${newest} is available.`
          : status === 'restart_required' ? `MainSequence ${before?.version} is installed. Start a new Code session to use it.`
          : status === 'current' ? 'MainSequence is up to date.' : 'MainSequence could not check for updates.';
        return { schemaVersion: 1, action, status: 'success', summary, data: { running, installed: before?.version ?? null, latest: newest, status,
          updateSupported: Boolean(before), ...(newest ? {} : { catalogError: 'The MainSequence plugin catalog could not be reached.' }) } };
      }
      if (request.action !== 'plugin-update') throw new ToolingError('INVALID_REQUEST', 'Unknown plugin update action.');
      if (!executable || !before) throw new ToolingError('UNSUPPORTED_ACTION', "Claude's plugin updater is not available to this session.");
      options.host.progress?.(`Refreshing the ${CLAUDE_MARKETPLACE} marketplace…`);
      if ((await claude(executable, ['plugin', 'marketplace', 'update', CLAUDE_MARKETPLACE, '--json'], 120_000)).exitCode !== 0) {
        throw new ToolingError('PROCESS_FAILED', `Claude could not refresh the ${CLAUDE_MARKETPLACE} marketplace.`);
      }
      options.host.progress?.('Updating MainSequence…');
      // Never -y: a catalog that declares an install command needs a person to accept it.
      const args = ['plugin', 'update', CLAUDE_PLUGIN_ID, ...(before.scope ? ['--scope', before.scope] : []), '--json'];
      if ((await claude(executable, args, 300_000)).exitCode !== 0) throw new ToolingError('PROCESS_FAILED', 'Claude could not update MainSequence.');
      const after = await installed(executable);
      if (!after) throw new ToolingError('PROCESS_FAILED', 'Claude updated MainSequence but did not report the installed version.');
      const status = updateStatus(running, after.version, null) === 'restart_required' ? 'restart_required' : 'current';
      const summary = status === 'restart_required' ? `MainSequence ${after.version} is installed. Start a new Code session to use it.` : 'MainSequence is already up to date.';
      return { schemaVersion: 1, action, status: 'success', summary, data: { running, previous: before.version, installed: after.version, status } };
    } catch (error) { return claudeFailure(action, error, options.signal?.aborted); }
  }
  return { dispatch };
}
