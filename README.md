# MainSequence for Claude Desktop Code

This repository owns the Claude Desktop integration: native UI, lifecycle hooks,
Claude account switching, worker transport, tests, packaging and marketplace.
Reusable MainSequence functionality comes from the exact version of
`@dev-mainsequence/devtools` pinned in package.json and package-lock.json.

## Install

In Claude Desktop, open **Customize → Plugins → Add marketplace → Add from repository**
and enter `https://github.com/mainsequence-sdk/mainsequence-claude-desktop.git`.
Install **MainSequence** from `mainsequence-desktop` and enable it in a local Code session.
Node 22+ is required. See [installation and features](docs/claude-desktop.md).

This is a preview. Live account request identity/host refresh remain unverified;
signed terminal, session-folder switching and container launching remain host gaps.
See [verification](docs/claude-desktop-verification.md).

## Develop

Run `npm ci`, `npm test`, then `npm run pack:claude`. The build bundles the pinned
shared package and this repository's worker into a self-contained plugin ZIP.
It does not copy shared source from another checkout or require runtime npm access.
Use `npm run release:check` before creating a release. Set
`MS_CLAUDE_DESKTOP_BINARY` to run native engine validation and simulator tests.

- [Architecture and dependency boundaries](docs/adr/0004-claude-desktop-mod.md)
- [Distribution, updates and rollback](docs/claude-desktop-distribution.md)
- [Shared devtools source and API](https://github.com/mainsequence-sdk/mainsequence-devtools)

Plugin and shared-package versions are independent. Release archives have pinned
checksums; users' account/profile configuration is independent of plugin updates.
