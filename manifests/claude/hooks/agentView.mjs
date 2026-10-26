import { clean, record, rows } from './model.mjs';
import { primitives } from './primitives.mjs';
import { renderAgentIcon } from './agentIcon.mjs';

const RUNTIME = { current: 'Up to date', not_deployed: 'Not deployed', updating: 'Updating', update_required: 'Update available', update_failed: 'Update failed', unknown: 'Status unknown' };

export function renderAgents(ui, state, actions) {
  const p = primitives(ui, state, actions);
  const { Box, Input, text, muted, caption, heading, title, status, column, inline, buttons, button, row, badge, markdown, empty } = p;
  const defaults = agent => {
    const values = [agent.defaults?.provider, agent.defaults?.model, agent.defaults?.thinking].map(value => clean(value)).filter(Boolean);
    return values.length ? caption(values.join(' · '), { key: `agent-defaults-${agent.uid}` }) : null;
  };
  const bindingFor = agent => state.agentBindings[JSON.stringify([state.fields.backend, state.fields.mcpEnvironment, state.agentAccount, agent.uid])];
  const canTalk = agent => agent.runtimeState !== 'not_deployed' && agent.responseKinds?.some(kind => ['message', 'task'].includes(kind));
  const isActive = agent => state.activeAgent?.agent?.uid === agent.uid;
  const unavailableReason = agent => agent.runtimeState === 'not_deployed' ? 'Deploy this agent to start a conversation.' : 'This agent does not advertise messaging support.';
  const talk = agent => button(`agent-talk-${agent.uid}`, 'Talk', () => actions.talkToAgent(agent.uid), { primary: isActive(agent), available: canTalk(agent) });
  /** One status line per agent: preparation phase, then the conversation's own state. */
  const agentStatus = agent => {
    const preparing = state.agentPreparing[agent.uid], binding = bindingFor(agent);
    if (preparing) return ['warning', preparing.phase];
    if (!binding) return null;
    if (binding.uncertain && !binding.busy) return ['error', 'Delivery needs review'];
    return ({ opening: ['warning', 'Opening session…'], selected: ['success', 'Agent ready · no message sent'], waiting: ['warning', 'Waiting for agent…'],
      ready: ['success', 'Reply received'], working: ['warning', 'Agent task in progress'], failed: ['error', 'Conversation needs attention'] })[binding.status] || null;
  };
  const statusRow = agent => {
    const value = agentStatus(agent), binding = bindingFor(agent), preparing = state.agentPreparing[agent.uid];
    if (!value) return null;
    return inline([status(value[0], value[1], { key: `agent-status-${agent.uid}` }),
      preparing && button(`agent-prepare-cancel-${agent.uid}`, 'Cancel', () => actions.cancelAgentPreparation(agent.uid), { plain: true, dim: true }),
      !preparing && binding?.status === 'failed' && button(`agent-prepare-retry-${agent.uid}`, 'Try again', () => actions.talkToAgent(agent.uid), { plain: true })], { flexWrap: 'wrap' });
  };
  const notes = agent => {
    const binding = bindingFor(agent), preparing = state.agentPreparing[agent.uid];
    return [!preparing && binding?.error && caption(binding.error, { color: 'error' }),
      binding?.task && caption(`Task ${binding.task.status}${binding.task.cancellationRequested ? ' · cancellation requested' : ''}`),
      binding?.uncertain && !preparing && inline([caption('The previous request may have reached the agent. Review Activity before sending again.'),
        !binding.busy && button(`agent-resend-${agent.uid}`, 'Allow sending again', () => actions.allowAgentResend(agent.uid), { plain: true })], { flexWrap: 'wrap' })].filter(Boolean);
  };
  const detail = state.agentDetail;
  if (detail) {
    const examples = (detail.skills || []).flatMap(skill => skill.examples || []).slice(0, 8);
    return column([
      button('agents-back', '← Agents', actions.closeAgentDetails, { plain: true, dim: true }),
      inline([renderAgentIcon(ui, state, detail.uid, { size: 32 }), heading(detail.name)]),
      defaults(detail),
      inline([badge(RUNTIME[detail.runtimeState] || RUNTIME.unknown, detail.runtimeState === 'current' ? 'success' : detail.runtimeState === 'not_deployed' || detail.runtimeState === 'update_failed' ? 'error' : undefined),
        caption(`${detail.environmentName} · ${detail.repositoryBranch || 'Branch unavailable'}`)]),
      detail.description && markdown(detail.description),
      statusRow(detail) || (!canTalk(detail) ? caption(unavailableReason(detail)) : null), ...notes(detail),
      buttons([talk(detail), button('agent-new-conversation', 'New conversation…', () => actions.newAgentConversation(detail.uid), { plain: true, dim: true })]),
      caption('Talk opens or resumes this agent’s conversation and prepares Claude’s input. Only the message you submit is sent.'),
      title('Skills'),
      ...(detail.skills?.length ? detail.skills.map(skill => column([text(skill.name, { weight: 'medium' }), skill.description && caption(skill.description)], { gap: 0 })) : [muted('The agent card does not list individual skills. Ask the agent for details.')]),
      examples.length ? title('Try asking') : null,
      ...examples.map((example, index) => button(`agent-example-${detail.uid}-${index}`, `“${example}”`, () => actions.askAgent(detail.uid, example), { plain: true, available: canTalk(detail) })),
    ]);
  }
  const result = state.results['devtools.agents-list'], page = record(result?.data);
  const agents = rows(page).filter(agent => agent.environmentUid === state.fields.mcpEnvironment);
  return column([
    inline([Box({ flexGrow: 1, flexShrink: 1, minWidth: 0, children: [Input({ key: 'field-agentSearch', value: state.fields.agentSearch, placeholder: 'Search agents', autoFocus: true, onInput: value => actions.field('agentSearch', value), onSubmit: value => { actions.field('agentSearch', value); actions.searchAgents(); } })] }),
      button('agents-search', 'Search', actions.searchAgents, { plain: true }),
      button('agents-refresh', state.agentsLoading ? 'Loading…' : 'Refresh', actions.refreshAgents, { plain: true, dim: true, available: !state.agentsLoading })]),
    result?.status === 'failure' && column([status('error', result.summary), button('agents-retry', 'Try again', actions.refreshAgents, { plain: true })]),
    state.agentsLoading && muted('Loading agents from this environment…'),
    result?.status === 'success' && !agents.length && empty(state.fields.agentSearch.trim() ? 'No matching agents' : 'No agents in this environment', 'Try another search or choose another environment.'),
    result?.status === 'success' && agents.length ? caption(page.semantic ? `${agents.length} matching agents` : `${page.count} agents · showing ${state.agentOffset + 1}–${state.agentOffset + agents.length}`) : null,
    ...agents.map(agent => column([
      row(`agent-${agent.uid}`, [
        inline([renderAgentIcon(ui, state, agent.uid, { size: 20 }), button(`agent-details-${agent.uid}`, agent.name, () => actions.agentDetails(agent.uid), { plain: true })]),
        defaults(agent),
        statusRow(agent) || (!canTalk(agent) ? caption(unavailableReason(agent)) : null),
        ...notes(agent),
      ], [talk(agent)]),
    ], { gap: 0 })),
    !page.semantic && agents.length ? inline([state.agentOffset > 0 && button('agents-previous', 'Previous', actions.previousAgents, { plain: true }), state.agentOffset + agents.length < page.count && button('agents-next', 'Next', actions.nextAgents, { plain: true })]) : null,
  ]);
}
