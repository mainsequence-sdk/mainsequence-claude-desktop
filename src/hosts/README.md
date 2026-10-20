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
- `claudeMcpNames.ts` adds repository names to MCP presentation results using
  existing release metadata and the public RepositoryClient. Labels contain just
  the name. Exact release/environment matching preserves routing; optional name
  lookup failures preserve the original result and never rewrite saved connections.

Hook-side rendering and transient caching live in `manifests/claude/hooks/`.
See [agent icon behavior and current transport limits](../../docs/agent-icons.md).
