# MainSequence for Claude Desktop Code

MainSequence adds one native developer-tools pane with a status header and five
sections: **Home, Code, Projects, Agents and Tools**. The header shows the signed-in
account, the organization environment, running operations (which open **Activity**)
and **Settings**, where MainSequence browser login, session renewal, connection checks
and workspace settings live. The pane uses the MainSequence emblem and Claude's own
theme; it adds no strip above the prompt.

[Version **0.4.11**](https://github.com/mainsequence-sdk/mainsequence-claude-desktop/releases/tag/v0.4.11)
is the [pane redesign](docs/ux-proposal.md): lists of rows instead of dropdowns, one
primary action per view, status colours, disabled-with-reason controls, confirmations
that keep the navigation visible, and `/ms @agent <message>` naming the receiving agent.

The current local build adds [animated agent icons](docs/agent-icons.md) to the
directory, details and conversation UI, using the platform’s existing icon assets.

[Version **0.4.4**](https://github.com/mainsequence-sdk/mainsequence-claude-desktop/releases/tag/v0.4.4)
uses Claude's native theme and compact agent rows: name, details and Talk on the
same row. Section buttons have no surrounding cards or custom colors.
Talk opens or resumes the selected agent's session using Claude's session ID and
prefills the existing input without sending. Each agent keeps its own status.

[Version **0.4.3**](https://github.com/mainsequence-sdk/mainsequence-claude-desktop/releases/tag/v0.4.3) adds a persistent **MainSequence** button in the Code session
footer. It reopens the existing pane after it is closed;
`/ms` remains an optional fallback. Opening the pane does not submit a chat prompt
or save settings. See [verification](docs/claude-desktop-verification.md) for native
and live Desktop evidence.

[Version **0.4.2**](https://github.com/mainsequence-sdk/mainsequence-claude-desktop/releases/tag/v0.4.2) adds [environment-scoped agents and direct conversation through
Claude](docs/agents.md). MCP and Agents share the selected environment; agent
introductions and approved follow-ups use the existing MainSequence gateway.

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
releases. Shared functionality comes from the exact `@dev-mainsequence/devtools`
package API and is bundled into the portable ZIP. Desktop needs no sibling checkout
or runtime npm download.

Version **0.4.4** pins the public devtools **0.2.5** archive and implements
[ADR 0005](docs/adr/0005-user-authored-agent-interactions.md). The lockfile records
the registry URL and integrity. Use `npm ci --ignore-scripts` and the
[coordinated release procedure](docs/agents.md#verification-and-coordinated-release).

Run `npm run release:check` after installing the exact dependency. Set
`MS_CLAUDE_DESKTOP_BINARY` for native loader validation and simulator tests.

- [Architecture and dependency boundaries](docs/adr/0004-claude-desktop-mod.md)
- [Agent interaction decision and verification requirements](docs/adr/0005-user-authored-agent-interactions.md)
- [Distribution, updates and rollback](docs/claude-desktop-distribution.md)
- [Verification and remaining host limitations](docs/claude-desktop-verification.md)
- [Shared devtools source](https://github.com/mainsequence-sdk/mainsequence-devtools)

Signed terminal, changing the Code session's root, and container-session launching
remain host limitations. Native layout chrome/placement is controlled by Claude.

### 0.4.5 — prepare agents before writing

Talk creates or resumes the same session and waits for the agent to become ready
before prefilling Claude's existing input. Per-agent progress, cancellation and retry
preserve drafts; no message is sent automatically. Explicit sends recheck readiness.
Each agent also shows its default provider, model and thinking setting beneath its name.
The shared implementation is devtools 0.2.6. MainSequence session renewal remains
under Settings → MainSequence account → Manage account. Accounts, provider choices,
saved settings and backend contracts require no migration.

### 0.4.6 — MCP release connections

Claude bundles devtools 0.2.7 so releases whose detail responses omit `name` can
connect, register tools and receive tool calls. Saved connections without a display
name use the release UID in selectors, tool descriptions and availability errors.
Connection identity, environment scoping and tool-call confirmations remain intact.

### 0.4.7 — repositories and MainSequence projects

Repository setup and SDK actions now live in **Code** (called Repositories and
Current Repository in 0.4.7). **Projects** lists real MainSequence projects in the environment
shared with MCP and Agents, with links to their repositories and exact branches.
Set the optional Command Center URL in Settings for platform links; otherwise
repository links use the authorized GitHub binding.

**Projects → select a project → Set up project locally** prepares missing
repositories, creates or reuses its local Claude workspace and selects each
assigned branch in an independent checkout. Existing edits are preserved and
dirty branch switches stop with an explanation. Claude then opens the workspace
through its native folder link, where you confirm the folder. Its displayed name
matches the MainSequence project exactly. The enabled plugin then adds every
repository to the new session using local `/add-dir` commands, without a model turn.
See [local project setup](docs/claude-desktop.md#mainsequence-projects).

This version bundles devtools **0.2.8**. Before that package is published, install
the prepared, integrity-checked archive with
`node scripts/use-local-devtools.cjs /absolute/path/dev-mainsequence-devtools-0.2.8.tgz`
using the already installed development dependencies, then run `npm run release:check`.
The ZIP includes the complete runtime; end users need no sibling checkout.

### 0.4.11 — pane redesign

The pane has a persistent header (account, environment, running operations,
Settings) and five sections: **Home** (next steps, this session's repository status,
recent activity), **Code** (one list of remote and local repositories with a detail
view that is the operation target), **Projects**, **Agents** and **Tools** (connected
MCPs first; Add MCP searches releases; the tool explorer sits under Advanced).
Confirmations appear above the view instead of replacing it, unavailable actions are
shown disabled with a reason, results and statuses use Claude's success, warning and
error colours, and the running count also appears in Claude's status line. Talk fills
Claude's input with `/ms @<agent-handle> ` so the command names the agent that receives
the message; the explicit `/ms agent <uid> <message>` and `/ms task <uid> <message>`
forms still work, a bare `/ms <message>` is refused with the prepared handles, and
example questions in an agent's details fill the input when pressed. The composer band
above the prompt gains **Switch agent**. No worker, backend, credential or
configuration contract changes. See [the proposal](docs/ux-proposal.md) and its
[mockup](docs/ux-proposal-mockup.html).

### 0.4.12 — agent icons

Agents with valid Command Center icons now show them even when another agent in the
same batch has an empty icon record. See the [release notes](docs/releases/0.4.12.md).

### 0.4.13 — tools after a reload

MainSequence MCP tools stay usable after `/reload-plugins`: the plugin finishes startup
from the desktop surface, its first draw, or the first tool call, and that call waits for
registration instead of being refused. See the [release notes](docs/releases/0.4.13.md).

### 0.4.14 — MCP content blocks

MCP images and other non-text blocks are converted to the content blocks Claude
accepts. See the [release notes](docs/releases/0.4.14.md).
