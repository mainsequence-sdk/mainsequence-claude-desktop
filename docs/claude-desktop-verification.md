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

- One pane, five sections, one selected navigation state, no Tools placeholder or
  AbovePrompt launcher; MainSequence branding packaged with the plugin.
- MainSequence login, renewal, logout, startup session reads and settings preservation.
- Explicit mutation confirmations and context-sensitive repository/SDK actions.
- Empty and populated Activity, collapsed details, streaming progress/cancellation.
- MCP exact-release registration and confirmed tool dispatch.
- Rejection of the removed accounts worker domain, including old serialized requests.
- No Claude token/credential APIs, prompt/model hooks, account worker or rotation loop.
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
marketplace installation on 2026-10-15. Version 0.4.1 uses devtools 0.2.3 and requires
its own post-publication verification; earlier evidence is not GUI acceptance.

## Live acceptance still required

- [ ] Install/update 0.4.1 through the supported plugin updater and start a fresh Code session.
- [ ] Check native pane width, section alignment, focus behavior and every section in the Desktop window.
- [ ] Verify MainSequence browser login/renewal/logout against an authorized test backend.
- [ ] Exercise Python/frontend setup and supported SDK workflows on disposable projects.
- [ ] Exercise actual Docker build/cancellation and inspect container configuration output.
- [ ] Verify the newly published 0.4.1 marketplace archive after release publication.

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
