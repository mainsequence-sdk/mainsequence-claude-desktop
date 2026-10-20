import { ActionResult, HostServices, RepositoryClient, createSessionService } from '@dev-mainsequence/devtools';

/** Presentation metadata only. Discovery, saved connections and tool routing stay in devtools. */
export async function withClaudeMcpNames(result: ActionResult, options: { host: HostServices; signal?: AbortSignal }): Promise<ActionResult> {
  if (result.status !== 'success' || !['mcp-discover', 'mcp-list'].includes(result.action)) return result;
  const data = result.data as any;
  const connections: any[] = Array.isArray(data) ? data : data?.results;
  if (!Array.isArray(connections) || !connections.length) return result;
  const backend = connections[0].backend;
  const session = createSessionService(options.host, { signal: options.signal, requestTimeoutMs: 15_000 });
  const repositories = new RepositoryClient(session, backend);
  const wanted = new Map(connections.map(row => [row.resource_release_uid, row]));
  const branches = new Map<string, string>();
  try {
    // The pinned devtools result omits repository identity. Read the existing
    // collection projection, matching exact releases and environments, to label it.
    for (let offset = 0; offset < 10000; offset += 100) {
      const page = await session.request(backend, 'GET', `/api/v1/resource-releases/?mcp_available=true&limit=100&offset=${offset}`) as any;
      if (!Array.isArray(page?.results) || !Number.isInteger(page.count) || page.count < 0) break;
      for (const row of page.results) {
        const connection = wanted.get(row.uid);
        if (connection?.backend === backend
          && connection.mcp_connection?.organization_environment_uid === row.mcp_connection?.organization_environment_uid
          && typeof row.code_repository_branch_uid === 'string' && row.code_repository_branch_uid.trim()) {
          branches.set(row.uid, row.code_repository_branch_uid);
        }
      }
      if (branches.size === wanted.size || offset + 100 >= page.count || !page.results.length) break;
    }
    const names = new Map<string, string>();
    const pending = [...new Set(branches.values())];
    // Keep large saved catalogs from opening an unbounded number of requests.
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
    const labelled = connections.map(row => {
      const name = names.get(branches.get(row.resource_release_uid) || '');
      return name ? { ...row, display_name: name } : row;
    });
    return { ...result, data: Array.isArray(data) ? labelled : { ...data, results: labelled } };
  } catch {
    options.signal?.throwIfAborted();
    return result;
  }
}
