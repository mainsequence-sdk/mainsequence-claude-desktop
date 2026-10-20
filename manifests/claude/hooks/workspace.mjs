// Claude's folder link accepts one folder. Explicit /add-dir commands register
// each sibling checkout in the new session, including its per-repository context.
export function workspaceBinding(workspace) {
  if (!workspace?.root || !workspace.backend || !workspace.projectUid || !workspace.environmentUid
    || !Array.isArray(workspace.repositories) || !workspace.repositories.length) throw new Error('The project has no prepared repository memberships. Run setup again.');
  return { root: workspace.root, backend: workspace.backend, projectUid: workspace.projectUid, environmentUid: workspace.environmentUid,
    repositories: workspace.repositories.map(row => ({ repositoryUid: row.repositoryUid, branchUid: row.branchUid, branch: row.branch, path: row.path })) };
}

