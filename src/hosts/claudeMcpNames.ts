import { ActionResult, HostServices, RepositoryClient, createSessionService } from '@dev-mainsequence/devtools';

/** Presentation metadata for discovery rows only. A saved connection carries its names
 * (devtools stores them when an MCP is connected), so listings need no lookup here. */
export async function withClaudeMcpNames(result: ActionResult, options: { host: HostServices; signal?: AbortSignal }): Promise<ActionResult> {
  if (result.status !== 'success' || result.action !== 'mcp-discover') return result;
  const data = result.data as any;
  const rows: any[] = Array.isArray(data?.results) ? data.results : [];
  const pending = [...new Set(rows.map(row => row.code_repository_branch_uid).filter(uid => typeof uid === 'string' && uid.trim()))] as string[];
  if (!pending.length) return result;
  const session = createSessionService(options.host, { signal: options.signal, requestTimeoutMs: 15_000 });
  const repositories = new RepositoryClient(session, rows[0].backend);
  const names = new Map<string, string>();
  // Keep a large directory page from opening an unbounded number of requests.
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (pending.length) {
      const uid = pending.shift()!;
      try {
        const branch = await repositories.getCodeRepositoryBranch(uid);
        if (branch.uid === uid) names.set(uid, branch.code_repository_name);
      } catch {
        options.signal?.throwIfAborted();
        // Optional display metadata must not make a working MCP unavailable.
      }
    }
  }));
  const labelled = rows.map(row => {
    const name = names.get(row.code_repository_branch_uid);
    return name ? { ...row, display_name: name } : row;
  });
  return { ...result, data: { ...data, results: labelled } };
}
