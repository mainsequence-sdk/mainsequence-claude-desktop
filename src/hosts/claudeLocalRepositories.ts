import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ActionResult, HostServices, ToolingError, createSessionService, projectContext, requireBackend } from '@dev-mainsequence/devtools';
import { claudeFailure } from './claudeProtocol';

/** Which MainSequence repository a folder on this computer is a checkout of, wherever it is. */
export type ClaudeLocalRequest =
  { action: 'identify-folder'; backend: string; root: string; branches?: string[] }
  | { action: 'existing-folders'; paths: string[] };
export const CLAUDE_LOCAL_ACTIONS = new Set(['identify-folder', 'existing-folders']);

const RESOLVE_PATH = '/api/v1/code-repository-branches/resolve-git-context/';
/** The checked-out branch plus at most this many registered branch names are tried. */
const MAX_FALLBACK_BRANCHES = 8;
const MAX_FOLDERS = 200;
const singleLine = (value: unknown): string => typeof value === 'string' && value.trim() && !/[\0\r\n]/.test(value) ? value.trim() : '';

function absolute(input: unknown, message: string): string {
  if (typeof input !== 'string' || !path.isAbsolute(input) || /[\0\r\n]/.test(input)) throw new ToolingError('INVALID_REQUEST', message);
  return path.resolve(input);
}

/**
 * Identification goes through the platform's Git-context resolution, the same lookup the VS Code
 * extension uses for its open workspace: the folder's canonical origin identity plus a branch name
 * selects one registered repository branch. The platform answers 404 when no visible branch matches;
 * the injected fetch reports that as "no match" inside the public session service, so credential and
 * renewal handling stay devtools'.
 */
export function createClaudeLocalRepositories(options: { host: HostServices; signal?: AbortSignal; env?: NodeJS.ProcessEnv; fetch?: typeof fetch }) {
  const transport = options.fetch ?? fetch;
  const session = createSessionService(options.host, { env: options.env, signal: options.signal, requestTimeoutMs: 30_000,
    fetch: async (input, init) => {
      const response = await transport(input, init);
      if (response.status === 404 && new URL(String(input)).pathname === RESOLVE_PATH) {
        await response.body?.cancel().catch(() => {});
        return new Response(JSON.stringify({ unmatched: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return response;
    } });

  async function identify(input: Extract<ClaudeLocalRequest, { action: 'identify-folder' }>) {
    const backend = requireBackend(input.backend);
    const requested = absolute(input.root, 'Select an absolute repository folder.');
    if (input.branches !== undefined && !Array.isArray(input.branches)) throw new ToolingError('INVALID_REQUEST', 'Registered branch names must be a list.');
    let context;
    try { context = await projectContext(options.host, requested, backend, undefined, options.env, options.signal); }
    catch (error) {
      // Not a Git checkout, a detached HEAD or an unsupported origin: the folder is simply not identified.
      if (error instanceof ToolingError && ['PROJECT_NOT_FOUND', 'INVALID_GIT_CONTEXT'].includes(error.code)) return { root: requested, matched: false, reason: error.message };
      throw error;
    }
    const fallback = [...new Set((input.branches ?? []).map(singleLine).filter(name => name && name !== context.branch))].slice(0, MAX_FALLBACK_BRANCHES);
    for (const branchName of [context.branch, ...fallback]) {
      options.signal?.throwIfAborted();
      const payload = await session.request<any>(backend, 'POST', RESOLVE_PATH,
        { repository_identity: context.repositoryIdentity, repository_branch: branchName, commit_sha: context.commit }, true);
      if (payload?.unmatched === true) continue;
      const branch = payload?.code_repository_branch;
      const repositoryUid = singleLine(branch?.code_repository_uid), branchUid = singleLine(branch?.uid);
      if (!repositoryUid || !branchUid || payload.canonical_repository_identity !== context.repositoryIdentity || branch.repository_branch !== branchName) {
        throw new ToolingError('API_ERROR', 'The repository lookup returned another repository or branch.');
      }
      return { root: context.root, matched: true, repositoryUid, repositoryName: singleLine(branch.code_repository_name),
        branch: context.branch, registeredBranch: branchName, ...(branchName === context.branch ? { branchUid } : {}) };
    }
    return { root: context.root, matched: false, branch: context.branch,
      reason: 'No repository you can see on this backend has a registered branch with this Git remote.' };
  }

  async function dispatch(input: ClaudeLocalRequest): Promise<ActionResult> {
    const action = input?.action || 'unknown';
    try {
      options.signal?.throwIfAborted();
      let data: unknown;
      if (input.action === 'identify-folder') data = await identify(input);
      else if (input.action === 'existing-folders') {
        if (!Array.isArray(input.paths) || input.paths.length > MAX_FOLDERS) throw new ToolingError('INVALID_REQUEST', `List at most ${MAX_FOLDERS} folders.`);
        const existing: string[] = [];
        for (const value of input.paths) {
          try { if ((await fs.stat(absolute(value, 'Folders must be absolute paths.'))).isDirectory()) existing.push(value); } catch { /* gone or unreadable */ }
        }
        data = { existing };
      } else throw new ToolingError('INVALID_REQUEST', 'Unknown local repository action.');
      return { schemaVersion: 1, action, status: 'success', summary: `${action} completed.`, data };
    } catch (error) { return claudeFailure(action, error, options.signal?.aborted); }
  }
  return { dispatch };
}
