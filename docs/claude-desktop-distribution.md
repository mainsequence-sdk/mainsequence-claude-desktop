# Distribution and release of MainSequence for Claude Desktop

[mainsequence-claude-desktop](https://github.com/mainsequence-sdk/mainsequence-claude-desktop)
contains the maintained Claude source, marketplace and releases. The shared library
is maintained and released independently in
[mainsequence-devtools](https://github.com/mainsequence-sdk/mainsequence-devtools).
Both are public. Claude imports the exact released devtools package pinned in its
package.json and lockfile; no shared source is maintained here.

## Published version

As of 2026-10-15, the marketplace advertises the **0.4.1 preview**, bundled with
**devtools 0.2.3**. The [release](https://github.com/mainsequence-sdk/mainsequence-claude-desktop/releases/tag/v0.4.1)
and [verification evidence](claude-desktop-verification.md#published-041-evidence)
record its immutable archive and checksum. Preview does not imply completed live
GUI acceptance; outstanding checks remain in the verification record.

The tracked marketplace and `mainsequence-distribution.json` identify the published
build. `package.json` identifies the source build and can advance before publication.
Documentation on `main` can also be newer than the documentation inside an already
published archive. A documentation-only change does not update installed plugins
or replace an existing release ZIP; a later plugin release carries those changes.

## Install

Open **Customize → Plugins → Add marketplace → Add from repository**, enter
`https://github.com/mainsequence-sdk/mainsequence-claude-desktop.git`, and install
**MainSequence** from `mainsequence-desktop`. The catalog pins a versioned ZIP and
SHA-256 digest. Node 22+ is required; no source checkout or runtime npm download is
needed. Continue with the [first-run walkthrough](first-run.md).

## Update an existing installation

1. Refresh the **mainsequence-desktop** marketplace in Claude's plugin manager and
   update **MainSequence**, if those controls are present in your Desktop build.
2. If the local marketplace card only offers **Remove**, use the macOS fallback below.
   Removing and reinstalling is not required.
3. Confirm the installed version is **0.4.1** (or a later published version).
4. Start a fresh local Code session and open `/ms`. An existing session can keep
   the old hooks loaded until it exits. The updater does not restart active sessions.

`/reload-plugins` reloads the installed copy; it does **not** refresh the marketplace
or download a new release.

### macOS fallback when Desktop only offers Remove

The following block is for **Terminal using zsh**, macOS's default shell. It locates
the newest cached Claude Desktop Code engine and prints its path/version, refreshes
only this marketplace, updates only the user-scope MainSequence plugin and lists
installed plugins. It does not require a separately installed Claude CLI. Command
syntax was checked against the bundled Code 2.1.295 help.

This targets the normal Desktop user installation. Run it from a Terminal where
`CLAUDE_CONFIG_DIR` is unset; the guard stops if a custom configuration is active.
If you intentionally use a custom configuration or a project-scoped installation,
use that installation's documented path/scope instead of this user-scope fallback.

```zsh
(
  if [[ -n "${CLAUDE_CONFIG_DIR:-}" ]]; then
    printf '%s\n' 'CLAUDE_CONFIG_DIR is set. Use a Terminal for your normal Desktop configuration.'
    exit 1
  fi
  desktop_engines=("$HOME"/Library/Application\ Support/Claude/claude-code/*/*/claude.app/Contents/MacOS/claude(Nn))
  if (( ${#desktop_engines} == 0 )); then
    printf '%s\n' 'No cached Claude Desktop Code engine found. Open a local Code session in Desktop first.'
    exit 1
  fi
  desktop_engine="${desktop_engines[-1]}"
  printf 'Desktop engine: %s\n' "$desktop_engine"
  "$desktop_engine" --version &&
    "$desktop_engine" plugin marketplace update mainsequence-desktop &&
    "$desktop_engine" plugin update mainsequence@mainsequence-desktop --scope user &&
    "$desktop_engine" plugin list --json
)
```

In the JSON output, locate `mainsequence@mainsequence-desktop` and check its version
and scope. If the marketplace is missing, add the repository through Desktop as
shown under Install. If the command reports no user-scope installation, inspect the
listed scope rather than deleting settings or installing a second copy. Once it
reports the new version, use a fresh Code session; reloading an older session is not
proof that the updated hooks have started.

On other operating systems, use the Desktop plugin manager when it exposes update
controls. A portable executable-location command has not been verified here; the
macOS cache path above does not apply. Record the Desktop/engine version and use
its bundled engine's `plugin --help` before adapting the fallback.

## Remove or roll back

Disable or remove MainSequence through the plugin manager. This does not revoke
MainSequence credentials or remove local projects. Use the plugin's confirmed
**Sign out** action only if you intend to revoke its MainSequence session.

For manual installation or rollback, download the desired release ZIP and its
`.sha256` asset into the same directory. On macOS, verify the current release with:

```sh
shasum -a 256 -c mainsequence-claude-desktop-0.4.1.zip.sha256
```

For another version, use its matching filenames. Continue only when the checksum
reports **OK**, then use **Add plugin → Upload plugin**. Start a fresh Code session
and verify the installed version afterward. A later marketplace update can replace
a rollback with the version currently advertised; a ZIP upload is not a version pin.
Published release assets remain immutable.

For upgrades from 0.3.x, close existing Code sessions and start new ones so old
account-switching hooks are unloaded. Version 0.4.0 leaves Claude accounts,
credentials, old profile metadata and external-provider settings intact and unused.
There is no account migration or cleanup. MainSequence login remains available.
Downgrading to 0.3.x restores that older version's account feature; it is not a way
to retain the 0.4.0 authentication boundary.

## Build and verify

Run `npm ci --ignore-scripts`, then `npm run release:check`. This builds and tests this repository,
bundles the pinned shared package, checks docs, packs the ZIP, and verifies it in
an isolated directory. Set `MS_CLAUDE_DESKTOP_BINARY` to additionally validate and
run native simulator tests with the actual installed engine. Tests use synthetic MainSequence responses; live GUI acceptance remains tracked in [verification](claude-desktop-verification.md).

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
GUI and MainSequence operation acceptance checklist. Automated fixtures do not establish final native window rendering or live backend operation success.

After publication, set `MS_CLAUDE_DESKTOP_BINARY` and run
`npm run verify:published` from the matching source version. It anonymously checks
the marketplace, ZIP and checksum, installs into a disposable configuration, checks
the bundled dependency integrity, and runs native validation, simulator tests and
the standalone worker. It preserves the normal Desktop configuration and does not
sign in to live accounts. This verifies engine installation; GUI acceptance remains
a separate check.
