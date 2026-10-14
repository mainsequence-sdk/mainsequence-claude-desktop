# MainSequence for Claude Desktop Code

MainSequence adds a native pane to **Claude Desktop → Code**, with connection,
repositories, current-project actions, Claude accounts, MCP, activity and settings.
Normal operations use buttons, selectors and confirmations. Operations execute
directly through the bundled worker; they do not require a model turn.

This is a preview release. Live Desktop account acceptance remains outstanding.
The public distribution is [mainsequence-claude-desktop](https://github.com/mainsequence-sdk/mainsequence-claude-desktop).
This repository owns the Claude source and distribution; reusable operations come
from the versioned public devtools package.
The supported initial target is local macOS sessions. Desktop owns the Code engine;
the version of a separately installed command-line client does not establish GUI
compatibility. See [verification](claude-desktop-verification.md) for the exact
checks performed and the live acceptance checks still outstanding.

## Installation and prerequisites

- Claude Desktop with function-hook mods and streaming process support. The native
  validator used during development is Desktop's bundled Code 2.1.295. Basic mod
  rendering is documented from 2.1.286, but that is not a claim that all MainSequence
  APIs have been tested on every intervening version.
- Node 22 or later, available to Desktop. Set an absolute Node executable in the
  plugin configuration or MainSequence Settings if Desktop's PATH does not find it.
- Git and SSH for repository operations; `uv` for Python environments; npm for
  frontend projects; Docker/buildx for image builds. These prerequisites are not
  installed silently.

In **Customize → Plugins → Add marketplace → Add from repository**, enter
`https://github.com/mainsequence-sdk/mainsequence-claude-desktop.git`, then install
**MainSequence** from `mainsequence-desktop`. The marketplace fetches a compiled,
versioned ZIP and verifies its SHA-256. No source checkout or local build is needed.
Enable the plugin for local Code sessions and reload or start a session. The
**MainSequence** button appears above the prompt when the mod is loaded.

Alternatively, download the ZIP and checksum from the public release and use
**Customize → Plugins → Add plugin → Upload plugin**. Uploading an archive uses
Claude's plugin service; include only the built plugin. See
[distribution, updates and rollback](claude-desktop-distribution.md) for the complete
procedure, release automation and developer builds.

The plugin also registers `/ms` as an optional shortcut for opening the same pane.
It is not required for normal use. The source manifest in this repository is under
`manifests/claude/.claude-plugin/plugin.json`; generated artifacts must not be edited.

## MainSequence connection and projects

1. In **Connection**, enter the backend and use **Sign in to MainSequence**. Complete
   browser authorization. **Check connection**, **Renew login** and **Sign out** use
   the existing shared machine-session service.
2. In **Projects**, refresh the remote list, choose a repository and branch, and
   select the local base folder. Setup reuses the canonical
   `<base>/<organization>/projects/<name>-<uid>` layout and repository SSH identity.
3. In **Current Project**, select a project folder and refresh status. Install or
   synchronize dependencies, inspect the SDK, and run supported skills/instruction
   actions. Mutations require a confirmation; available previews are separate.
4. In **Activity**, inspect progress, results and partial-effect warnings, or cancel
   an operation. Raw subprocess stderr is deliberately not copied into the UI.

Dependency synchronization refreshes dependency files and environments. It does not
commit, tag or push. SDK update controls must respect the SDK status contract;
the update and preview buttons require a fresh status reporting both supported and
available. Python's current source-version comparison is not proof of a published
update, so it does not enable an automatic Python SDK upgrade.
MainSequence supports one saved identity per backend under the existing credential
schema. Claude subscription profiles do not change that schema.

**Renew login** refreshes the saved MainSequence session. In **Current Project**,
**Clean legacy environment credentials** separately migrates the selected project's
environment file to endpoint-only authentication. Setup also writes the backend
endpoint without copying access tokens into the project. Other environment values
are preserved; a tracked environment file is refused. These are explicit actions,
so signing in does not silently migrate every local project.

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
| MCP discovery/connections/tools | Search/paginate project MCPs, connect/disconnect exact releases, inspect/call tools and register them for Claude. Tool calls request approval and disconnected tools are refused. |

The signed-terminal, session-navigation and container-launch limitations are explicit
host gaps, not completed parity claims. Every action remains accounted for in this
table. Dormant legacy extension panels/scripts are not treated as active features.

## Claude accounts

Account management adapts the MIT-licensed [Claude account rotator](https://github.com/ivokund/claude-account-rotator)
at revision `60d5aed19856d548611472ca85c8836bfaa4bcd3`. Its credential-slot technique is
combined with a Desktop-specific OAuth environment projection. Attribution ships
under `third_party/claude-account-rotator` inside the artifact.

Use **Accounts** to add profiles and complete browser sign-in. **Sign in all accounts
needing login** processes them one at a time; **Cancel sign-in** or Activity can stop
the current sign-in. Cards show identity, organization, plan, expiry, usage/reset
times and active-session counts when those values are available. Display settings
control five-hour/weekly meters, percentages and the active-account marker.

Profiles are independent of MainSequence login and external provider configuration.
The stored default Claude profile is a native credential slot; it is not evidence
that Desktop's current app login uses that identity. New sign-ins use Desktop's
installed Code executable where it can be discovered; an explicit executable may
be configured when needed. Duplicate saved identities are rejected for selection.

Choose a profile and confirm **Use for this session**, or explicitly **Rotate now**,
before enabling automatic rotation. A session using Desktop-managed sign-in stays
under Desktop's control even when automatic mode is saved in account preferences.
**Use Desktop sign-in again** restores the session's captured engine settings and
releases its stored-account reservation.

Automatic rotation is opt-in. The initial thresholds are 90% of five-hour usage and
95% of weekly usage. Settings control these thresholds, the eligible accounts and
whether rotation stays within the same organization (the default). Eligible targets
need fresh usage and an identified, unexpired login. Unknown usage is not treated
as unused capacity; an explicitly absent weekly limit is distinguished from a
missing or malformed weekly reading. Credential changes invalidate cached identity
and quota information before selecting that profile.

Automatic refresh and recovery wait until the main turn and any observed background
subagent turns complete. Manual account changes are refused during an active turn. An unresolved credential transition
blocks model dispatch until it is resolved, including an action already in flight
when a turn starts.

**Refresh accounts** reloads saved metadata. **Check logins and usage** checks native
sign-ins and refreshes usage, reusing a valid reading for up to ten minutes. Automatic
mode also checks when Desktop reports a rate-limit measurement change. The minute
heartbeat maintains session reservations; it does not continuously poll quota.

For an explicitly selected profile in automatic mode, a main-session
`rate_limit` or `authentication_failed` stop can prepare another eligible profile.
Recovery is limited to two switches within five minutes. It never resubmits a prompt
or replays tools: review Accounts and Activity, then decide whether to submit again.
If a selected credential cannot be read or has expired before submission, the mod
blocks that prompt instead of falling back to a different identity.

**Selection is not proof of request identity.** Desktop injects and refreshes its own
OAuth token. The mod projects the chosen token and credential slot into the current
engine, and labels the result as `projected-unverified`. It does not claim the whole
Desktop application's account changed or use similar usage percentages as identity
proof. Live request ownership, host refresh, restart and multi-account acceptance
must be verified as described in the verification document before calling switching
production-verified. Expired stored credentials require re-authentication; the mod
does not invent an undocumented OAuth refresh endpoint.

Account lists are updated atomically under a cross-process lock. Selections carry
generations and session usage records so stale completions cannot replace a newer
selection. Account transitions within a session are serialized, and failed
projection restores its previous selection. Removal/re-authentication must respect
other sessions' use of a profile.

Reservations do not expire automatically: a paused or sleeping Desktop can still
be using its selected account. Normal session end or **Use Desktop sign-in again**
releases the reservation. After a crash, **Accounts** can show an old reservation
with **Release reservation for closed session**. Use it only after confirming that
the named session is closed; an old heartbeat alone does not prove that. A new
session starts with Desktop-managed sign-in until you explicitly select a profile.

## Storage, credentials and preservation

- MainSequence credentials remain in the existing native machine store.
- Claude tokens remain in Claude's native credential mechanism: macOS Keychain or
  profile credential files where supported. The worker returns references, never
  token values. Projection reads credentials privately inside the hook callback.
- Claude profile/usage/preferences metadata lives in
  `~/.config/mainsequence/claude-accounts/`. This is distinct from upstream rotator
  storage; existing upstream profiles are not automatically imported or deleted.
- Mod UI preferences use the plugin store. Raw tokens are excluded from UI results,
  public worker messages, diagnostics and persistent plugin state.
- Installation does not rewrite OpenCode, VS Code, external-provider or MainSequence
  backend configurations. Project writes happen only through selected actions.

## Updating, removing and troubleshooting

Update the plugin through Desktop's manager and reload its Code
session. The generated worker protocol and plugin version are packaged together.
Uninstall/disable through the same manager. Uninstalling the plugin does not revoke
MainSequence credentials, erase projects, or purge Claude account profiles. Restore
Desktop sign-in and release account selections in open sessions before removing
profiles. Profile removal is a separate explicit action.

If the button is missing, check that this is a local **Code** session, mods are allowed,
and the plugin is enabled. If a worker cannot start, check the Node executable and
artifact completeness in **Settings → Run diagnostics**. If a project operation
stops, inspect Activity's partial-effect warning before retrying. A busy account or
repository must be released by its owning operation. For an account reservation
left by a confirmed closed session, use the release control described above; do not
blindly remove lock files or account metadata.

## Developer verification

```sh
npm run typecheck
npm test
npm run verify:docs
npm run pack:claude
npm run verify:claude:distribution
# Optional native validation with Desktop's actual bundled executable:
MS_CLAUDE_DESKTOP_BINARY=/absolute/path/to/Desktop/bundled/claude npm run verify:claude
```

The final command validates this artifact with the native plugin loader and runs its
native simulator tests when packaged. Those tests mount native UI elements with
mocked processes and credentials; they do not establish actual Desktop window
rendering or live request ownership. Automated tests use fixtures and temporary
stores, never the user's production logins. See
[architecture](adr/0004-claude-desktop-mod.md) and
[verification/acceptance](claude-desktop-verification.md).
