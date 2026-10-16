import { clean, record, rows } from './model.mjs';

export function renderAgents(ui, state, actions) {
  const { Box, Text, Button, Input } = ui;
  const text = (value, props = {}) => Text({ ...props, children: [clean(value)] });
  const muted = value => text(value, { dimColor: true });
  const column = children => Box({ flexDirection: 'column', gap: 1, children: children.filter(Boolean) });
  const row = children => Box({ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1, children: children.filter(Boolean) });
  const button = (key, label, onPress) => Button({ key, label, onPress });
  const section = (key, children) => Box({ key, flexDirection: 'column', paddingY: 1, gap: 1, children: children.filter(Boolean) });
  const status = agent => ({ current: 'Deployment up to date', not_deployed: 'Not deployed', updating: 'Updating', update_required: 'Update available', update_failed: 'Update failed', unknown: 'Status unknown' }[agent.runtimeState] || 'Status unknown');
  const defaults = agent => text(`${clean(agent.defaults?.provider) || 'Not configured'} · ${clean(agent.defaults?.model) || 'Not configured'} · ${clean(agent.defaults?.thinking) || 'Not configured'}`, { key: `agent-defaults-${agent.uid}`, dimColor: true, wrap: 'wrap' });
  const identity = (agent, showDetails = false) => column([
    text(agent.name, { bold: true, wrap: 'wrap' }),
    showDetails && defaults(agent),
    showDetails && muted(`${agent.environmentName} · ${agent.repositoryBranch || 'Branch unavailable'}`),
  ]);
  const bindingFor = agent => state.agentBindings[JSON.stringify([state.fields.backend, state.fields.mcpEnvironment, state.agentAccount, agent.uid])];
  const conversationStatus = binding => binding?.uncertain && !binding.busy ? 'Delivery needs review' : ({ opening: 'Opening session…', selected: 'Agent ready · no message sent', waiting: 'Waiting for agent…', ready: 'Reply received', working: 'Agent task in progress', failed: 'Conversation needs attention' })[binding?.status];
  const canTalk = agent => agent.runtimeState !== 'not_deployed' && agent.responseKinds?.some(kind => ['message', 'task'].includes(kind));
  const talk = (agent, compact = false) => canTalk(agent) ? button(`agent-talk-${agent.uid}`, compact ? '💬' : 'Talk to agent', () => actions.talkToAgent(agent.uid)) : null;
  const unavailable = agent => !canTalk(agent) && muted(agent.runtimeState === 'not_deployed' ? 'Deploy this agent to start a conversation.' : 'This agent does not advertise messaging support.');
  const agentStatus = agent => state.agentPreparing[agent.uid] ? state.agentPreparing[agent.uid].phase : conversationStatus(bindingFor(agent));
  const auth = state.results['devtools.auth-status'];
  if (auth?.data?.authenticated === false || auth?.error?.code === 'NOT_AUTHENTICATED') return section('agents-sign-in', [text('Sign in to discover agents', { bold: true }), muted('Use your MainSequence account to see the agents available to you.'), button('agents-login', 'Go to MainSequence login', () => actions.tab('General'))]);
  if (!state.fields.mcpEnvironment) return section('agents-select-environment', [text('Choose an environment', { bold: true }), muted('The environment above controls both agents and MCP tools.')]);
  const detail = state.agentDetail;
  if (detail) return column([
    button('agents-back', '← All agents', actions.closeAgentDetails),
    section('agent-details', [identity(detail, true), muted(status(detail)), text(detail.description), text('Capabilities', { bold: true }),
      ...(detail.skills?.length ? detail.skills.map(skill => column([text(skill.name, { bold: true }), muted(skill.description)])) : [muted('The agent card does not list individual skills. Ask the agent for details.')]),
      text('Example questions', { bold: true }), ...((detail.skills || []).flatMap(skill => skill.examples || []).slice(0, 8).map(example => text(`“${example}”`))),
      muted('Talk opens or resumes this agent’s session, waits until it is ready, then prepares Claude’s input. Only the message you submit is sent.'), talk(detail), unavailable(detail),
      button('agent-new-conversation', 'Start new conversation…', () => actions.newAgentConversation(detail.uid)),
    ]),
  ]);
  const result = state.results['devtools.agents-list'], page = record(result?.data);
  const agents = rows(page).filter(agent => agent.environmentUid === state.fields.mcpEnvironment);
  return column([
    row([text('Agents', { bold: true }), button('agents-refresh', state.agentsLoading ? 'Loading…' : 'Refresh', actions.refreshAgents)]),
    column([text('Search agents'), Box({ flexDirection: 'row', alignItems: 'center', gap: 1, children: [
      Box({ flexGrow: 1, flexShrink: 1, minWidth: 0, children: [Input({ key: 'field-agentSearch', value: state.fields.agentSearch, placeholder: 'Name or capability', onInput: value => actions.field('agentSearch', value), onSubmit: value => { actions.field('agentSearch', value); actions.refreshAgents(); } })] }),
      Box({ flexShrink: 0, children: [button('agents-search', 'Search', actions.refreshAgents)] }),
    ] })]),
    result?.status === 'failure' && section('agents-error', [text('Agents couldn’t be loaded', { bold: true }), muted(result.summary), button('agents-retry', 'Try again', actions.refreshAgents)]),
    state.agentsLoading && muted('Loading agents from this environment…'),
    result?.status === 'success' && !agents.length && section('agents-empty', [text(state.fields.agentSearch.trim() ? 'No matching agents' : 'No agents in this environment', { bold: true }), muted('Try another search or choose another environment above.')]),
    result?.status === 'success' && agents.length && muted(page.semantic ? `${agents.length} matching agents` : `${page.count} agents · showing ${state.agentOffset + 1}–${state.agentOffset + agents.length}`),
    ...agents.map(agent => section(`agent-${agent.uid}`, [
      Box({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 1, children: [
        Box({ flexDirection: 'column', flexGrow: 1, flexShrink: 1, minWidth: 0, children: [identity(agent)] }),
        Box({ key: `agent-actions-${agent.uid}`, flexDirection: 'row', flexShrink: 0, alignItems: 'center', gap: 1, children: [
          button(`agent-details-${agent.uid}`, 'ⓘ', () => actions.agentDetails(agent.uid)), talk(agent, true),
        ].filter(Boolean) }),
      ] }),
      defaults(agent),
      agentStatus(agent) && text(agentStatus(agent), { key: `agent-status-${agent.uid}`, dimColor: true }),
      state.agentPreparing[agent.uid] && button(`agent-prepare-cancel-${agent.uid}`, 'Cancel', () => actions.cancelAgentPreparation(agent.uid)),
      !state.agentPreparing[agent.uid] && bindingFor(agent)?.error && muted(bindingFor(agent).error),
      bindingFor(agent)?.status === 'failed' && !state.agentPreparing[agent.uid] && button(`agent-prepare-retry-${agent.uid}`, 'Try again', () => actions.talkToAgent(agent.uid)),
      bindingFor(agent)?.task && muted(`Task: ${bindingFor(agent).task.status}${bindingFor(agent).task.cancellationRequested ? ' · Cancellation requested' : ''}`),
      bindingFor(agent)?.uncertain && muted('The previous request may have reached the agent. Review Activity before sending again.'),
      unavailable(agent),
    ])),
    !page.semantic && row([state.agentOffset > 0 && button('agents-previous', 'Previous page', actions.previousAgents), state.agentOffset + agents.length < page.count && button('agents-next', 'Next page', actions.nextAgents)]),
  ]);
}
