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


### Published 0.4.3 and installed Desktop verification

The [0.4.3 release](https://github.com/mainsequence-sdk/mainsequence-claude-desktop/releases/tag/v0.4.3)
was published on 2026-10-15 by the
[release workflow](https://github.com/mainsequence-sdk/mainsequence-claude-desktop/actions/runs/38747460679)
from source `49f7750ddc8017f29a4c147861de37e9138368bc`. The public marketplace
catalog pins archive SHA-256:
`2e244300adbcae93f56919d26a340b5b09de6d9444ef1bd71a0519ab968211a0`.
The exact shared dependency remains devtools 0.2.4.

Anonymous download verified the catalog, archive and checksum asset. A disposable
marketplace installation passed native validation, all five native simulator tests
and the standalone worker check. Linux and macOS CI passed the 37-test release
check. The normal user-scope updater then upgraded the existing enabled plugin
from 0.4.2 to 0.4.3. Its installed hook matched the release source, its dependency
matched the lockfile, and all other installed plugin records were unchanged.

All eight protected configuration/account/store fingerprints were byte-identical
immediately before and after the marketplace update. Across the longer live test,
Claude updated its own feature/cache timestamps, runtime process metadata, pane
opening history and the test session's layout/selection state. Existing account,
provider, MainSequence and saved plugin setting values were unchanged. No backend
changes, sign-in/out, credential migration or account-switching actions were made.

After the update, `/reload-plugins` was run only in the dedicated empty test session.
The native MainSequence **Run diagnostics** action reported **Plugin 0.4.3** and
**Plugin files Ready**, verifying the published worker was active. The button
opened the pane, remained visible after closing it, reopened the same pane, and
remained visible after a second close. The pane was left closed and the test prompt
empty. The existing unrelated Code sessions were not stopped or reloaded. Runtime
diagnostics is a local read-only operation; no live backend operation was invoked
for this final check.


## 0.4.4 user-authored agent interactions

On 2026-10-15, ADR 0005 was updated before implementation to approve opening or
resolving an AgentSession on Talk, keyed to Claude's stable session ID, without
sending. At that initial verification, Claude 0.4.4 and shared devtools 0.2.5
were unpublished candidates, and the public marketplace and installed release
were 0.4.3. The subsequent compact-layout release is recorded below.

### Automated evidence

- Shared devtools: 101 passing Node tests, typechecking, release metadata checks,
  portable package checks and an isolated ESM consumer. Session allocation/resolution
  uses the existing gateway and never sends a message or requests runtime access.
  Tests validate agent/environment/session/handle identity and public projection.
- Claude: 41 passing Node tests, typechecking, documentation links, ZIP inventory,
  generated catalog checksum and standalone packaged-worker checks.
- Desktop's actual bundled Code 2.1.295: loader validation and all five native
  simulator tests passed using disposable configuration. The agent fixture opens
  a session, preserves/fills the native draft, submits only an explicit test command
  and verifies the exact text and resolved session UID. Process responses are
  synthetic; no model or live agent is called by these tests.
- Race/error coverage: per-agent opening/waiting, returning to a still-opening agent,
  independent simultaneous operations, serialized store writes, host/environment
  changes, same-chat reload, explicit new handle, late replies, uncertain sends,
  duplicate/empty/invalid submissions, and exact multiline/whitespace preservation.
- Timeout tests cover advertised metadata and a real local HTTP fixture accepting
  the 145-second send deadline while rejecting requests beyond the 300-second cap.

### Live Desktop evidence

The owner authorized the dedicated local “Reload plugins” test chat. The conversation
sidebar was hidden. The 0.4.4 candidate hooks and bundled worker were temporarily
staged over the installed plugin files after a full backup; the installed-plugin
registry and saved settings were not edited. The actual native reload command
activated the candidate only in that test chat.

Observed in the normal Desktop window:

1. Directory descriptions are hidden, and the CRM card's ⓘ shows its description
   and public capability information. The approved footer launcher stays unchanged.
2. Talk on CRM opens a remote session and fills the existing input with its agent
   command plus the already-typed test draft. No introduction or model turn appears.
3. Talk on Alpaca changes only its preparation/selection state and the command's
   recipient. The draft message is preserved; CRM retains its own session/status.
4. The local plugin store contains two distinct remote session UIDs under the
   current Code session ID, with separate stable handles, no tasks and no uncertain
   sends. Desktop's visible route ID differs from this host-provided Code ID.
5. After reloading, Talk on CRM resolves its saved session and fills a second unsent
   draft. The complete two-binding snapshot is identical before and after reload:
   both original handles and remote session UIDs are preserved.

Only two empty agent sessions were opened; no agent message, Task request, inference,
backend code/configuration change or provider change was performed. Actual message
exchange and Task execution were tested synthetically, not against live providers.
Live rename/fork/compaction were not exercised.

Afterward, the exact original 0.4.3 plugin files were restored and their full inventory
matched the backup. The installed registry was unchanged. The user returned to
another Claude chat before cleanup could reload the test chat; UI control stopped.
The test chat retains the candidate in memory and an unsent test draft until its
next reload. No unrelated session was reloaded or interrupted.

### Preservation and release boundary

Before/after file and JSON-field fingerprints were recorded without printing secrets.
Claude settings, local settings, credential files where present, Desktop configuration
and MainSequence CLI configuration were unchanged. Existing plugin settings,
environment selection and earlier conversation records were unchanged. The only
plugin-store additions are the two authorized test conversation bindings. Claude's
running process refreshed its feature cache and cache timestamp in `.claude.json`;
this is not claimed to be byte-for-byte unchanged. No account/provider field was
modified, and no credential was read or written by the hooks.

During that initial candidate verification, public marketplace metadata was not
advanced and no source push, npm publication or GitHub release was performed.
The coordinated publication below follows the required shared-dependency-first order.


### Directory card refinement

The owner requested removal of the repeated environment/branch line from cards.
The 0.4.4 candidate now keeps that metadata and deployment status behind ⓘ;
the directory and selected-conversation heading no longer repeat the environment.
The deployment detail reads “Deployment up to date” instead of “Runtime current”.
This is a presentation-only refinement; session handling, settings and the launcher
are unchanged. The existing UI suite and documentation checks cover this revision;
it has not been reinstalled, published or checked again in the live Desktop window.


### Approved compact native layout

On 2026-10-15 the owner approved the compact preview and authorized publication.
The implementation uses Claude's Box, Text, Button, Input, Select and Svg primitives.
Native control defaults and dimColor provide host theming; the browser preview's
copied CSS values are not shipped in the plugin. The MainSequence emblem is retained.

Navigation is two wrapping rows of direct native buttons with a checkmark for the
active section. There are no surrounding navigation cards, fixed percentage widths,
or raw palette overrides. Section content is unframed. Environment names appear once
in their picker; the existing refresh action remains beside its label. Search has a
label above the input, with its Search action beside it.

Each agent row keeps its name, information button and speech-bubble Talk button
aligned. The name can wrap while the action group does not shrink. No initials,
inline description, environment/branch, deployment status or duplicated selected
conversation card is rendered. Preparation, task, delivery uncertainty and errors
remain visible only under the relevant agent. Details retains its labeled Talk and
new-conversation actions. The API's native Button accepts a text/glyph label;
it does not export a CSS theme import or arbitrary HTML for the pane.

The browser approval preview verifies the composition and interactions. The native
loader/simulator verifies accepted elements and event routing, not final pixels.
The earlier live session/draft evidence above remains applicable to the unchanged
interaction logic; final compact pixel rendering has not been checked in a live
Desktop window. No normal Desktop installation, settings or accounts are modified
by release verification, which uses disposable configuration.


The final compact implementation passed all 41 Node tests, typechecking, documentation
checks, portable archive verification and all five simulator tests in the installed
Claude Code 2.1.295 engine using disposable configuration. The existing per-agent
concurrency checks now inspect the row status rather than a changing button label.
The icon button does not change meaning while a session opens; only that agent's
status reports preparation. MainSequence login and saved-setting tests passed.

The shared 0.2.5 package was published by the existing
[trusted-publisher workflow](https://github.com/mainsequence-sdk/mainsequence-devtools/actions/runs/38793518629).
Its public npm tarball matched the checked CI artifact byte for byte. The consumer
lockfile now pins that public archive with integrity
`sha512-3R100Zcp8409bjBpFnoJIvgzOQum2O5LCaEz7q6oRBVSVggCnJLxjl/fukjfj0HIZPM9TjBuSVNrUnCAawuiRw==`.
The release was rebuilt from a clean registry installation, without a local package
override. Marketplace publication uses the existing immutable-archive workflow.

## 0.4.5 readiness and agent defaults

ADR 0005 was amended before implementation on 2026-10-16. The candidate uses
shared devtools 0.2.6. Its 108 tests cover explicit submission admission, retry
intervals, timeouts, cancellation, credential-free output, session/account validation,
opt-in send gating and public agent defaults. The 47 Claude tests cover pending
readiness, preserving edits made during the wait, stale responses, cancellation,
independent agent status, default labels and General-only session renewal. Full
release checks and all five native Desktop simulator tests passed against Code
2.1.295 with disposable configuration.

In the authorized empty “Reload plugins” Desktop chat, the candidate was staged
with an exact backup of the existing installed plugin and no registry change.
CRM Talk initially encountered a backend connection failure; the input stayed
unchanged and offered a retry. An explicit retry opened/resumed the existing
session, displayed Checking agent, and only after runtime admission displayed
“Agent ready · no message sent” and prefixed the existing draft with that agent's
`/ms agent <uid>` command. Other agents did not inherit its status. The draft was
not submitted and no live agent message or model turn was requested. The final
readiness wait uses the deployed `runtime_interaction.can_submit` contract, not
routing-only `is_ready`.

General → MainSequence account → Manage account exposes Renew session. It was
inspected without invoking renewal or sign-out. The saved backend and repository
folder remained the actual editable values. Before/after hashes matched for
Claude settings, credentials, Desktop preferences, MainSequence CLI configuration
and the plugin’s saved settings. Claude’s main configuration later updated only
its `cachedGrowthBookFeaturesAt` timestamp; its account/provider fields remained
unchanged. No app-generated cache timestamp was restored. Only the authorized local test
chat was reloaded; no backend file or provider configuration was changed.

A live cold-start cycle was not forced: no agent was stopped or redeployed for
this test. Starting/waking-to-ready behavior and cancellation are covered by the
shared tests and the native simulator. Live message delivery is outside this
verification because the user requested no automatic send.

The live directory displayed provider, model and thinking defaults beneath all
five agent names from the existing backend fields. Example: CRM assistant returned
`openai-codex`, `gpt-5.6-luna`, `medium`. The model name is displayed verbatim;
no provider selection or session override is made. The information and Talk controls
retain the approved name-row alignment, with metadata below that row.

The owner’s values-only refinement was verified in the real Desktop pane:
`openai-codex · gpt-5.6-luna · medium`, without Defaults/Provider/Model/Thinking
labels. Information and Talk icons are aligned with the name, with this metadata
on the next line.

The [devtools 0.2.6 release workflow](https://github.com/mainsequence-sdk/mainsequence-devtools/actions/runs/38872007376)
succeeded. The public npm archive’s integrity was verified and all 54 compiled
shared files matched the tested candidate. A clean install from that public
archive passed the complete Claude release checks and all five native tests.

### Published 0.4.5 and normal Desktop update

The [0.4.5 marketplace release](https://github.com/mainsequence-sdk/mainsequence-claude-desktop/releases/tag/v0.4.5)
was published by the [release workflow](https://github.com/mainsequence-sdk/mainsequence-claude-desktop/actions/runs/38872887074)
on 2026-10-16. Anonymous download verification matched the catalog and checksum
asset: `4e35110c7e001cb9818d38c0b2c83b3a4c555f5a18ebc8ba7775ad901689910c`.
An isolated normal marketplace installation passed native validation, all five
native simulator tests, the pinned devtools 0.2.6 check and standalone diagnostics.

The temporary Desktop test cache was restored exactly from its backup before
running the official marketplace refresh and plugin updater. The normal user
installation updated from 0.4.3 to 0.4.5. Other installed plugin records were
unchanged. Only the authorized test chat ran the local reload command; General's
live diagnostics then reported Plugin 0.4.5 and Plugin files Ready.

Post-update checks preserved the existing MainSequence settings, environment
selection, account/provider configuration and credential files. The only detected
change in Claude's main configuration was its own cached feature timestamp, as
noted above. No backend code or configuration changed and no agent message was
submitted during verification.

## 0.4.6 MCP release-detail compatibility

On 2026-10-16 the candidate bundles the public devtools 0.2.7 archive with its
registry integrity pin. Missing release display names no longer block MCP add,
tool listing or calls. Claude selectors, registered tool descriptions and
availability errors use the release UID when no display name is available.

Both new regressions failed against 0.4.5 before the fix. All 49 Node tests now
pass. The packaged-worker integration starts real platform/project HTTP fixtures
and a fresh bundled worker process for discovery, add, saved-connection listing,
tool listing and a tool call. Only the public factory's metadata-storage path is
injected to isolate the test. Release details and saved records have no `name`;
credentials are synthetic. Access denial, endpoint changes, missing capability
and a mismatched release UID fail before credential exchange or project execution.

The exact ZIP passed portable inventory, checksum, marketplace, documentation and
standalone-worker checks. Desktop's bundled Code 2.1.295 validated the extracted
plugin and passed all five native simulator tests with disposable configuration.
These checks establish code and packaging behavior; they do not claim live GUI or
live backend acceptance for this Claude release.
