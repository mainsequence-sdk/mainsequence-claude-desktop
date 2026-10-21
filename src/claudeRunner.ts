#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createDevTools } from '@dev-mainsequence/devtools';
import { createNodeHost } from '@dev-mainsequence/devtools';
import { ToolingError } from '@dev-mainsequence/devtools';
import { CLAUDE_INPUT_LIMIT, claudeFailure, executeClaudeEnvelope, parseClaudeEnvelope } from './hosts/claudeProtocol';
import { createClaudeProjectActions } from './hosts/claudeProjectActions';
import { createClaudeAgentIcons } from './hosts/claudeAgentIcons';
import { withClaudeMcpNames } from './hosts/claudeMcpNames';
import { CLAUDE_DEPLOYMENT_ACTIONS, createClaudeDeployments } from './hosts/claudeDeployments';

export async function main(): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  const timer = setTimeout(stop, 30 * 60_000); timer.unref();
  let id = 'invalid', action = 'invalid';
  const progress = (message: string) => process.stdout.write(JSON.stringify({ type: 'progress', id, message }) + '\n');
  try {
    if (Number(process.versions.node.split('.')[0]) < 22) throw new ToolingError('MISSING_PREREQUISITE', 'Node 22 or later is required. Set the Node executable in General → Advanced.');
    let input = '';
    if (process.argv.length !== 2) throw new ToolingError('INVALID_REQUEST', 'The Desktop worker accepts structured input on stdin only.');
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > CLAUDE_INPUT_LIMIT) throw new ToolingError('INVALID_REQUEST', 'The action input is too large.');
    }
    let parsed: unknown;
    try { parsed = JSON.parse(input); } catch { throw new ToolingError('INVALID_REQUEST', 'The action input is not valid JSON.'); }
    const envelope = parseClaudeEnvelope(parsed); id = envelope.id; action = envelope.request.request.action;
    const host = createNodeHost(progress);
    // Reveal is a native OS operation. Changing the Code session's root is a separate host capability.
    host.openFolder = async root => {
      if (!path.isAbsolute(root) || !(await fs.stat(root)).isDirectory()) throw new ToolingError('INVALID_REQUEST', 'Select an existing repository folder.');
      const executable = process.platform === 'darwin' ? '/usr/bin/open' : 'xdg-open';
      const result = await host.runProcess({ executable, args: [root], cwd: root, signal: controller.signal, timeoutMs: 15_000 });
      if (result.exitCode !== 0) throw new ToolingError('PROCESS_FAILED', 'The system folder viewer could not open.');
    };
    const tooling = createDevTools({ host, signal: controller.signal, allowMcpSkills: true });
    const build = await fs.readFile(path.join(__dirname, '..', 'build-info.json'), 'utf8').then(text => JSON.parse(text)).catch(() => ({}));
    const projects = createClaudeProjectActions({ host, signal: controller.signal, pluginRoot: path.resolve(__dirname, '..'), version: build.version,
      pickFolder: process.platform === 'darwin' ? async () => {
        const result = await host.runProcess({ executable: '/usr/bin/osascript', args: ['-e', 'POSIX path of (choose folder with prompt "Choose a MainSequence repositories folder")'], cwd: process.cwd(), signal: controller.signal, timeoutMs: 120_000 });
        return result.exitCode === 0 ? result.stdout.trim() || undefined : undefined;
      } : undefined });
    const result = await executeClaudeEnvelope(envelope, { devtools: async request =>
      withClaudeMcpNames(await tooling.dispatch(request), { host, signal: controller.signal }),
      projects: request => request.action === 'agent-icons'
        ? createClaudeAgentIcons({ host, signal: controller.signal }).dispatch(request)
        : CLAUDE_DEPLOYMENT_ACTIONS.has(request.action)
          ? createClaudeDeployments({ host, signal: controller.signal }).dispatch(request) : projects.dispatch(request) });
    process.stdout.write(JSON.stringify({ type: 'result', id, result }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ type: 'result', id, result: claudeFailure(action, error, controller.signal.aborted) }) + '\n');
  } finally {
    clearTimeout(timer); process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
  }
}
if (require.main === module) void main();
