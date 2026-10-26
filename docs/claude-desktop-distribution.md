# Distribution and release of MainSequence for Claude Desktop

[mainsequence-claude-desktop](https://github.com/mainsequence-sdk/mainsequence-claude-desktop)
contains the maintained Claude source, marketplace and releases. The shared library
is maintained and released independently in
[mainsequence-devtools](https://github.com/mainsequence-sdk/mainsequence-devtools).
Both are public. Claude imports the exact released devtools package pinned in its
package.json and lockfile; no shared source is maintained here.

## Install, update and remove

Open **Customize → Plugins → Add marketplace → Add from repository**, enter this
repository's GitHub URL and install **MainSequence** from `mainsequence-desktop`.
The catalog pins a versioned ZIP and SHA-256 digest. Node 22+ is required, and the
[guide](claude-desktop.md) lists project-operation prerequisites. Installation does
not need this source checkout or runtime npm downloads.

Refresh the marketplace and update the installed plugin, then start a fresh Code
session. The MainSequence footer button is available once the new session has
loaded the plugin; closing its pane leaves the launcher in place. `/reload-plugins`
only reloads the installed copy; it does not download an update. Desktop builds that
show only Remove on the local marketplace card need Claude's built-in updater
(`plugin marketplace update mainsequence-desktop`, then
`plugin update mainsequence@mainsequence-desktop --scope user`) through the bundled
engine; the pane's **Update to** button runs exactly that once the marketplace catalog
on the default branch names a newer version. Updating is separate from manual ZIP installation. For manual installation or
rollback, download a release ZIP and checksum and use **Add plugin → Upload plugin**.
Uploading uses Claude's plugin service. Release assets are immutable.

After an update, close existing Code sessions and start new ones: an already running
plugin process keeps its old hooks until it exits. The plugin does not read, modify or
delete Claude accounts, credentials, profiles or provider settings, and disabling or
uninstalling it does not revoke the MainSequence session.

## Build and verify

Run `npm ci --ignore-scripts`, then `npm run release:check`. This builds and tests
this repository, bundles the pinned shared package, checks docs, packs the ZIP, and
verifies it in an isolated directory. Set `MS_CLAUDE_DESKTOP_BINARY` to additionally
validate and run native simulator tests with the actual installed engine. Tests use
synthetic MainSequence responses; live GUI acceptance is recorded in each release's
pull request.

Artifacts contain the plugin's version and bundled devtools name/version/integrity.
Builds resolve the installed npm dependency, never a sibling directory. Before a
release, required shared APIs must be available in a released devtools version.
For prerelease integration testing only, an unpacked `npm pack` archive with the
same version may be installed locally; it is replaced with `npm ci` from the
registry and reverified before release. Such local overrides are never committed.

The versioned ZIP and checksum are written under `artifacts/`. A generated
`artifacts/claude-distribution/.claude-plugin/marketplace.json` pins those bytes.
The tracked marketplace continues advertising the previous working release until
the new assets have been published and their downloaded bytes checked.

## Release from this repository

The **Release Claude Desktop plugin** workflow builds and uploads checked artifacts;
manual runs default to verification only. Push an annotated tag `v<plugin-version>`
whose message is the release notes (`git tag -a v<version> -F notes.md`): the workflow
runs `release:check`, creates the GitHub release for that tag with the ZIP, its checksum
and those notes, and then commits the updated marketplace catalog and
`mainsequence-distribution.json` to the default branch. A lightweight tag gets a one-line
generic note. The workflow uses the repository's `GITHUB_TOKEN` with contents write
permission; no cross-repository token or source checkout is used.

The local `npm run publish:claude` path performs the same immutable-asset checks
with GitHub CLI authentication. It requires a clean, pushed source revision and
never publishes dirty source or changes repository visibility. Missing assets can
be resumed only while a release is a draft; published bytes are never replaced.
The catalog update is a separate generated commit, preserving all source files.

Before a release, complete the live installation, update and rollback checks and the
GUI and MainSequence operation acceptance, and record them in the pull request.
Automated fixtures do not establish final native window rendering or live backend
operation success.

After publication, set `MS_CLAUDE_DESKTOP_BINARY` and run
`npm run verify:published` from the matching source version. It anonymously checks
the marketplace, ZIP and checksum, installs into a disposable configuration, checks
the bundled dependency integrity, and runs native validation, simulator tests and
the standalone worker. It preserves the normal Desktop configuration and does not
sign in to live accounts. This verifies engine installation; GUI acceptance remains
a separate check.
