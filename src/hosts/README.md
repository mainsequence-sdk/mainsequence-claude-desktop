# Claude host adapters

These modules implement native Claude-specific transport and UI integration.
Shared project operations, Agent messaging and authentication are consumed only
through the pinned devtools package's public API.

- `claudeProtocol.ts` validates the private worker envelope and produces fixed,
  credential-free failure results.
- `claudeProjectActions.ts` bridges native folder/workspace operations to shared
  project services.
- `claudeAgentIcons.ts` bridges the platform's authenticated media responses to
  Claude's bounded Svg widgets. Its injected fetch adapter converts only canonical
  icon responses to JSON inside the public session service, preserving that
  service's credential and renewal policy. It limits bytes, validates exact
  environment membership and delivery paths, and derives APNG frame-zero stills.
- MCP names need no adapter since devtools 0.3.1 stores them with the saved connection
  and labels discovery rows on request (`enrichNames`); `claudeMcpNames.ts` was removed
  in 0.4.19. Registered project tools (names, definitions, results and the shared
  catalog) come from devtools' project-tool registry (devtools ADR 0004) through the
  `mcp-catalog` and `mcp-tool-call` actions; the hook only registers, asks and renders.

- `claudeDeployments.ts` reads the environment's deployment history, one run and its
  logs through the public session service, projecting only what the pane and the
  `ms_deployment_status` tool draw: identity, states, timings, steps, owned runs and
  error text. Billing and cost fields are never copied. A run that answers 404 is
  described with Command Center's "You can't see this deployment" wording, which
  does not assert whether the record exists.

Hook-side rendering and transient caching live in `manifests/claude/hooks/`.
See [agent icon behavior and current transport limits](../../docs/agent-icons.md).
