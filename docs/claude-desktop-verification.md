# Claude Desktop plugin verification

## Scope

The user approved the five-section browser layout on 2026-10-15. The 0.4.0 baseline
retains MainSequence login, removes Claude account switching and its runtime hooks,
and changes only this Claude repository. No backend changes or live account/provider
configuration edits are part of verification.

## Automated checks

Run `npm run release:check` for TypeScript, Node tests, documentation links,
packaging, checksum-pinned generated marketplace, portable ZIP inventory and
standalone worker checks. Set `MS_CLAUDE_DESKTOP_BINARY` for native loader and
simulator checks against Desktop's actual bundled engine.

Coverage includes:

- One pane, six sections, one selected navigation state, no Tools placeholder or
  AbovePrompt launcher; MainSequence branding packaged with the plugin.
- MainSequence login, renewal, logout, startup session reads and settings preservation.
- Explicit mutation confirmations and context-sensitive repository/SDK actions.
- Empty and populated Activity, collapsed details, streaming progress/cancellation.
- MCP exact-release registration and confirmed tool dispatch.
- Rejection of the removed accounts worker domain, including old serialized requests.
- No Claude token/credential APIs, account-related prompt/model hooks, account worker or rotation loop.
- Public devtools API imports, exact version/integrity pin, no copied shared source.

Native simulator tests mount actual native element trees while mocking processes,
MainSequence responses and stores. They verify confirmed operation dispatch, immediate
cancellation of a waiting worker and MainSequence login without Claude credential
access. They do not prove live backend operation success or final Desktop window
placement/styling. Tests use disposable configuration and synthetic values.

## 0.4.0 baseline evidence

2026-10-15: TypeScript check and 22 Node tests passed in the implementation build.
The release check passed, including documentation and standalone ZIP checks.
Desktop's bundled Code 2.1.295 validated the plugin and passed all three native
simulator tests. The final ZIP was extracted into an isolated directory with spaces in its path;
native validation and all three simulator tests passed there too. No normal Desktop installation, sign-in or provider changes were
performed to run these checks.

The 0.4.0 release with devtools 0.2.2 was published and verified through a public
marketplace installation on 2026-10-15. Version 0.4.1 uses devtools 0.2.3; its separate post-publication evidence is recorded
below. Automated installation evidence is not live GUI acceptance.

## Live acceptance still required

- [x] Install/update 0.4.1 through the supported plugin updater.
- [ ] Start a fresh Code session and verify the live environment picker.
- [ ] Check native pane width, section alignment, focus behavior and every section in the Desktop window.
- [ ] Verify MainSequence browser login/renewal/logout against an authorized test backend.
- [ ] Exercise Python/frontend setup and supported SDK workflows on disposable projects.
- [ ] Exercise actual Docker build/cancellation and inspect container configuration output.
- [x] Verify the published 0.4.1 marketplace archive after release publication.

Existing accounts/provider configuration must remain intact. Do not use production
credentials in CI or save tokens in evidence. The account-switching acceptance
checklist from 0.3.x is retired because the feature is removed.

## Host limitations

Claude controls pane placement and native button appearance. A browser mockup is
not a screenshot of the native application. The API does not expose the custom
right-toolbar registration used in the original request; the plugin opens its own
native pane and adds a `SessionMode` footer launcher to reopen it. `/ms` remains
an optional fallback. Closing the pane does not unregister the footer hook.

Signed native terminals, changing the Code session's working directory and launching
container sessions remain unavailable. Shared folder reveal and operation-target
selection are independent. Activity renders real textual progress, without fictional
setup percentages. See the [feature matrix](claude-desktop.md#feature-coverage-and-host-adaptations).

## 0.4.1 settings and environment verification

The shared dependency is devtools 0.2.3. Its 89 automated tests cover read-only
settings resolution and cross-environment enforcement. All 28 Claude Node tests and
the full portable release check passed against the published dependency. Regression tests
cover initial real default values, failed login, saved overrides, late responses,
settings preservation, environment-specific tool registration, stale tool rejection,
and switching while a confirmation is pending. Native loader validation and the
three Desktop simulator tests passed against Code 2.1.295 with disposable settings.
Only HOME and USERPROFILE are read by the hook; no credential environment variables
are read or written. Live backend/GUI acceptance remains distinct from these tests.


### Published 0.4.1 evidence

On 2026-10-15 the release workflow passed and published
[0.4.1](https://github.com/mainsequence-sdk/mainsequence-claude-desktop/releases/tag/v0.4.1).
The public catalog and archive were downloaded anonymously; the catalog checksum,
checksum asset, bundled devtools version and npm integrity pin matched. Archive SHA-256:
`f04e48e2f39f91ca28a82af16aa0ea569e728cdd9327ba87f73633c4b648150d`.
An isolated marketplace installation passed native validation, all three simulator
tests and the standalone worker check.

The existing user installation was then updated from 0.4.0 to 0.4.1 with Desktop's
bundled plugin updater, without replacing it by a manually extracted ZIP. The
installed build reports devtools 0.2.3. Active user sessions were not restarted.

Before/after hashes matched for Claude Code settings, local settings, its main
configuration, MainSequence CLI configuration and the MainSequence plugin store.
Claude's separate Desktop preferences file changed while the app was running;
its contents were not restored or edited, and byte-for-byte preservation of that
file is not claimed. No account switching, provider changes, live MainSequence
mutations or backend changes were performed for this verification.

## 0.4.2 Agents implementation evidence

On 2026-10-15 the isolated devtools 0.2.4 candidate passed 97 tests and its complete
release/package checks. Claude 0.4.2 passed 36 Node tests, typechecking, documentation
verification, portable ZIP checks and standalone worker execution using the exact
local devtools archive pinned by integrity in the initial implementation lockfile.

Desktop's bundled Code 2.1.295 validated the extracted portable ZIP and passed all
four native simulator tests. The Agents test mounts the real native pane, selects
an environment, clicks Talk, observes the plugin-attributed prompt, and invokes its
registered conversation tool to receive a synthetic agent reply. Host storage, tool
registration, process responses and prompt inference are mocked. No model or live
agent was contacted. This verifies the host API wiring, not live agent availability
or the final desktop window styling.

Regression coverage includes environment changes while approval is pending, stale
tool refusal, approved follow-ups, persisted conversation identity, task ownership,
crash/uncertain-send suppression and late replies after starting a new conversation.
During implementation validation, no normal Desktop configuration, existing accounts,
provider settings or backend files were changed. At that stage the public marketplace
remained on 0.4.1.

Pending live acceptance after publication/install: select an authorized environment,
open a deployed Message-capable agent, verify Claude receives its actual capability
reply, approve a follow-up, then switch environment and verify stale tools refuse.
Exercise Task mode only with an authorized disposable task. Shared package publication
precedes the dependent Claude release; see [release order](agents.md#verification-and-coordinated-release).

### Published shared dependency

The [devtools 0.2.4 publication workflow](https://github.com/mainsequence-sdk/mainsequence-devtools/actions/runs/38732377231)
succeeded from commit `57bb311` on 2026-10-15. The npm registry confirmed the version
and archive integrity; the compiled files match the tested local implementation.
Claude's lockfile now pins that public archive. A fresh `npm ci --ignore-scripts`
and the complete release check passed with all 36 Node tests against that dependency.
At this shared-dependency checkpoint, Claude 0.4.2 had not yet been published and the
installed Desktop plugin was unchanged. Its later publication is recorded below.


## Published 0.4.2 and normal installation

On 2026-10-15, [release 0.4.2](https://github.com/mainsequence-sdk/mainsequence-claude-desktop/releases/tag/v0.4.2)
was published by the [existing release workflow](https://github.com/mainsequence-sdk/mainsequence-claude-desktop/actions/runs/38735235100)
from source `5e4885a00cf5e6ac860460cd23221adce3173e16`, bundling the published devtools
0.2.4 archive and its lockfile integrity. The catalog and distribution metadata now
advertise 0.4.2. Archive SHA-256:
`99222ad46bfa244ddd225be47b0aff09e6bd4751180d776a2c760f1b643b2cc2`.

A clean registry install passed the full release check with 36 Node tests. Native
Code 2.1.295 validated the plugin and passed four simulator tests, including the
Agents prompt/tool-result flow with synthetic replies. Anonymous download verified
the public catalog, ZIP and checksum. A disposable marketplace installation passed
native validation, all four simulator tests and standalone worker execution.

The normal user-scope plugin was updated from 0.4.1 to 0.4.2 using Desktop's bundled
marketplace and plugin updater. Its enabled setting remained true, its installed
hooks matched the release source, and its bundled devtools version/integrity matched
the lockfile. The actual installed copy passed the worker check, native validation
and all four simulator tests using disposable configuration.

All eight protected account/configuration/store file snapshots were byte-identical
immediately before and after the update; other installed plugins were unchanged.
Across the longer verification period, the running app advanced a feature-cache
timestamp and an automatic-mode denial counter before the update snapshot. No
account/provider values, MainSequence settings or plugin-store contents changed.
Configuration values and credentials are not included in this evidence.

Claude had active sessions and the user was using its window. Those sessions were
not stopped, reloaded or restarted. A fresh local Code session is required to load
the new hooks. Final live pane styling and live agent conversation acceptance remain
pending; no live agent messages, task creation, sign-in changes or backend changes
were performed. Draft onboarding documentation PR #6 was left unchanged.


## 0.4.3 persistent launcher

The user approved the footer-button placement preview on 2026-10-15. The launcher
uses Desktop's `SessionMode` render site independently of the `Pane` site and
preserves `next(e)` so native footer content remains. The MainSequencePublic emblem
is reused. Pressing the button only calls `ui.open` for the existing pane ID; no
command is inserted, model prompt submitted, setting saved or credential accessed.
Terminal rendering is passed through. There is no `AbovePrompt` strip or application
patch. Existing accounts, provider configuration and settings require no migration.

Node regression coverage checks footer composition, reopen behavior, terminal
passthrough, unchanged settings and sanitized open failures. A native simulator
test mounts the footer, unmounts the pane render site, and presses the surviving
launcher again.
Live Desktop evidence is recorded below; simulator results alone do not establish
that the host displays the footer site in the normal application.

Automated candidate evidence (2026-10-15): all 37 Node tests, typechecking,
documentation and portable distribution checks passed. Desktop's bundled Code
2.1.295 validated the plugin and passed all five native simulator tests. Tests use
disposable configuration and synthetic responses. The native harness validates
render-site lifecycle and button dispatch; the live window check remains separate.

### Live Desktop candidate verification

On 2026-10-15 the candidate hook was temporarily staged in the installed plugin,
with the original hook backed up and its source digest checked first. All eight
protected account/configuration/store snapshots were byte-identical immediately
after staging. The normal marketplace catalog was still on 0.4.2 during this check.

In a fresh, empty local Code session prepared by the user, Claude's built-in
`/reload-plugins` command loaded the candidate. The MainSequence button appeared
at the right of the session footer while its pane was closed. Clicking it opened
the existing native pane; closing the pane left the button visible. Clicking the
surviving button reopened the pane. An unsent draft survived both close and reopen,
and was then cleared. No model prompt, MainSequence operation, sign-in, provider
change or backend mutation was requested. Other running Code sessions were left
running. The test session's own layout state changed through normal UI interaction.

The actual Desktop renderer draws a compact native text button. It does not show
the supplied footer SVG in this build; the existing pane header still displays the
MainSequencePublic emblem. The approved mockup's exact button styling is therefore
not claimed. This uses the supported footer hook without patching the app or
inserting a strip above the chat. The launcher is visible in the tested active
local Code session, not on the new-session landing page before an engine starts.
