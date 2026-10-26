# MainSequence for Claude Desktop

MainSequence for Claude Desktop puts your MainSequence account inside Claude Desktop's
Code sessions: one native pane with **Home, Code, Projects, Agents** and **Tools**, agent
conversations from Claude's own composer, project MCP tools Claude can call, and the
deployment status of your repositories. It is the plugin `mainsequence` in the
`mainsequence-desktop` marketplace, distributed as a ZIP from this repository's releases.

It is built on the shared [MainSequence developer tooling](https://github.com/mainsequence-sdk/mainsequence-devtools),
which also powers the [VS Code extension](https://github.com/mainsequence-sdk/ms-vscode-extension)
and the [Codex plugin](https://github.com/mainsequence-sdk/mainsequence-codex-plugin).
One sign-in on your machine serves all three and the `mainsequence` and
`command-center-sdk` command lines.

## Install

You need Claude Desktop with local Code sessions and plugin support (the plugin's startup
guard requires the bundled Code engine 2.1.286 or newer), Node 22 or newer, and a
MainSequence account. Repository setup needs Git and SSH; Python repositories need `uv`,
Vite + React repositories need npm; local image builds need Docker with buildx. None of
these are installed silently. The plugin runs on macOS and Linux. On Windows the shared
sign-in cannot be kept between sessions, so the plugin is not supported there yet.

1. In Claude Desktop open **Customize → Plugins → Add marketplace → Add from repository**
   and enter `https://github.com/mainsequence-sdk/mainsequence-claude-desktop.git`.
2. Install **MainSequence** from `mainsequence-desktop`. The catalog points at a versioned
   ZIP with a pinned SHA-256; nothing is built or downloaded from npm on your machine.
3. Enable the plugin in a local Code session and press **MainSequence** in the session
   footer to open the pane. Opening it submits no prompt and saves nothing. `/ms` opens
   it too.

To update, refresh the marketplace, update the plugin and start a fresh Code session.
`/reload-plugins` only reloads the installed copy. To install a specific build, download
a release ZIP and use **Add plugin → Upload plugin**. If Claude cannot find Node, set its
path in the plugin's Node executable setting or under **Settings → Advanced → Runtime &
diagnostics → Executable overrides**.

## Sign in and choose an environment

1. Press **Settings** in the pane header and choose **Sign in with browser**. The hosted
   MainSequence login opens in your browser; account creation is part of that flow. The
   session is saved in your operating system's credential store (the login Keychain on
   macOS, Secret Service on Linux), where the VS Code extension, the Codex plugin and the
   MainSequence command lines find it too. **Check connection**, and under **Manage
   account** **Renew session** and **Sign out**, are in the same place.
2. The backend defaults to `https://api.main-sequence.app`. If your organization runs its
   own MainSequence deployment, set its API URL as the backend in Settings before signing
   in. Set the **Command Center URL** there as well, so project and repository links open
   in Command Center, and the **repositories folder** where local checkouts go. Edits
   apply at once, with no Save step.
3. Choose an **organization environment** in the pane header. Nothing is selected for
   you, not even Production. Agents, MCPs, projects and deployments are shown for that
   environment, and the MainSequence tools Claude calls are bound to it.

MainSequence is one pane across your Code sessions: settings, the environment, the open
section and Activity are the same in every session, whichever project it is in. Only the
**This session** card on Home belongs to the session. See
[One MainSequence across sessions](docs/claude-desktop.md#one-mainsequence-across-sessions).

## What you can do

- **Home.** A **Next steps** card until you have signed in, chosen an environment and a
  repositories folder; **This session** with the Code session's folder, **Check status**
  and **Update SDK** when one is available; and the last three operations of every session.
- **Code.** The session folder, every repository of your account (marked **Local** when a
  canonical checkout exists) and other local copies under the repositories folder. **Set
  up** clones a repository into `<folder>/<organization>/projects/<name>-<uid>` with its
  deploy key and an endpoint-only `.env`, optionally installing dependencies. A local
  repository's detail offers status, dependencies, instructions and skills, folder,
  terminal, containers and a confirmed delete, plus a **Deploys** card with the latest run
  of the checked-out branch, its step timeline and logs, and the environment's deployment
  history.
- **Projects.** The environment's MainSequence projects with their repository branches.
  **Set up project locally** prepares every member branch in its own checkout, opens the
  workspace in Claude through its native folder link, and adds each checkout to the new
  session with `/add-dir`, without a model turn.
- **Agents.** The environment's agents with descriptions, skills and example questions.
  **Talk** opens or resumes the agent's conversation, waits for it to be ready and fills
  Claude's input with `/ms @<agent-handle> `. Write your message after the prefix and
  submit it yourself; the reply appears in the transcript with the agent's name, and the
  composer stays addressed to that agent until you press **End** or **Switch agent** in
  the band above it. Task-capable agents take `/ms task @<handle> `. See
  [Agents](docs/agents.md).
- **Tools.** Connected project MCPs of the environment first; **Add MCP** searches its
  releases. Every tool of a connected MCP is registered for Claude as `ms_<tool>_<hash>`
  with the project's own schema, and Claude asks before each call. **Advanced** in an
  MCP's detail calls a tool directly or re-registers the tools. The read-only
  `ms_deployment_status` tool gives Claude the same deployment view as the Deploys card.
- **Activity.** Running and finished operations with progress, results, cancellation and
  partial-effect warnings. The running count also appears in Claude's status line.

The [user guide](docs/claude-desktop.md) describes every section, and
[agent icons](docs/agent-icons.md) how the platform's icons are shown.

## Troubleshooting

- **No pane.** Make sure it is a local Code session with the plugin enabled, then press
  **MainSequence** in the footer or type `/ms`.
- **Worker failures.** Open **Settings → Advanced → Runtime & diagnostics**.
- **An operation failed.** Inspect **Activity** before retrying; a cancelled operation
  can leave partial effects on disk and is never replayed automatically.
- **After an update.** Fully close old Code sessions and start fresh ones; a running old
  plugin process keeps its old hooks until it exits.
- **Another backend's data is shown.** It is not: backend changes clear stale connection
  and repository results.
- Disabling or uninstalling the plugin does not revoke your MainSequence session or
  remove any project; use **Sign out** for that.

Signed terminals, changing the Code session's root folder and launching container
sessions are host limitations: the pane shows them disabled with the reason.

## Development

This repository owns the Claude UI, lifecycle hooks, worker transport, tests and
releases. Shared behaviour comes from the exact `@dev-mainsequence/devtools` package
pinned in `package.json` and the lockfile, bundled into the portable ZIP; no sibling
checkout or runtime npm download is used. Host API functions stay in
`claude/hooks/register.mjs` because Claude's effect analysis follows helpers only within
the same module.

```sh
npm ci --ignore-scripts
npm run release:check
```

`release:check` type-checks, builds, runs the Node tests, verifies the documentation,
packs the ZIP and verifies the distribution in an isolated directory. Set
`MS_CLAUDE_DESKTOP_BINARY` for native loader validation and the simulator tests, and
disposable `CLAUDE_CONFIG_DIR` and `CLAUDE_SECURESTORAGE_CONFIG_DIR` for native checks;
`npm run verify:claude` runs them. Tests use synthetic MainSequence responses; live GUI
acceptance is recorded in each release's pull request.

To release: set the new version in `package.json` and `package-lock.json`, run
`npm run release:check`, merge, and push an annotated tag `v<version>` whose message is
the release notes. The release workflow builds, repeats the checks, creates the GitHub
release for that tag with the ZIP, its checksum and those notes, and commits the updated
marketplace catalog. `npm run publish:claude` does the same from a clean, pushed checkout.
Published assets are immutable; a wrong release needs a new version. Afterwards,
`npm run verify:published` checks the catalog, the ZIP and the checksum anonymously and
installs into a disposable configuration. See
[distribution](docs/claude-desktop-distribution.md),
[architecture](docs/adr/0004-claude-desktop-mod.md) and
[agent interactions](docs/adr/0005-user-authored-agent-interactions.md).
