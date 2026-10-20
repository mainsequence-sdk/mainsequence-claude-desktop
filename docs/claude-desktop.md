# MainSequence for Claude Desktop Code

MainSequence provides a native pane in local Claude Desktop Code sessions. Since
0.4.11 the layout is a status header plus five sections with one active selection:
**Home, Code, Projects, Agents, Tools**. The header shows the account, the organization
environment, a running-operations counter that opens **Activity**, and **Settings**.
There is no Accounts page, rotation configuration or launcher strip above the chat.
Earlier releases used seven peer sections (General, Repositories, Current Repository,
Projects, MCP, Agents, Activity); the [redesign proposal](ux-proposal.md) records why
they were merged. The MainSequence emblem
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

The local candidate also shows [platform agent icons](agent-icons.md) in the agent
directory, details, composer activity band and attributed command/tool rows. Existing native
transcript content and footer controls remain visible.

Git/SSH, uv for Python, npm for frontend repositories and Docker/buildx for builds are
required only for the corresponding operations. They are not installed silently.
If Desktop cannot locate Node, configure its absolute path through the plugin's
Node executable setting or **Settings → Advanced → Runtime & diagnostics →
Executable overrides**.

## Home

Home is the landing view. A **Next steps** card lists what is still missing (sign in,
choose an environment, choose a repositories folder) with one button per step and
disappears once everything is set. **This session** shows the Code session's folder;
**Check status** reads its branch and SDK state through the existing `status` and
`sdk-status` actions and offers **Update SDK** when one is supported. **Recent** shows
the last three operations. Nothing is spawned on startup beyond the existing
preference and session reads.

## Settings: MainSequence login and workspace

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

## Code

Code lists the session folder first, then every repository available to the account
through shared devtools APIs, each marked **Local** when a canonical checkout exists,
and any other local copies found under the repositories folder. A search field and an
All / Local filter narrow the list. A remote-only row offers **Set up**: its detail
shows the branch (a single available branch is selected automatically), the
destination and an optional **Install dependencies after setup** toggle. Setup uses the
canonical `<base>/<organization>/projects/<name>-<uid>` layout and repository SSH
identity. Setup shows its streamed progress beside the disabled Set up button
immediately after confirmation, can be cancelled there, stays visible in the header
while you work elsewhere, and reports completion or failure; a successful setup
reopens the same repository as a local detail. Retry is explicit and never replays
automatically.

Opening a local row makes that folder the operation target and shows its detail:
status (branch, commit, type, SDK), **Dependencies**, **Instructions and skills** and
**More** (folder, terminal, containers, delete). Selecting a folder changes the
operation target, not Claude's session working directory. Unavailable actions stay
visible, disabled, with the capability's reason beneath them. Mutations have explicit
confirmations drawn above the view, so the header and navigation remain; supported
previews remain separate. Stale results are discarded after context changes.

MainSequence supports the existing one-saved-identity-per-backend credential model.
Setup writes the endpoint without copying access tokens into the project. **Clean
legacy environment credentials** is an explicit project action; signing in does
not silently migrate other projects or rewrite their provider settings.

## MainSequence Projects

Projects lists `OrganizationProject` records within the selected environment.
Search and pagination use the backend. Select a project to load its visible member
branches, grouped by repository. Repository and branch buttons open their exact
Command Center detail when Settings has a Command Center URL; otherwise they open
the authorized GitHub repository/branch. A project link requires that platform URL.
An inaccessible parent repository does not hide an otherwise visible project branch.

**Set up project locally** reviews the selected project, then:

1. Prepares any missing ordinary repositories using existing setup and deploy keys.
2. Creates or reuses a UID-scoped container under
   `<base>/<organization>/organization-projects/<backend-hash>/`, with a workspace
   child named exactly after the project: **Ontology**, including its case, with no UID suffix.
3. Creates independent repository branch checkouts alongside that workspace or switches
   existing clean checkouts to their assigned branches, then opens the workspace in Claude.
4. On startup in that folder, the enabled MainSequence plugin explicitly adds every
   member checkout using Claude's native `/add-dir` command. It confirms attachment
   separately from Git preparation and shows a retry control if any attachment fails.

The workspace manifest records all repository paths and branch UIDs. Multiple
branches of one repository get separate checkouts. Source repositories keep their
existing branches; running setup again reuses the same workspace. Git objects can
be copied from local repositories, but the checkouts remain independent. A dirty
checkout on the correct branch is retained; switching a dirty checkout is refused.
No reset, stash, automatic pull or dependency installation occurs. Removed project
memberships leave old folders intact, and an existing `CLAUDE.md` is preserved.
Failures/cancellation retain completed checkouts and report partial effects; retry
continues after the underlying problem is resolved.

After all branches are ready, the plugin opens the documented
[Claude Code folder link](https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link).
Claude requires its own folder confirmation. The existing Code session remains
unchanged. The new session runs local `/add-dir` commands without a model turn.
Only the exact membership saved by the user's setup is attached; changing it requires
running setup again. **Open in Claude** reopens the prepared folder;
it does not create another checkout or edit Claude's private project/chat records.
The folder is reused, while Claude controls whether a new conversation is started.
Older UID-suffixed folders become storage containers. Setup reuses both existing
repository paths and copies the old `CLAUDE.md` into the correctly named child.

Environment, backend and project changes discard stale project responses and pending
setup confirmations. Authentication stays in Settings and uses the existing human
MainSequence session. Project creation, deletion and membership editing stay in
Command Center.

## Tools (MCP) and Activity

Choose an **Organization environment** in the header. The choices come from the existing
MainSequence organization-environments endpoint. No environment is selected
implicitly, including Production. The choice is remembered per backend in the
plugin store, independently of Settings' Save button, and is validated when a new
session restores it. Changing it scopes discovery, connected MCPs, tool inspection,
and Claude tool calls to that environment. Labels and tool confirmations show the
environment name. Other environments' connections stay saved.

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
MCP discovery runs alongside connected-tool registration. Tools lists the connected
MCPs of the selected environment as rows with their registered tool count; **Add MCP** opens a search over the environment's releases
with a **Connect** button per result, and a connected MCP's detail lists its tools.
Calling a tool directly and re-registering tools sit under **Advanced** in that
detail; its tool selector pages at 63 entries, keeping every tool reachable within
Claude's 64-option native limit, and late results from another MCP cannot replace
the selected catalog. Rendering or startup failures show a **Retry display** screen
without replaying operations. The running-operations counter in the header opens Activity and is mirrored
in Claude's status line. When there are no operations, the empty state links to Code
and Tools.

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
| MainSequence Projects | Environment-scoped project search, pagination and member branches; exact repository/branch links; repeatable local project setup and native Claude folder link. |
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
This feature consumes existing human Project APIs; no backend endpoints or schemas change.

## Upgrade, removal and troubleshooting

Update through the plugin manager or install the built archive. Fully close old
Code sessions and start fresh sessions after upgrading from 0.3.x. An already
running old plugin process retains its old hooks until it exits. This release does
not try to rewrite authentication inside that process or delete stored profiles.
Disabling/uninstalling the plugin does not revoke MainSequence credentials or
remove projects. Use MainSequence's confirmed Sign out action only when desired.

If the pane is missing, verify a local Code session with the plugin enabled, then
use `/ms`. For worker failures, open **Settings → Advanced → Runtime & diagnostics**.
For operation failures, inspect Activity before retrying; cancellation can leave
partial filesystem effects. Backend changes clear stale connection/repository
results so another backend's state is not displayed as current.

See [verification](claude-desktop-verification.md),
[distribution](claude-desktop-distribution.md) and
[architecture](adr/0004-claude-desktop-mod.md).
