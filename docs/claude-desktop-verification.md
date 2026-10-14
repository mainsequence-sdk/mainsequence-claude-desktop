# Claude Desktop mod verification

This document distinguishes automated evidence from live acceptance. A passing
fixture suite is not proof of live account switching or production readiness.

## Automated checks

Run `npm run typecheck`, `npm test`, `npm run verify:docs`, and the packaged-consumer
check. The suites cover:

- Native UI callbacks, deterministic dispatch and request/result correlation.
- Worker protocol validation, bounded input and diagnostics without authentication.
- Credential references/redaction, atomic cross-process updates and dead-owner
  lock recovery; generation-scoped selection/rollback and durable reservations
  that never expire solely because a heartbeat is old.
- Re-authentication/removal guards across sessions, duplicate identity rejection,
  token-bound identity/usage caches, explicit no-weekly-limit versus unknown quota,
  usage freshness/organization rules and cancellable sign-in/usage checks.
- Explicit-selection gates for automatic rotation, bounded failure recovery and
  host-managed sessions remaining under Desktop's control; automatic transitions
  deferred until main and observed background turns complete, manual mid-turn switches refused, and
  unresolved transitions blocking model dispatch.
- Public devtools dependency boundaries and delegation to shared operations.

Devtools separately tests Docker argv construction/cancellation, canonical local
deletion, stale previews, JSONC comment preservation and incompatible container
configurations, alongside MainSequence authentication, SDK and MCP behavior.
Codex and OpenCode tests remain with their implementations in devtools.

Native loader validation uses Desktop's bundled Code **2.1.295**. The installed
Desktop application inspected during development is **2.37337.1**. These numbers
describe different components; neither is inferred from the system `claude` binary.

The artifact also includes three native simulator tests, run through the bundled
engine's `plugin test` command by `npm run verify:claude` when
`MS_CLAUDE_DESKTOP_BINARY` is set. They mount the pane, exercise a confirmed action,
cancel a waiting process stream, and emit a typed `classic.StopFailure` event to
verify recovery dispatch with zero prompt submissions. Processes, credentials and
responses are fixtures. A pass covers native hook wiring and simulated element
interaction; it does not prove actual Desktop window layout, a real sign-in or the
identity billed for a model request.

## Observed Desktop installation UI

Read-only navigation confirmed **Customize → Plugins → Add plugin → Upload plugin**
accepts `.zip` / `.plugin` archives with `.claude-plugin/plugin.json`. The marketplace
screen offers Git repository sources. No plugin was uploaded or installed during
this inspection; the install checkbox below remains open.

The distribution repository is
[mainsequence-claude-desktop](https://github.com/mainsequence-sdk/mainsequence-claude-desktop).
It contains a checksum-pinned marketplace and versioned release archives. Both source repositories are public. Archive validation and release
publication do not establish successful installation through the Desktop GUI;
installation and upgrades remain acceptance items until exercised there.

## Live acceptance checklist

The following remain **unverified** until completed in an isolated Desktop Code
session with authorized test accounts and a disposable project:

- [ ] Install through the Desktop plugin manager, enable, reload, update and remove.
- [x] Verify the published versioned archive/checksum and install through the public marketplace in an isolated engine configuration.
- [ ] Install the public marketplace and direct archive upload through the Desktop GUI.
- [ ] Render and interact with every pane at normal window widths and with keyboard navigation.
- [ ] Browser MainSequence login/renewal/logout and project setup against a test backend.
- [ ] Python and frontend SDK workflows against supported installed SDK versions.
- [ ] Real Docker build/cancel and container configuration inspection.
- [ ] Add two Claude subscription accounts through browser sign-in.
- [ ] Switch accounts and independently verify ownership of the next model request.
- [ ] Verify the chosen identity after a Desktop host-token refresh and engine credential-cache expiry.
- [ ] Keep two sessions on different accounts; exercise concurrent selection, re-authentication and removal.
- [ ] Suspend a session beyond the heartbeat interval; confirm its reservation still blocks credential removal/replacement.
- [ ] Close/reopen sessions and restart Desktop; verify explicit selection/restoration and acknowledged cleanup of a reservation left by a crashed session.
- [ ] Verify automatic mode does not select an account before an explicit stored-profile selection.
- [ ] Exercise actual authentication/rate-limit failures, the two-switch recovery bound, expired sign-in, all-accounts-exhausted and cancellation states. Confirm recovery does not replay a prompt or tool.
- [ ] Change a stored credential and verify identity/quota refresh, duplicate detection and unknown/absent weekly-limit handling.
- [ ] Confirm existing MainSequence and external-provider configuration remains intact.

Do not substitute usage-percentage similarity for account identity evidence.
Do not sign into production accounts automatically as part of CI. Record only
redacted identities/test account labels and outcomes; never save access tokens.

## Known host gaps

The current adapter cannot programmatically open a signed native Desktop terminal,
change the Code session's project root, or reopen it inside a container. Folder
reveal and operation-target selection work independently. These gaps must remain
visible in the feature matrix and UI until a supported host API is integrated.

OAuth environment projection is implemented but remains `projected-unverified`.
Desktop token refresh can reassert the app's identity; live acceptance must establish
the supported behavior. The hook reasserts the selected credential before submission
and blocks a prompt when that credential is unreadable or expired; this still does
not verify the identity used by the host's eventual request. Stored token expiry
currently requires re-authentication.

Usage refresh is manual or driven by rate-limit measurement/failure events, with a
cache; the minute heartbeat only maintains the reservation. Failure recovery listens
to main-session `classic.StopFailure` events for `rate_limit` and
`authentication_failed`. Native simulator coverage of that hook does not establish
the delivery or identity behavior of every real Desktop authentication failure.

## Evidence updates

On 2026-10-14, the full release check passed: **134 Node tests**, documentation and
release metadata validation, standalone ZIP verification and an isolated npm
consumer. Desktop engine **2.1.295** validated the packaged mod and passed its
**three native simulator tests**. Final UI changes were also checked with the
11-test UI suite. ZIP tests verify hashes, safe paths, portable sources, local
documentation links and execution without this source checkout or node_modules.

When running a check, record the command, engine/app version, outcome and any
limitation here. Update checkboxes only after observing the stated behavior; a
native validator pass covers loading/static analysis, and native simulator tests
cover fixture interactions. Neither substitutes for actual window rendering or auth.

## Repository separation

The 0.3.1 plugin imports devtools 0.2.2. Shared project-operation tests live with
devtools; Claude account/UI/protocol/native-host tests live in this repository.
The full 134-test result above records the original combined implementation, not
a claim that the separated Claude test suite contains all those tests. Dependency
boundary tests reject private imports and copied shared implementation.

Separation verification on 2026-10-14: the independent Claude suite passed 43 tests
and the native engine passed three simulator tests. The additive devtools 0.2.2
source passed its release check with 87 tests and CI on Linux/macOS with Node 22. The development checkout
retaining its pending OpenCode implementation passed 95 tests. An isolated VS Code
consumer built against 0.2.2 passed 42 tests; one Python packaging-environment test
was skipped. The real VS Code checkout and its 0.2.1 pin were unchanged.

Registry dependency verification on 2026-10-14: devtools 0.2.2 was published by
the configured GitHub Actions trusted publisher. The temporary packed dependency
was removed, package-lock.json was generated from the public registry, and a fresh
`npm ci --ignore-scripts` succeeded. The full Claude release check passed again
with 43 tests and three native simulator tests against the extracted ZIP. The
lockfile and bundled build metadata record the registry SHA-512 integrity; no
local-file or sibling-checkout dependency is used.

Published preview 0.3.1 was verified on 2026-10-14 after independent CI and release
workflows passed. `npm run verify:published` anonymously fetched the public catalog,
ZIP and checksum, installed with Desktop engine 2.1.295 into a disposable
configuration, verified bundled devtools 0.2.2 and its lockfile integrity, then
passed native validation, three simulator tests and worker diagnostics.

- [Preview release](https://github.com/mainsequence-sdk/mainsequence-claude-desktop/releases/tag/v0.3.1)
- [Release workflow](https://github.com/mainsequence-sdk/mainsequence-claude-desktop/actions/runs/38578155128)
- Source revision: `3514a621b2bb7b81cbe25f541c91f611af58400b`.
- ZIP SHA-256: `466bce10675d2ee1e1942d0dcba32144a7ceba2747d6247be35ac9d3eeff4518`.

The previous 0.3.0 ZIP and checksum assets retained their original hashes. GUI
rendering, live account request ownership/refresh and the remaining acceptance
items above are still unverified.
