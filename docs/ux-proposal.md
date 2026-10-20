# MainSequence pane: UX analysis and redesign proposal

Status: implemented in 0.4.11 (2026-10-20); see "Deviations" at the end. Written as
a proposal on 2026-10-20 against 0.4.7. Covers the Claude Desktop pane rendered by
`manifests/claude/hooks/view.mjs`, `agentView.mjs`, `projectView.mjs`, the footer
launcher and the composer band in `register.mjs`. A rendered before/after sketch is in
[ux-proposal-mockup.html](ux-proposal-mockup.html).

## 1. Summary

The pane works, but it reads like a debugging console rather than a product surface.
The five root causes:

1. **Seven peer sections with no hierarchy.** Navigation is two wrapped rows of
   plain buttons with a `✓` prefix on the active one. First-run setup (sign in, pick a
   folder) sits next to daily work (talk to an agent, set up a project) with equal weight.
2. **No status at a glance.** Nothing tells the user whether they are signed in, which
   environment is active, which repository is current, or what is running, unless they
   visit the right tab and press a button.
3. **Flat typography and chrome.** The view uses only `bold` and `dimColor`. The host
   offers a type scale, weights, theme colors for success/error/warning, primary
   buttons, borders, links and Markdown. None of them are used, so every card, label,
   result and error looks the same.
4. **Dropdowns instead of lists, and button walls instead of flows.** Repositories, local
   copies, MCPs and MCP tools are all `Select`s, so the user cannot see what exists
   without opening each one. Current Repository shows about seventeen buttons at once.
   Buttons that are unavailable disappear instead of being disabled, so the layout jumps
   and nobody knows why an action is gone.
5. **Developer vocabulary.** "Identify repository", "Refresh Claude tools", "Sync skills"
   versus "Install skills", "Clean legacy environment credentials", "Organization folder",
   "Review and call tool", "Arguments (JSON object)", "resource release", emoji-only
   buttons (`ⓘ`, `💬`) and a raw UUID pushed into the composer.

The Agents tab is the exception. It already has the right pattern (a list with rows,
inline actions, a detail view with a back button). The proposal generalizes that pattern
to the whole pane, cuts the sections from seven to four plus Settings, adds a persistent
status header, and defines a small visual system built only from host primitives.

## 2. What the user sees today

### 2.1 Shell

- Header: emblem plus "MainSequence" title, then a `section-navigation` box with two
  rows of buttons (`view.mjs:53`). The active
  section is marked with `✓ ` text and the others are dimmed. Buttons in two rows look
  like a toolbar of actions, not navigation.
- On Projects, MCP and Agents a second header block appears: "Organization environment",
  a Refresh button, a select, and a helper line (`view.mjs:37`).
  It takes four rows on every visit, repeats on three tabs, and disappears on the others,
  so the user loses track of which environment applies.
- Confirmations replace the entire page, including navigation
  (`view.mjs:65`). The user loses context about
  where they were and what the values on screen were.
- Footer launcher is a text button "MainSequence" beside an emblem
  (`register.mjs:470`). Fine, but it says
  nothing about state.

### 2.2 General (landing tab)

`view.mjs:74-110`

- Three cards: account, workspace settings, advanced. Settings (backend URL, Command
  Center URL, repositories folder) are permanently expanded on the landing tab although
  they are set once. The backend URL is exposed to every user.
- Three nested disclosure toggles: Manage account, Runtime & diagnostics, Executable
  overrides, each with its own Technical details toggle.
- No "what next". A signed-in user lands on a settings form instead of their work.

### 2.3 Repositories

`view.mjs:120-141`

- One `Select` for remote repositories and another `Select` for local copies of the same
  repositories. The user has to pick a repository to learn whether it already exists
  locally.
- "Organization folder" input and "Scan local repositories" are exposed as if they
  were routine. "Destination: Choose a folder in General" sends the user to another tab.
- Results render as a summary line plus a "Technical details" JSON toggle
  (`view.mjs:24`); success and failure look alike.

### 2.4 Current Repository

`view.mjs:152-178`

- A folder input, a type select, then four cards containing roughly seventeen buttons
  with no primary action and no state: Refresh status, Identify repository, Check SDK,
  Sync dependencies, Install dependencies, Preview SDK update, Update SDK, Update agent
  instructions, Preview skill installation, Install skills, Sync skills, Clean legacy
  environment credentials, Open folder, Open signed terminal, Review Docker build,
  Review container configuration, Open container.
- Container image and Docker platform inputs are always visible.
- The repository's actual status (branch, dirty, SDK version, dependency state) is not
  shown until the user presses Refresh status, and then only as a text summary.

### 2.5 Projects

`projectView.mjs`

- Every project, repository and branch is a `Button`, so names look like actions. The
  selected project's detail is appended below the list rather than replacing it.
- The view uses no `bold`, `dimColor` or sizes at all; the project name, its description
  and the "N visible branches" line are the same weight.
- "Set up project locally", the one action that matters, has the same look as "Open in
  Command Center". Disabled buttons here use `disabled`
  (`projectView.mjs:8`) while the rest of
  the pane hides them (`view.mjs:17`).

### 2.6 MCP

`view.mjs:192-209`

- Three cards of selects. The same `selectedMcp` state drives both the "Discovered MCP"
  and the "Connected MCP" select, so choosing one silently changes the other.
- "Refresh Claude tools" and "Tool explorer" with a raw JSON arguments field are
  debugging features presented at the same level as connecting an MCP.
- No list of connected MCPs with their status or tool count.

### 2.7 Agents

`agentView.mjs`

- The best section: header with Refresh, search row, agent rows with icon, name and
  inline actions, a detail view with a back button and sign-in and environment gates.
- Issues: emoji-only buttons `ⓘ` and `💬` (`agentView.mjs:25`,
  `agentView.mjs:57`); every row shows
  "Not configured · Not configured · Not configured" when defaults are absent
  (`agentView.mjs:13`); up to five status
  lines stack under a row; no primary call to action.
- Talk fills the composer with `/ms agent <36-char uuid> `
  (`register.mjs:694`). The user then types
  after a UUID. The band above the prompt already shows the agent name, so the UUID is
  redundant noise from the user's point of view.

### 2.8 Activity

`view.mjs:218-233`

- Correct content, but it lives in a tab the user is not on while something runs.
  Progress is only visible by switching away from the work that started it. Each
  operation is a card with a "Status: Running" line rather than a status color or glyph.

## 3. Design principles for the redesign

1. **Status first.** The header always answers: who am I, which environment, which
   repository, what is running.
2. **One list pattern.** Anything the user chooses from is a list of rows with a name,
   a status, and inline actions. `Select` is reserved for settings and for short
   enumerations (branch, environment, repository type).
3. **Master and detail.** Picking a row replaces the list with a detail view and a back
   control, as Agents already does. Never append detail under a list.
4. **One primary action per view.** Use `variant: 'primary'` for it. Secondary actions
   are secondary buttons. Rare or dangerous actions live under a disclosure or in a menu
   at the bottom of the detail.
5. **Disable, do not hide.** An action the user cannot take yet stays visible, disabled,
   with a one-line reason beneath it.
6. **State has color and size.** Use theme keys `success`, `error`, `warning` and
   `subtle` for status; `size: 'heading'` for section titles, `caption` for metadata.
7. **Plain language.** Labels name the outcome in the user's words. Jargon moves into
   Settings or a help line.
8. **Confirm in place.** Use `$.ui.ask` for confirmations instead of replacing the pane.

## 4. Proposed information architecture

Seven sections become four plus Settings and a header:

| Today | Proposed | Notes |
| --- | --- | --- |
| General | **Header** + **Settings** | Account state, environment and running count move to the header. Backend URL, folders, Command Center URL and diagnostics move to Settings, opened from a gear button. |
| Repositories, Current Repository | **Code** | One list of repositories with a "Local" badge, each row expanding to the detail that Current Repository shows today. The session's own folder is pinned at the top as "This session". |
| Projects | **Projects** | Same data, list-to-detail navigation, one primary button. |
| Agents | **Agents** | Keep, polish. |
| MCP | **Tools** | Connected MCPs as a list with status; "Add" opens the search; tool explorer under "Advanced". |
| Activity | **Header counter + Home strip** | A "2 running" chip in the header opens the full list. Home shows the last few. |

### 4.1 Header (every view)

Row one: emblem, "MainSequence", then a right-aligned group of chips:
- Account: `● jose` in `success`, or `Sign in` as a primary button when signed out.
- Environment: a compact `Select` labelled with the environment name, dimmed when none.
- Activity: `2 running` in `warning` when something runs, `✓` dim when idle. Pressing
  it opens the Activity list. Also mirror the running count with `$.ui.status`.
- Settings: a `⚙ Settings` secondary button.

Row two: four navigation buttons in one row. The active one is `variant: 'primary'`
and the others `plain`. No `✓` prefix.

Row three (conditional): one line in `warning` or `error` for a blocking condition,
with the fix as a button, for example "Choose a repositories folder" or
"No environment selected". This replaces the per-tab gate screens.

### 4.2 Home (default view after first run)

Replaces General as the landing view once the user is signed in.

- **This session** card: folder name, branch, dirty state, SDK version and up-to-date
  state read from the existing `status` and `sdk-status` actions on open. Three
  buttons: Sync dependencies (primary when out of date), Update SDK (when available),
  Open folder.
- **Recent** strip: the last three operations with a status glyph and one line each,
  and a "See all" link to Activity.
- **Next steps** card, only when something is missing: sign in, pick environment,
  choose folder. Each step is a row with a button. Disappears when complete.

### 4.3 Code

- A search field and a filter row: All, Local, Remote only.
- Rows: repository name, type badge (Python / React), `Local` badge in `success` when a
  checkout exists, default branch in caption. One inline button: "Set up" (primary) for
  remote-only, "Open" for local.
- Row press opens the detail: name, path, branch select, status lines (Git, SDK,
  dependencies), and three grouped sections: **Dependencies** (Sync, Install, Update SDK),
  **Instructions and skills** (one "Update instructions and skills" button that runs
  the preview first, plus a disclosure for the individual actions), **More** (Open
  folder, Open terminal, Docker build, Container configuration, Delete local copy,
  Clean legacy credentials). Container inputs appear only after pressing Docker build.
- Setting the detail's folder as the "current" target is explicit: "Use for this
  session" in the detail header.

### 4.4 Projects

- Search field, then rows: project name in `semibold`, description in caption, badge
  with branch count, `Local` badge when a workspace exists.
- Detail: name, description, repositories grouped with their branches as plain text
  rows and a `Link` glyph per row that opens Command Center or GitHub. Links use the
  `Link` element so they look like links rather than buttons.
- Primary button: "Set up locally" or "Open in Claude" when the workspace exists.
  "Update local workspace" as secondary. The workspace path in caption beneath.
- Setup progress shows inside the detail as a list of repository rows with per-row
  state (Ready, Cloning, Switching branch, Failed), fed by the progress messages the
  worker already streams.

### 4.5 Agents

- Replace `ⓘ` with a chevron-style row press (the whole row opens detail) and `💬` with
  a labelled "Talk" button, primary for the active agent.
- Show the defaults line only when at least one value is configured; otherwise nothing.
- Collapse the status stack into one status line with a glyph and theme color:
  `● Ready` in success, `◌ Opening session…` in subtle, `! Needs attention` in error,
  with the retry or cancel button inline on the same row.
- Detail: description via `Markdown` so bullet lists and emphasis in agent descriptions
  render, skills as a two-level list, example questions as pressable rows that fill the
  composer with that question.
- Composer: fill `/ms <message>` and resolve the agent from `state.activeAgent`, keeping
  `/ms agent <uid>` as the explicit form for the model and for scripts. The composer band
  already shows the active agent's icon and name; add a "Switch" button there that
  opens the pane on Agents.

### 4.6 Tools (MCP)

- Rows of connected MCPs: name, environment in caption, `n tools` badge, `Connected`
  in success. Inline "Disconnect" as a dim secondary button.
- "Add MCP" primary button opens the search view: field, results as rows with a
  "Connect" button each, pagination as "Load more".
- "Tool explorer" moves under a disclosure "Advanced: call a tool directly" at the
  bottom of the connected MCP's detail. "Refresh Claude tools" becomes "Re-register
  tools" inside that disclosure with a help line explaining when it is needed.

### 4.7 Activity

- Opened from the header counter. Rows, newest first: status glyph in theme color,
  title, context in caption, elapsed time, Cancel inline while running.
- Result details stay collapsed, but the summary line is colored by status and failures
  show the first line of the error in `error`.

### 4.8 Settings

Opened from the gear. Sections: Account (sign in, renew, sign out), Workspace (backend
URL, repositories folder with Choose, Command Center URL), Advanced (Node path,
diagnostics, Technical details). Save is a single primary button at the bottom with an
"Unsaved changes" caption when `editedSettings` is non-empty.

## 5. Visual system (host primitives only)

| Need | Primitive | Today |
| --- | --- | --- |
| Section title | `Text size="heading" weight="semibold"` | `bold` |
| Row name | `Text weight="medium"` | `bold` |
| Metadata | `Text size="caption" dimColor` | `dimColor` |
| Status | `Text color="success" / "error" / "warning"` with a glyph (`●`, `!`, `◌`) | plain text |
| Primary action | `Button variant="primary"` | none |
| Secondary action | `Button variant="secondary"` or `dimColor` | plain |
| Unavailable action | `Button disabled` + caption reason | hidden |
| Links | `Link href` | `Button` |
| Descriptions | `Markdown text` | `Text` |
| Card | `Box borderStyle="round" borderDimColor paddingX={1}` | unbordered Box |
| Row hover | keyed `Box` with `hover={{ backgroundColor: 'subtle' }}` | none |
| Keyboard | `Button hotkey` on the primary action per view, `Input autoFocus` on search | none |
| Confirmation | `$.ui.ask` | full-page replacement |
| Background progress | `$.ui.status('MainSequence: 2 running')`, `$.ui.notify` on completion | Activity tab only |

Use the `Space` steps (`xs`, `sm`, `md`) instead of raw numbers so the desktop surface
spaces rows consistently.

### Label glossary

| Today | Proposed |
| --- | --- |
| Identify repository | Detect repository |
| Refresh Claude tools | Re-register tools (Advanced) |
| Update agent instructions / Install skills / Sync skills | Update instructions and skills, with individual actions under Advanced |
| Clean legacy environment credentials | Remove old credentials from .env (Advanced) |
| Organization folder / Scan local repositories | Removed from the main view; folder is derived from the signed-in organization |
| Review and call tool / Arguments (JSON object) | Call a tool directly / Arguments (JSON) under Advanced |
| Discovered MCP / Connected MCP | Add MCP / Connected |
| Deployment up to date | Up to date |
| ⓘ / 💬 | row press / Talk |
| Set up locally / Set up & install | Set up, with an "Install dependencies after setup" checkbox-style toggle |

## 6. Key flows after the redesign

**First run.** Open pane → header shows "Sign in" primary → browser sign-in → header
shows account → Next steps card: "Choose environment" (select inline), "Choose
repositories folder" (button opens the native chooser). Both done → card disappears,
Home shows This session and an empty Recent strip with "Set up a project" and "Talk to
an agent" buttons.

**Set up a project.** Projects → row → detail → "Set up locally" (primary) → `$.ui.ask`
confirmation with the folder path → progress rows inside the detail → "Open in Claude"
becomes primary. The header counter shows "1 running" throughout, so the user can go
elsewhere and come back.

**Talk to an agent.** Agents → row → "Talk" → status line `◌ Opening session…` in the
row and in the composer band → composer filled with `/ms ` → user types and sends →
reply appears in the transcript with the agent icon (already implemented).

**Connect an MCP.** Tools → "Add MCP" → search → row → "Connect" → `$.ui.ask` → row
moves to Connected with its tool count. Tools are registered on the next prompt; a
caption says so.

## 7. Implementation plan

**Phase 0, visual pass (view code only, no state or worker changes).**
- Introduce a shared `primitives.mjs` with `heading`, `caption`, `status`, `card`,
  `row`, `primary`, `secondary`, `disabledWithReason`, and use it from the three view
  modules.
- Replace hidden buttons with disabled ones plus a reason.
- Color results by status; replace "Technical details" with "Details".
- Fix the shared `selectedMcp` between discovered and connected.
- Replace emoji buttons and the glossary labels.
- Tests: `tests/claude-ui.test.cjs` asserts keys and `dimColor` on tabs; keep the keys,
  update the assertions that check labels.

**Phase 1, shell.**
- Header with account, environment, running counter and Settings; single-row navigation
  with four sections; conditional blocker line.
- Move General's content into Settings and the Next steps card.
- Confirmations through `$.ui.ask`.
- Mirror running operations through `$.ui.status`.
- Tests: the "seven coordinated sections" test
  (`claude-ui.test.cjs:137`) and the desktop simulator
  tests that press `tab-*` keys need new keys. `docs/claude-desktop.md` and the README
  describe the seven-section layout as approved on 2026-10-15 and must be revised with
  the new approval.

**Phase 2, lists and details.**
- Code: merge Repositories and Current Repository into list and detail.
- Projects: list and detail, `Link` for repository and branch links, progress rows.
- Tools: connected list, Add flow, explorer under Advanced.
- Agents: row press, Talk button, single status line, Markdown description, pressable
  examples, `/ms <message>` routing to the active agent.

**Phase 3, polish.**
- Hover states on rows, hotkeys for primary actions, `autoFocus` on search fields,
  `closeOnEscape` on the pane, `rows` and `columns` hints on `ui.open`, layout that
  adapts to `placement: 'inline'` versus `'dock'` (two-column header when docked).

## 8. Constraints and open questions

- The pane is drawn from host primitives only. There is no custom CSS, no icon font and
  no table element. Rows are `Box` with `flexDirection: 'row'`; badges are `Text` with
  `backgroundColor`. The mockup approximates what those primitives produce.
- `Button` children may only be strings and `Text`, so a row with an icon and a label is
  a `Box` with the icon beside a `Button`, as Agents already does.
- Desktop flattens the footer `SessionMode` slot to a text button; the launcher stays
  as it is. The composer band is the right place for the active agent and for a
  "running" indicator.
- The current seven-section layout was recorded as user-approved on 2026-10-15. Phase 1
  changes that agreement and needs explicit sign-off before the docs and tests move.
- Merging Repositories and Current Repository changes what "the current repository"
  means in the worker requests (`root`). The proposal keeps the explicit "Use for this
  session" action so the operation target never changes implicitly, matching the
  existing documented rule.

## 9. Deviations in the 0.4.11 implementation

- **Confirmations stay in the pane**, drawn above the view with the header and
  navigation still visible, instead of `$.ui.ask`. The container-configuration preview
  shows a before/after diff that a dialog could not hold.
- **Project repository and branch links stay Buttons** (drawn plain with a ↗ glyph).
  The worker resolves the Command Center or GitHub URL, so there is no `href` for a
  `Link` element in the pane.
- **Opening a local repository detail makes it the operation target.** There is no
  separate "Use for this session" action; the detail header shows the folder, and the
  rule that the target is never Claude's working directory is unchanged.
- **No hover styling or hotkeys** yet. Theme-key backgrounds under the pointer were not
  verified in the live app, and hotkeys would compete with the composer.
- **The composer names the agent.** Talk prefills `/ms @<handle> ` rather than a bare
  `/ms `, because a prefix without a target left the person unsure who would receive
  the message; a bare `/ms <message>` is refused with the prepared handles.
- **Environments are not loaded at startup.** The header offers "Choose environment"
  (and Home a next step) that loads them on request, so startup still spawns only the
  preference and session reads.
