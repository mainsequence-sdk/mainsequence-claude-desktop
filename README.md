# MainSequence for Claude Desktop Code

MainSequence adds one native developer-tools pane with **General, Projects,
Current Project, MCP, Agents and Activity**. General keeps MainSequence browser login,
session renewal, connection checks and workspace settings. The pane uses the
MainSequence emblem and one coordinated section selection; it adds no strip above
the prompt.

The **0.4.2 implementation candidate** adds [environment-scoped agents and direct
conversation through Claude](docs/agents.md). It is not yet in the public marketplace.

Version **0.4.1** adds editable workspace defaults and an organization-environment
selector that scopes MCP discovery and tool use. Saved settings take precedence,
and defaults work without saving.

Version **0.4.0** removed Claude account switching, rotation, quota controls,
credential overrides and account workers. Claude manages its own accounts and model
providers. Existing credentials, saved profiles and provider configuration are
retained; this release has no account migration or deletion routine.

## Install

Use the published marketplace in Claude Desktop: **Customize → Plugins → Add
marketplace → Add from repository**, then enter
`https://github.com/mainsequence-sdk/mainsequence-claude-desktop.git`.
Install MainSequence from `mainsequence-desktop` and enable it in a local Code
session. The marketplace serves the published version; a local build does not
update it. Node 22+ is required.

For an approved local build, use the ZIP produced by `npm run pack:claude` with
Claude's **Add plugin → Upload plugin** flow. Restart existing Code sessions after
upgrading from 0.3.x so the removed hooks cannot remain loaded in an old process.
See [installation, features and upgrade behavior](docs/claude-desktop.md).

## Architecture and development

This repository owns Claude UI, lifecycle hooks, worker transport, tests and
releases. Shared functionality is imported from the exact
`@dev-mainsequence/devtools` dependency. The Agents candidate pins the published
0.2.4 npm archive, verified by a clean install and exact lockfile integrity.
It is bundled into the ZIP; no sibling
checkout, backend change or runtime npm download is required.

Run `npm ci` and `npm run release:check`. Set `MS_CLAUDE_DESKTOP_BINARY` to include
native loader validation and simulator tests against Desktop's bundled engine.

- [Architecture and dependency boundaries](docs/adr/0004-claude-desktop-mod.md)
- [Distribution, updates and rollback](docs/claude-desktop-distribution.md)
- [Verification and remaining host limitations](docs/claude-desktop-verification.md)
- [Shared devtools source](https://github.com/mainsequence-sdk/mainsequence-devtools)

Signed terminal, changing the Code session's root, and container-session launching
remain host limitations. Native layout chrome/placement is controlled by Claude.
