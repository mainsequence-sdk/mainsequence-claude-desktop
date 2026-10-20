import { clean } from './model.mjs';
import { primitives } from './primitives.mjs';

export function renderProjects(ui, state, actions) {
  const p = primitives(ui, state, actions);
  const { Box, Input, text, muted, caption, heading, title, status, column, inline, buttons, button, row, badge, markdown, empty } = p;
  const page = state.projectPage, selected = state.projectDetail;
  const operation = state.results['devtools.organization-project-setup'];
  const setupOp = state.operations.find(op => op.status === 'running' && op.label === 'devtools · organization-project-setup');
  if (selected && !state.projectListView) {
    const groups = new Map();
    for (const branch of selected.branches || []) {
      if (!groups.has(branch.code_repository_uid)) groups.set(branch.code_repository_uid, []);
      groups.get(branch.code_repository_uid).push(branch);
    }
    const hasCommandCenter = !!state.fields.commandCenterUrl.trim();
    const canSetup = !!selected.branches.length && !!state.fields.baseDir && !state.projectSetupRunning;
    return column([
      button('projects-back', '← Projects', actions.showProjectList, { plain: true, dim: true }),
      heading(selected.project.name),
      selected.project.description && markdown(selected.project.description),
      buttons([
        state.projectWorkspace ? button('project-open-local', 'Open in Claude', actions.openOrganizationWorkspace, { primary: true }) : null,
        button('project-setup', state.projectSetupRunning ? 'Setting up…' : state.projectWorkspace ? 'Update local workspace' : 'Set up locally', actions.setupOrganizationProject,
          { primary: !state.projectWorkspace, available: canSetup, reason: !selected.branches.length ? 'This project has no accessible branches.' : !state.fields.baseDir ? 'Choose a repositories folder in Settings first.' : '' }),
        button('project-open', 'Open in Command Center', () => actions.projectLink('project'), { plain: true, available: hasCommandCenter, reason: 'Set the Command Center URL in Settings to open platform pages.' }),
      ]),
      state.projectWorkspace && caption(`Local workspace: ${state.projectWorkspace.root}`),
      setupOp && status('warning', setupOp.progress),
      operation?.status === 'failure' && status('error', operation.summary),
      operation?.effects && status('warning', operation.effects.message),
      state.projectOpenMessage && status('info', state.projectOpenMessage),
      title('Repositories'),
      !hasCommandCenter && caption('Repository and branch links open GitHub.'),
      ...[...groups].map(([uid, branches]) => column([
        row(`project-repository-row-${uid}`, [button(`project-repository-${uid}`, `${branches[0].code_repository_name} ↗`, () => actions.projectLink('repository', branches[0].uid), { plain: true })], []),
        ...branches.map(branch => row(`project-branch-row-${branch.uid}`, [inline([caption('  '), button(`project-branch-${branch.uid}`, `${branch.repository_branch} ↗`, () => actions.projectLink('branch', branch.uid), { plain: true, dim: true })])],
          [badge(branch.is_initialized ? 'Ready' : 'Initializing', branch.is_initialized ? 'success' : 'warning')])),
      ], { gap: 0 })),
    ]);
  }
  return column([
    inline([Box({ flexGrow: 1, flexShrink: 1, minWidth: 0, children: [Input({ key: 'field-projectSearch', value: state.fields.projectSearch, placeholder: 'Search projects', autoFocus: true, onInput: value => actions.field('projectSearch', value), onSubmit: actions.refreshOrganizationProjects })] }),
      button('projects-search', 'Search', actions.refreshOrganizationProjects, { plain: true, available: !state.projectsLoading }),
      button('projects-refresh', state.projectsLoading ? 'Loading…' : 'Refresh', actions.refreshOrganizationProjects, { plain: true, dim: true, available: !state.projectsLoading })]),
    state.projectsLoading && muted('Loading projects…'),
    state.projectError && status('error', state.projectError),
    page && !(page.results || []).length && empty('No projects', 'No projects match this environment and search.'),
    ...(page?.results || []).map(project => row(`project-row-${project.uid}`, [
      button(`project-${project.uid}`, project.name, () => actions.chooseProject(project.uid), { plain: true }),
      project.description && caption(project.description),
    ], [badge(`${project.code_repository_branch_uids.length} ${project.code_repository_branch_uids.length === 1 ? 'branch' : 'branches'}`),
      project.uid === state.selectedProject && state.projectWorkspace ? badge('Local', 'success') : null])),
    state.projectLoading && muted('Loading project repositories and branches…'),
    page && page.count > (page.results || []).length ? inline([button('projects-previous', 'Previous', actions.previousProjects, { plain: true, available: page.offset > 0 && !state.projectsLoading }),
      caption(`${page.count} projects`), button('projects-next', 'Next', actions.nextProjects, { plain: true, available: page.offset + (page.results || []).length < page.count && !state.projectsLoading })]) : page ? caption(`${page.count} ${page.count === 1 ? 'project' : 'projects'}`) : null,
  ]);
}
