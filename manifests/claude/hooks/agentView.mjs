import { clean, record, rows } from './model.mjs';

export function renderAgents(ui, state, actions) {
  const { Box, Text, Button, Input } = ui;
  const text = (value, props = {}) => Text({ ...props, children: [clean(value)] });
  const muted = value => text(value, { dimColor: true });
  const column = children => Box({ flexDirection: 'column', gap: 1, children: children.filter(Boolean) });
  const row = children => Box({ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1, children: children.filter(Boolean) });
  const button = (key, label, onPress) => Button({ key, label, onPress });
  const card = (key, children) => Box({ key, flexDirection: 'column', padding: 2, gap: 1, borderStyle: 'round', borderDimColor: true, children: children.filter(Boolean) });
  const primary = (key, label, onPress) => Box({ padding: 1, borderStyle: 'round', borderColor: '#bda27f', backgroundColor: '#35312c', children: [button(key, label, onPress)] });
  const status = agent => ({ current: 'Runtime current', not_deployed: 'Not deployed', updating: 'Updating', update_required: 'Update available', update_failed: 'Update failed', unknown: 'Status unknown' }[agent.runtimeState] || 'Status unknown');
  const identity = agent => row([Box({ padding: 1, borderStyle: 'round', borderColor: '#5a5044', backgroundColor: '#2a251f', children: [text(agent.name.split(/\s+/).slice(0, 2).map(part => part[0]).join(''), { bold: true, color: '#dbc5a5' })] }),
    Box({ flexGrow: 1, flexShrink: 1, flexDirection: 'column', gap: 1, children: [text(agent.name, { bold: true }), muted(`${agent.environmentName} · ${agent.repositoryBranch || 'Branch unavailable'}`)] })]);
  const canTalk = agent => agent.runtimeState !== 'not_deployed' && agent.responseKinds?.includes('message');
  const talk = agent => canTalk(agent) ? primary(`agent-talk-${agent.uid}`, state.agentStarting ? 'Preparing conversation…' : state.activeAgent?.agent.uid === agent.uid && state.activeAgent.status !== 'failed' ? 'Continue in Claude' : 'Talk to agent', () => actions.talkToAgent(agent.uid))
    : muted(agent.runtimeState === 'not_deployed' ? 'Deploy this agent to start a conversation.' : 'This agent does not advertise Message support.');
  const auth = state.results['devtools.auth-status'];
  if (auth?.data?.authenticated === false || auth?.error?.code === 'NOT_AUTHENTICATED') return card('agents-sign-in', [text('Sign in to discover agents', { bold: true }), muted('Use your MainSequence account to see the agents available to you.'), button('agents-login', 'Go to MainSequence login', () => actions.tab('General'))]);
  if (!state.fields.mcpEnvironment) return card('agents-select-environment', [text('Choose an environment', { bold: true }), muted('The environment above controls both agents and MCP tools.')]);
  const detail = state.agentDetail;
  if (detail) return column([
    button('agents-back', '← All agents', actions.closeAgentDetails),
    card('agent-details', [identity(detail), muted(status(detail)), text(detail.description), text('Capabilities', { bold: true }),
      ...(detail.skills?.length ? detail.skills.map(skill => column([text(skill.name, { bold: true }), muted(skill.description)])) : [muted('The agent card does not list individual skills. Ask the agent for details.')]),
      text('Example questions', { bold: true }), ...((detail.skills || []).flatMap(skill => skill.examples || []).slice(0, 8).map(example => text(`“${example}”`))),
      muted('Capabilities come from the agent card. Talking asks the agent to explain its required inputs and examples.'), talk(detail),
      button('agent-new-conversation', 'Start new conversation…', () => actions.newAgentConversation(detail.uid)),
    ]),
  ]);
  const result = state.results['devtools.agents-list'], page = record(result?.data);
  const agents = rows(page).filter(agent => agent.environmentUid === state.fields.mcpEnvironment);
  const active = state.activeAgent;
  return column([
    row([text('Agents', { bold: true }), button('agents-refresh', state.agentsLoading ? 'Loading…' : 'Refresh', actions.refreshAgents)]),
    muted('Choose an agent. Claude will ask what it can do and bring its reply into your conversation.'),
    Input({ key: 'field-agentSearch', label: 'Search agents', value: state.fields.agentSearch, placeholder: 'Search names or capabilities', onInput: value => actions.field('agentSearch', value), onSubmit: value => { actions.field('agentSearch', value); actions.refreshAgents(); } }),
    button('agents-search', 'Search agents', actions.refreshAgents),
    active && card('agent-conversation-status', [text(`${active.agent.name} · ${active.agent.environmentName}`, { bold: true }),
      text(({ queued: 'Introduction queued for Claude', waiting: 'Waiting for agent', ready: 'Connected · continue in Claude’s chat', working: 'Agent task in progress', failed: 'Conversation needs attention' })[active.status] || active.status),
      active.task && muted(`Task: ${active.task.status}${active.task.cancellationRequested ? ' · Cancellation requested' : ''}`),
      active.uncertain && muted('The previous request may have reached the agent. Do not resend automatically. Review Activity before starting again.'),
      button('agent-active-details', 'Agent details', () => actions.agentDetails(active.agent.uid)),
    ]),
    result?.status === 'failure' && card('agents-error', [text('Agents couldn’t be loaded', { bold: true }), muted(result.summary), button('agents-retry', 'Try again', actions.refreshAgents)]),
    state.agentsLoading && muted('Loading agents from this environment…'),
    result?.status === 'success' && !agents.length && card('agents-empty', [text(state.fields.agentSearch.trim() ? 'No matching agents' : 'No agents in this environment', { bold: true }), muted('Try another search or choose another environment above.')]),
    result?.status === 'success' && agents.length && muted(page.semantic ? `${agents.length} matching agents` : `${page.count} agents · showing ${state.agentOffset + 1}–${state.agentOffset + agents.length}`),
    ...agents.map(agent => card(`agent-${agent.uid}`, [identity(agent), text(agent.description), row([muted(status(agent)), button(`agent-details-${agent.uid}`, 'Details', () => actions.agentDetails(agent.uid))]), talk(agent)])),
    !page.semantic && row([state.agentOffset > 0 && button('agents-previous', 'Previous page', actions.previousAgents), state.agentOffset + agents.length < page.count && button('agents-next', 'Next page', actions.nextAgents)]),
  ]);
}
