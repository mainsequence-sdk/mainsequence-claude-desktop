# MainSequence for Claude Desktop Code

MainSequence provides a native pane in local Claude Desktop Code sessions. The
approved layout has six visible sections with one active selection: **General,
Projects, Current Project, MCP, Agents, Activity**. There is no Tools picker, Accounts page,
rotation configuration or launcher strip above the chat. The MainSequence emblem
comes from MainSequencePublic.

## Installation and opening

Use Claude Desktop with function-hook plugins and streaming process support, plus
Node 22+. The bundled Code engine tested during development is 2.1.295; the version
of a separately installed command-line client does not establish GUI compatibility.
The startup guard rejects engines older than 2.1.286; this is not a claim that every
intermediate build has been tested.

In **Customize → Plugins → Add marketplace → Add from repository**, enter
`https://github.com/mainsequence-sdk/mainsequence-claude-desktop.git` and install
MainSequence from `mainsequence-desktop`. The catalog supplies a versioned ZIP with
a pinned SHA-256. A local build remains unpublished until the release workflow runs.
You can also upload a built ZIP using **Add plugin → Upload plugin**.

Enable the plugin in a local Code session. Click **MainSequence** to open its
native pane; startup and plugin reloads do not automatically open it. The button in
the session footer remains available when the pane is closed. Click the
button to reopen and focus the same pane without typing a command or submitting
a message. `/ms` remains an optional fallback. The launcher preserves existing
footer controls and does not read or save settings, accounts or credentials.
It appears in local Code sessions with the plugin loaded, not on Claude's home
screen or unrelated chat surfaces. Claude controls its final position and native
button styling: the tested Desktop build renders a compact text button in the
footer and displays the MainSequence emblem in the pane header. The hook also
provides the emblem beside the launcher for hosts that render footer SVGs. The plugin
does not patch the Desktop application or register an unsupported toolbar button.
The approved browser preview defines grouping, navigation and content, not custom
CSS injected into the Desktop application.

Git/SSH, uv for Python, npm for frontend projects and Docker/buildx for builds are
required only for the corresponding operations. They are not installed silently.
If Desktop cannot locate Node, configure its absolute path through the plugin's
Node executable setting or **General → Advanced → Runtime & diagnostics →
Executable overrides**.

Agent icons now appear in the directory, details, composer activity band and
attributed command/tool rows. See [animation behavior and limits](agent-icons.md).

## General: MainSequence login and settings

The pane reads the existing MainSequence session on startup without initiating a
new sign-in. It reads the existing local repositories preference when available;
a missing preference defaults to the user's `mainsequence` home folder. These
startup reads do not overwrite configuration.

Use **Sign in with browser** for MainSequence authorization. A signed-in card shows
the account and connection state. **Check connection** verifies it; **Manage
account** expands **Renew session** and the confirmed **Sign out** action. These use
the existing shared machine-session service and concern MainSequence only.

Workspace settings show actual editable values, not example placeholders. Saved
plugin values take precedence. Otherwise, shared devtools resolves the backend from
`MAINSEQUENCE_ENDPOINT`, then the existing MainSequence configuration, then
`https://api.main-sequence.app`. The repositories folder uses the existing absolute
`mainsequence_path`, otherwise `<home>/mainsequence` displayed as a full path.
Defaults are usable without saving and do not depend on successful authentication.
Startup resolution never overwrites a user's in-progress edits. Edits apply for the
current session; **Save settings** retains them for future sessions. Unknown/legacy
fields remain intact. Startup never writes the shared configuration.
Runtime diagnostics and the Node executable override are collapsed under Advanced.
Technical JSON is hidden until requested.

## Projects and Current Project

Opening Projects loads the existing repository list through shared devtools APIs.
Choose a repository and branch, then **Set up locally** or **Set up & install**.
A single available branch is selected automatically. Setup uses the canonical
`<base>/<organization>/projects/<name>-<uid>` layout and repository SSH identity.
Existing local copies lead to **Manage project** instead of another clone.

Current Project contains project status, dependency/SDK operations, instructions,
skills and workspace tools. Selecting a folder changes the operation target, not
Claude's session working directory. Mutations have explicit confirmations; supported
previews remain separate. Stale results are discarded after context changes.

MainSequence supports the existing one-saved-identity-per-backend credential model.
Setup writes the endpoint without copying access tokens into the project. **Clean
legacy environment credentials** is an explicit project action; signing in does
not silently migrate other projects or rewrite their provider settings.

## MCP and Activity

Choose an **Organization environment** in MCP or Agents. The choices come from the existing
MainSequence organization-environments endpoint. No environment is selected
implicitly, including Production. The choice is remembered per backend in the
plugin store, independently of General's Save button, and is validated when a new
session restores it. Changing it scopes discovery, connected MCPs, tool inspection,
and Claude tool calls to that environment. Labels and tool confirmations show the
environment name. Other environments' connections stay saved.

MCP discovery runs alongside connected-tool registration. Select a connected MCP
and choose **View tools** to browse its catalog. Large selectors have Previous/Next
controls, keeping all entries accessible within Claude's 64-option native limit.
Selecting a tool displays its description. Late results from another MCP cannot
replace the selected catalog.

The shared devtools API validates the current release environment before exchanging
credentials or calling an MCP. Switching environments clears pending confirmations,
cancels outstanding MCP workers, and immediately denies stale registered tools. An
operation already sent remotely may have completed before cancellation; inspect
Activity rather than assuming rollback. This restricts this plugin's MCP actions;
it does not change permissions or configuration of unrelated clients.

Desktop's mod API has no tool-unregister operation: old tool names can remain in an
existing session's advertised catalog, but are refused by the handler. A fresh Code
session starts with only the saved, validated environment's tools. New registrations
are available from the next prompt. Exact release identities remain pinned.

Activity shows actual operations from the session, their running/completed/failed/
cancelled status, progress text, outcome and partial-effect warnings. Result details
are collapsed. Cancellation stops the worker stream; it does not promise rollback.
When there are no operations, the empty state links to Projects and MCP.

Local setup shows its current progress beside the repository controls immediately
after confirmation. Setup buttons stay disabled for that destination while work
runs. You can cancel there, follow progress from another section, and open or manage
the resulting folder on completion. Failure and cancellation release the controls;
retry is explicit and never replays automatically.

The browser preview used illustrative operations and setup steps. Production uses
real worker progress messages: no fabricated percentages, step counts or sample
history. Raw subprocess stderr stays private.

## Agents

The [Agents guide](agents.md) explains environment-scoped discovery, direct
conversation through Claude, task polling, local continuity and uncertain requests.

## Feature coverage and host adaptations

| Extension feature | Desktop behavior |
| --- | --- |
| Browser login, renewal, logout/revocation and status | Shared machine-session service through native controls. |
| Backend/base-folder settings and folder picker | Plugin settings plus a macOS native folder chooser. |
| Python/frontend repository listing, branches, setup and SSH | Remote repository and branch selectors, clone/setup with repository SSH identity, and optional dependency installation. Supported types are Python and Vite/React. |
| Local discovery and safe deletion | Canonical folder checks, preview, explicit confirmation and a fresh Git/path fingerprint. Deletion permanently removes the selected local repository, including uncommitted/untracked files; the remote repository is retained. Linked worktrees and submodules are refused. |
| Git root/worktree/origin/branch/commit and backend resolution | Shared status/resolve actions. |
| Environment bootstrap, renewal and credential migration | Machine-session renewal, endpoint-only setup, and an explicit legacy-environment cleanup action. Unrelated environment settings are preserved. |
| Dependency install and sync | Python installation uses `uv sync`; frontend installation uses `npm ci`. Dependency-only synchronization uses the project-local SDK. Mutating operations use repository locks and cancellation. |
| SDK status and supported updates | Existing SDK contracts; no invented Python update support. |
| SDK skills and instructions | Python instruction updates, frontend skill installation with a preview, and shared skills synchronization with MCP skills enabled for this host. User instructions remain governed by the SDK's merge behavior. |
| Open folder | Reveals the selected directory in the OS folder viewer. Selecting an action target does not silently change the Code session's working directory. |
| Signed terminal | Represented in the UI and capability model. The current adapter has no supported native terminal-opening callback; it reports unavailable. |
| Docker build | Reviews image/platform/arguments, requires the repository-root Dockerfile, then runs a local buildx build with image loading, a shared repository lock, progress and cancellation; waits for completion. |
| Devcontainer configuration | Preview and digest-checked JSONC edit; preserves comments and custom fields. Existing Compose/build-based configurations are refused rather than rewritten into incompatible image-based ones. |
| Reopen in container | Current mod APIs do not provide an implemented Desktop container-session launcher. The action reports unavailable; it never opens VS Code as an implicit substitute. |
| Diagnostics/errors/previews | Bundle/runtime checks, actionable errors, Activity results/cancellation, explicit mutation confirmations, and previews for supported SDK/skills operations, Docker, container configuration and local deletion. Cancellation can leave partial effects, which are reported. |
| Agent discovery and conversations | Shared environment selector, public card details, session preparation without sending, editable native command drafts, separate per-agent status and approved follow-ups, Task status/wait/cancel and local conversation continuity. |
| MCP discovery/connections/tools | Search/paginate project MCPs, connect/disconnect exact releases, inspect/call tools and register them for Claude. Tool calls request approval and disconnected tools are refused. |

The signed-terminal, session-navigation and container-launch limitations are explicit
host gaps, not completed parity claims. Every action remains accounted for in this
table. Dormant legacy extension panels/scripts are not treated as active features.

## Claude accounts and provider preservation

Claude account switching is removed in 0.4.0. The plugin has no account list,
sign-in/rotation controls, usage thresholds, token projection, quota polling,
credential refresh/recovery loop or account-related prompt/model-dispatch hooks. The worker rejects
the former `accounts` domain. Claude's own account and provider controls manage
model authentication.

The plugin does not read, modify, migrate or delete Claude Keychain entries,
credential files, saved profiles, provider configuration or OAuth environment
variables. Earlier MainSequence account metadata under
`~/.config/mainsequence/claude-accounts/` is left intact and unused. The obsolete
Claude executable setting is ignored; unrelated existing settings are retained.
No backend endpoints, schema or configuration are changed by this release.

## Upgrade, removal and troubleshooting

Update through the plugin manager or install the built archive. Fully close old
Code sessions and start fresh sessions after upgrading from 0.3.x. An already
running old plugin process retains its old hooks until it exits. This release does
not try to rewrite authentication inside that process or delete stored profiles.
Disabling/uninstalling the plugin does not revoke MainSequence credentials or
remove projects. Use MainSequence's confirmed Sign out action only when desired.

If the pane is missing, verify a local Code session with the plugin enabled, then
use `/ms`. For worker failures, open **General → Advanced → Runtime & diagnostics**.
For operation failures, inspect Activity before retrying; cancellation can leave
partial filesystem effects. Backend changes clear stale connection/repository
results so another backend's state is not displayed as current.

See [verification](claude-desktop-verification.md),
[distribution](claude-desktop-distribution.md) and
[architecture](adr/0004-claude-desktop-mod.md).
