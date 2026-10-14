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

Refresh/update through Claude's plugin manager, then reload local Code sessions.
For manual installation or rollback, download a release ZIP and checksum and use
**Add plugin → Upload plugin**. Uploading uses Claude's plugin service. Release
assets are immutable; the previous 0.3.0 preview remains available.

Restore Desktop-managed sign-in before disabling account integration. Account
profiles and shared MainSequence credentials are retained; explicitly remove
profiles through Accounts if desired. Closed/crashed sessions can leave durable
reservations requiring acknowledged release. External-provider settings are untouched.

## Build and verify

Run `npm ci`, then `npm run release:check`. This builds and tests this repository,
bundles the pinned shared package, checks docs, packs the ZIP, and verifies it in
an isolated directory. Set `MS_CLAUDE_DESKTOP_BINARY` to additionally validate and
run native simulator tests with the actual installed engine. Test credentials are
synthetic; live account behavior remains tracked in [verification](claude-desktop-verification.md).

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

The **Release Claude Desktop plugin** workflow builds and uploads checked artifacts.
Manual runs default to verification only. An approved `v<plugin-version>` tag or
an explicit publish run creates a preview release in this repository and then
updates the marketplace. It uses the repository's `GITHUB_TOKEN` with contents
write permission; no cross-repository distribution token or source checkout is used.

The local `npm run publish:claude` path performs the same immutable-asset checks
with GitHub CLI authentication. It requires a clean, pushed source revision and
never publishes dirty source or changes repository visibility. Missing assets can
be resumed only while a release is a draft; published bytes are never replaced.
The catalog update is a separate generated commit, preserving all source files.

Before stable release, complete the live installation/update/rollback and
multi-account acceptance checklist. Automatic fixtures cannot establish live
request ownership or Desktop host-refresh behavior.
