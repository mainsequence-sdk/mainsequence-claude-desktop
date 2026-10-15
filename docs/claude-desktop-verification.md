# Claude Desktop plugin verification

## Scope

The user approved the five-section browser layout on 2026-10-15. The 0.4.0 baseline
retains MainSequence login, removes Claude account switching and its runtime hooks,
and changes only this Claude repository. No backend changes or live account/provider
configuration edits are part of verification.

## Release status and evidence scope

The published preview is **0.4.1**, with devtools **0.2.3**. The tracked marketplace
and distribution metadata agree with the archive identity in the evidence below.
Publication and installation are complete; the unchecked live GUI/backend items
remain outstanding. The [first-run walkthrough](first-run.md) describes the intended
workflow and does not claim those live checks have passed.

Documentation was reconciled with `main` at `ba72cf6976497d54ace60e00d371fb1459c4dc24`
on 2026-10-15. That commit already contained the post-publication results. This
review does not rerun those account-facing operations or upgrade the installed plugin.

## Automated checks

Run `npm run verify:docs` for local documentation links, referenced npm commands
and attribution. This validates structure, not factual accuracy or live UI behavior.
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
marketplace installation on 2026-10-15. Version 0.4.1 uses devtools 0.2.3; its separate post-publication evidence is recorded
below. Automated installation evidence is not live GUI acceptance.

## Live acceptance still required

- [x] Install/update 0.4.1 through the supported plugin updater.
- [ ] Start a fresh Code session and verify the live environment picker.
- [ ] Check native pane width, section alignment, focus behavior and every section in the Desktop window.
- [ ] Capture native first-run screenshots for the plugin install card, General defaults and MCP environment selector, using a test account without personal information.
- [ ] Verify MainSequence browser login/renewal/logout against an authorized test backend.
- [ ] Exercise Python/frontend setup and supported SDK workflows on disposable projects.
- [ ] Exercise actual Docker build/cancellation and inspect container configuration output.
- [x] Verify the published 0.4.1 marketplace archive after release publication.

Existing accounts/provider configuration must remain intact. Do not use production
credentials in CI or save tokens in evidence. The account-switching acceptance
checklist from 0.3.x is retired because the feature is removed.

## Native screenshot evidence

The first-run guide currently contains a labelled navigation diagram. It does not
contain native Desktop screenshots. No native screenshot evidence has been recorded
for 0.4.1 yet, so screenshot capture and layout acceptance remain unchecked.
When completing the live checks, record the Desktop and bundled Code versions,
plugin version and capture date alongside screenshots. Show only the relevant
plugin UI, using test values with no tokens, personal account details or project
secrets; do not substitute browser mockups for native evidence.

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
