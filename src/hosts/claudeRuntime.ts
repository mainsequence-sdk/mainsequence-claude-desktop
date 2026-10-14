import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

/** Desktop owns its engine; never infer its version from a different PATH installation. */
export async function desktopClaudeExecutable(env: NodeJS.ProcessEnv = process.env, platform = process.platform): Promise<string | undefined> {
  if (env.MAINSEQUENCE_CLAUDE_EXECUTABLE) return env.MAINSEQUENCE_CLAUDE_EXECUTABLE;
  if (platform !== 'darwin') return;
  const root = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude-code');
  const versions = (await fs.readdir(root).catch(() => [])).filter(name => /^\d+\.\d+\.\d+$/.test(name));
  versions.sort((a, b) => {
    const av = a.split('.').map(Number), bv = b.split('.').map(Number);
    return bv[0] - av[0] || bv[1] - av[1] || bv[2] - av[2];
  });
  for (const version of versions) {
    for (const build of await fs.readdir(path.join(root, version)).catch(() => [])) {
      if (!/^[a-zA-Z0-9_-]+$/.test(build)) continue;
      const executable = path.join(root, version, build, 'claude.app', 'Contents', 'MacOS', 'claude');
      if (await fs.stat(executable).then(s => s.isFile()).catch(() => false)) return executable;
    }
  }
  return;
}
