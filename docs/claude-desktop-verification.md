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
native pane and provides `/ms` to reopen it.

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
local devtools archive pinned by integrity in its lockfile.

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
No normal Desktop configuration, existing accounts, provider settings or backend
files were changed. The public marketplace remains on 0.4.1.

Pending live acceptance after publication/install: select an authorized environment,
open a deployed Message-capable agent, verify Claude receives its actual capability
reply, approve a follow-up, then switch environment and verify stale tools refuse.
Exercise Task mode only with an authorized disposable task. Shared package publication
must precede the dependent Claude release; see [release order](agents.md#verification-and-coordinated-release).
