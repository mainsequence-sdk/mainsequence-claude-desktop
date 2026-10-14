# Distribution and release of MainSequence for Claude Desktop

The installable plugin is distributed separately from the development repository:
[mainsequence-sdk/mainsequence-claude-desktop](https://github.com/mainsequence-sdk/mainsequence-claude-desktop).
The source repository keeps its existing visibility. Making it public later does
not require users to reinstall or change marketplaces.

## Install in Claude Desktop

1. Open **Customize → Plugins → Add marketplace → Add from repository**.
2. Enter `https://github.com/mainsequence-sdk/mainsequence-claude-desktop.git`.
3. Select **MainSequence** from the `mainsequence-desktop` marketplace, review its
   permissions and install. Enable it in a local Code session and reload the session.
4. Open **MainSequence → Settings**. If Desktop cannot find Node, choose a Node 22+
   executable. Then run **Runtime diagnostics**.

The marketplace downloads the compiled plugin ZIP from an immutable versioned
GitHub release URL and checks its SHA-256 digest. Users do not need this source
checkout, npm packages or a build toolchain to install the plugin. Node 22+ remains
a runtime prerequisite. Project operations may additionally require Git, SSH, uv,
npm or Docker; [the user guide](claude-desktop.md) lists them.

For offline/manual installation, download the ZIP and its `.sha256` file from the
same release, verify the checksum, and use **Add plugin → Upload plugin**. This
uploads the plugin to Claude's plugin service. Never upload a source checkout,
credentials or an account-profile directory. The ZIP contains only distributable
plugin code, native test fixtures, documentation and attribution.

The initial release is a **preview**: native loader/UI and fixture tests pass, but
live Claude account request identity and Desktop token refresh remain unverified.
Signed terminal, Code session navigation and container launch are documented host
gaps. See [the verification record](claude-desktop-verification.md).

## Updates, rollback and removal

Use Claude's plugin manager to refresh the marketplace and update MainSequence.
Every update has a new version and new archive digest; released assets must never
be replaced in place. Restart/reload local Code sessions after updating. Updating
the plugin does not overwrite MainSequence credentials, account profiles or
external-provider settings.

For rollback, disable/remove the newer plugin and install the previous release's
ZIP through the same upload flow. Release archives and checksums remain available.
Restore Desktop-managed sign-in before disabling the account mod; closed sessions
may need their durable reservations released from Accounts in another session.
Uninstalling the plugin leaves shared developer credentials and account metadata
intact. Delete stored profiles explicitly through Accounts when desired.

## Maintainer release procedure

`npm run release:claude:check` builds the same worker/UI as the npm package, runs
the complete fixture suite, validates documentation, packs the ZIP, and verifies
the archive from a temporary consumer directory. With `MS_CLAUDE_DESKTOP_BINARY`
set, it also runs the actual engine's plugin validator and native UI tests against
the extracted archive. No user credentials or settings are needed for these checks.

Generated outputs:

- `artifacts/mainsequence-claude-desktop-<version>.zip` and `.zip.sha256`.
- `artifacts/claude-distribution/`: public README, documentation, licenses and
  `.claude-plugin/marketplace.json` pointing at that exact release ZIP/digest.
- `artifacts/claude-marketplace/`: separate local loader-test catalog, never the
  public installation source.

The default destination is `mainsequence-sdk/mainsequence-claude-desktop`.
`CLAUDE_DISTRIBUTION_REPOSITORY=owner/repository` supports another public repository
without rebuilding the runtime. Repack and verify after changing it. The publisher
refuses a non-public destination; it never changes repository visibility.

The source tree includes `.github/workflows/release-claude.yml`. Commit and push
that workflow and its implementation before enabling automated releases. Run
**Release Claude Desktop plugin** with publication disabled first to inspect
artifacts, then enable publication for the checked revision. Its
`claude-distribution` environment needs a `CLAUDE_DISTRIBUTION_TOKEN` with contents
write access only to the public distribution repository. The workflow's normal
token reads the source repository; it does not make source history public. The
workflow can also be triggered by a matching `claude-v<version>` tag.

For a local release with authenticated GitHub CLI, run
`npm run publish:claude` after the checks. The publisher creates a draft release,
uploads the checked archive and checksum, publishes it as a preview, and then
updates the public marketplace. It validates an existing release's checksum before
retrying catalog publication. It never replaces a published archive. The public
repository contains generated distribution files, not the internal Git history.

Before a stable release, complete the live acceptance checklist on a clean user
profile, including two-account identity, host refresh, restoration, concurrent
sessions and install/update/rollback. Automated fixtures cannot replace these checks.

The marketplace format follows Anthropic's [archive source reference](https://code.claude.com/docs/en/plugins/marketplace-reference)
and [marketplace hosting documentation](https://code.claude.com/docs/en/plugins/host-marketplace).
