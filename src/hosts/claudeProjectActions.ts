import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ActionResult, HostServices, ToolingError, createProjectOperations,
  PROJECT_OPERATION_ACTIONS, ProjectOperationRequest } from '@dev-mainsequence/devtools';
import { claudeFailure } from './claudeProtocol';

export type ClaudeProjectRequest = ProjectOperationRequest
  | { action: 'runtime-diagnostics' }
  | { action: 'pick-folder'; initialPath?: string }
  | { action: 'open-container'; root: string };
export const CLAUDE_PROJECT_ACTIONS = new Set([
  ...PROJECT_OPERATION_ACTIONS, 'runtime-diagnostics', 'pick-folder', 'open-container',
]);
export type ClaudeProjectOptions = {
  host: HostServices; signal?: AbortSignal; env?: NodeJS.ProcessEnv;
  version?: string; pluginRoot?: string; configPath?: string;
  pickFolder?: (initialPath?: string) => Promise<string | undefined>;
  openContainer?: (root: string) => Promise<void>;
};

/** Host integration only. Filesystem mutations and project policy belong to devtools. */
export function createClaudeProjectActions(options: ClaudeProjectOptions) {
  const operations = createProjectOperations(options);
  function absolute(input: unknown): string {
    if (typeof input !== 'string' || !path.isAbsolute(input) || /[\0\r\n]/.test(input)) {
      throw new ToolingError('INVALID_REQUEST', 'Select an absolute project folder.');
    }
    return path.resolve(input);
  }
  async function directory(input: unknown): Promise<string> {
    const selected = absolute(input);
    try {
      const root = await fs.realpath(selected);
      if (!(await fs.stat(root)).isDirectory()) throw new Error();
      return root;
    } catch { throw new ToolingError('PROJECT_NOT_FOUND', 'The selected project folder is unavailable.'); }
  }
  async function dispatch(request: ClaudeProjectRequest): Promise<ActionResult> {
    const action = request?.action || 'unknown';
    if (PROJECT_OPERATION_ACTIONS.has(action)) return operations.dispatch(request as ProjectOperationRequest);
    try {
      options.signal?.throwIfAborted();
      let data: unknown;
      if (request.action === 'runtime-diagnostics') {
        data = { version: options.version ?? 'unknown', nodeVersion: process.version,
          platform: `${process.platform} ${process.arch}`, pluginRoot: options.pluginRoot, configPath: options.configPath,
          bundleHealth: { compiledEntry: await fs.stat(path.join(__dirname, '..', 'claudeRunner.js')).then(item => item.isFile()).catch(() => false),
            projectAdapter: await fs.stat(path.join(__dirname, 'claudeProjectActions.js')).then(item => item.isFile()).catch(() => false),
            ...(options.pluginRoot ? { pluginRoot: await fs.stat(options.pluginRoot).then(item => item.isDirectory()).catch(() => false) } : {}) },
          capabilities: { pickFolder: Boolean(options.pickFolder), openContainer: Boolean(options.openContainer),
            openFolder: Boolean(options.host.openFolder), signedTerminal: Boolean(options.host.openTerminal) } };
      } else if (request.action === 'pick-folder') {
        if (!options.pickFolder) throw new ToolingError('UNSUPPORTED_ACTION', 'This Desktop host does not expose a native folder picker.');
        const initial = request.initialPath === undefined ? undefined : absolute(request.initialPath);
        const selected = await options.pickFolder(initial);
        data = selected ? { path: await directory(selected), cancelled: false } : { cancelled: true };
      } else if (request.action === 'open-container') {
        if (!options.openContainer) throw new ToolingError('UNSUPPORTED_ACTION', 'This Desktop host has no supported route to start Claude Code inside a devcontainer.');
        const root = await directory(request.root);
        await options.openContainer(root); data = { root };
      } else throw new ToolingError('INVALID_REQUEST', 'Unknown Desktop project action.');
      return { schemaVersion: 1, action, status: 'success', summary: `${action} completed.`, data };
    } catch (error) { return claudeFailure(action, error, options.signal?.aborted); }
  }
  return { dispatch };
}
