/** Same priority as Command Center's resolveAgentIconPose. */
export function resolveAgentIconPose(icon, activity) {
  if (!activity) return 'idle';
  const declared = pose => pose && Object.hasOwn(icon?.images || {}, pose) && icon.images[pose] ? pose : null;
  if (activity.tool?.phase === 'running') return declared(icon?.toolPoses?.[activity.tool.application]) || declared('working') || 'idle';
  if (activity.tool?.phase === 'failed' || activity.failed) return declared('error') || 'idle';
  return activity.thinking ? declared('thinking') || 'idle' : 'idle';
}

export function agentIconActivity(binding) {
  return { thinking: binding?.iconPhase !== 'approval' && !!(binding?.busy || binding?.status === 'working'),
    failed: !binding?.busy && (binding?.status === 'failed' || ['failed', 'rejected'].includes(binding?.task?.status)), tool: null };
}

/** The largest Svg markup Desktop is trusted to draw. The engine accepts 128 KiB, but in the live app
 * animated icons of 43-45 KB never appeared while every one up to 40 KB did; 32 KiB keeps a margin.
 * The worker sends icons within it; records an older worker cached may not be. */
export const AGENT_ICON_DRAWN_MAX = 32768;

export function renderAgentIcon(ui, state, agentUid, { size = 20, animate = true, activity = null } = {}) {
  const icon = state.agentIcons?.[agentUid], pose = resolveAgentIconPose(icon, activity);
  const image = icon?.images?.[pose] || icon?.images?.idle;
  if (!image || typeof image.source !== 'string' || typeof image.stillSource !== 'string') return null;
  // An animated source too heavy to draw falls back to its still frame, a few KB.
  const source = animate && image.source.length <= AGENT_ICON_DRAWN_MAX ? image.source : image.stillSource;
  if (source.length > AGENT_ICON_DRAWN_MAX) return null;
  return ui.Box({ key: `agent-icon-${agentUid}-${size}`, flexShrink: 0, children: [ui.Svg({ source, alt: 'Agent icon', width: size, height: size,
    // Desktop renders this as a native image. The SVG carries its own media queries;
    // no script, remote URL or frame timer crosses the widget boundary.
    isInteractive: false })] });
}

export function renderAgentActivity(ui, state, binding) {
  if (!binding) return null;
  const activity = agentIconActivity(binding);
  const label = binding.uncertain && !binding.busy ? 'Delivery needs review'
    : binding.iconPhase === 'approval' ? 'Review agent request' : binding.busy ? 'Waiting for agent…' : binding.status === 'working' ? 'Agent task in progress'
    : activity.failed ? 'Conversation needs attention' : binding.status === 'ready' ? 'Reply received · your next message goes here too' : 'Agent ready · your messages go here';
  return ui.Box({ key: 'agent-chat-activity', flexDirection: 'row', flexWrap: 'wrap', flexShrink: 1, minWidth: 0, alignItems: 'center', gap: 1,
    children: [renderAgentIcon(ui, state, binding.agent.uid, { size: 24, activity }),
      ui.Text({ children: [binding.agent.name] }), ui.Text({ dimColor: true, children: [label] })].filter(Boolean) });
}
