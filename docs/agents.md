# Agents in Claude Desktop Code

Agents uses your existing MainSequence login and the selected organization
environment. MCP and Agents share that selection. No backend routes, models,
Claude accounts or provider configuration are changed.

## Choose an agent and write a message

Compact rows show the agent name, **ⓘ** and **💬** Talk on one aligned row.
Conversation progress appears only beneath the agent it belongs to. The controls
inherit Claude’s theme; there are no custom gold colors, initial badges or nested
button frames. The environment
is already selected above; environment/branch and deployment metadata are shown
only in **ⓘ**, alongside the description, public skills and examples. “Deployment
up to date” means the active deployed commit matches the backend's latest recorded
branch commit. It is not a connection health check.

**💬 Talk to agent** creates or resumes an empty MainSequence agent conversation and
fills Claude's existing input with `/ms agent <agent-uid> `. It does not send an
introduction or start a model turn. Write your question after the prefix and submit
it yourself. The plugin sends your text directly to the selected agent and shows
the reply with its agent/environment label in Claude's command transcript.

Existing draft text is preserved. Choosing another agent changes the routing prefix
and keeps the message. Repeated clicks do not duplicate the prefix. An unrelated
slash command stays untouched; clear it before preparing an agent message. Empty
or invalid commands do not send. Agent commands accept text only. Ordinary Claude
chat and bare `/ms` retain their existing behavior.

For agents advertising Task support, `/ms task <agent-uid> <message>` starts longer
work. Task-only agents use that prefix automatically. Task tools offer status,
bounded waiting and cancellation for tasks returned by that conversation. There is
no background polling loop or promise that completion wakes Claude. Cancellation
is requested until the platform confirms it. Cancelling a local worker in Activity
does not cancel a remote task.

An explicitly submitted composer command authorizes that exact message. Claude's
model-initiated follow-up tools still show the target, message and environment for
confirmation. Descriptions and replies are external data, not higher-priority
instructions. No model rewrites your direct command's message before delivery.

## Sessions and separate statuses

A conversation is keyed by Claude's stable session ID, backend, MainSequence
account, environment and Agent UID. Names are labels. The default remote handle is
`claude_<claude-session-id>_<agent-uid>_default`; opaque non-UUID host IDs use a stable
SHA-256 encoding. Compatible existing handles take precedence. Claude's ID is an
external association, never Django's `parent_session_uid` foreign key.

Talk calls the existing `agent.get_or_create_session` endpoint through shared
devtools and saves the returned AgentSession UID before enabling a send. Allocation
uses no runtime-access request or agent message. Missing provider/model defaults
are reported without changing them. A saved session that is unavailable is not
silently replaced.

Each agent owns its preparation, session, task IDs, progress and delivery state.
Selecting B does not give B the status or reply of A. Returning to A resumes A.
Reloading the same Claude chat resolves the saved sessions. Renaming/compacting a
chat that retains its ID keeps its mappings; a new or branched chat with a different
ID gets separate mappings. Full Claude history is not transferred to the agent.

**ⓘ → Start new conversation…** asks for confirmation, then opens a new session
handle for that agent. It preserves earlier remote history and does not cancel old
work. A late old reply cannot overwrite the new conversation mapping.

Backend/environment/account changes invalidate prepared routing. Every operation
also checks the current MainSequence account and agent environment in shared
devtools. Stale commands/tools are refused. Selecting a different agent alone does
not invalidate another agent's conversation. Claude cannot unregister old tool
names, so inactive tools return a clear refusal.

The plugin store holds only handles, session/task IDs and uncertain-delivery markers,
partitioned by conversation identity. It does not add a token or transcript store.
A marker is persisted before sending. Ambiguous delivery, timeout or crash blocks
automatic replay, including after reload. Review Activity and the known task before
starting over. All replies retain the original agent/environment attribution.

## Ownership and verification

```text
Claude Desktop pane / draft / command / tool hooks
  → structured local worker
    → @dev-mainsequence/devtools public API
      → existing authenticated MainSequence /mcp
        → agent.list / search / get / get_or_create_session
        → a2a.send_message / get_task / wait_task / cancel_task
```

Shared devtools owns validation, session allocation, messaging, public projections
and bounded platform timeout handling. This repository owns Claude UI, draft and
command handling, per-Claude-session mappings, confirmations and Activity. Host API
functions stay in `hooks/register.mjs` because Claude's effect analysis follows
helpers only within the same module. The view lives in `agentView.mjs`.

See [ADR 0005](adr/0005-user-authored-agent-interactions.md) and the
[verification record](claude-desktop-verification.md) for the distinction between
contract tests, native simulator checks and actual Desktop acceptance.

## Verification and coordinated release

Claude **0.4.4** pins the exact public **@dev-mainsequence/devtools@0.2.5**
archive with its registry URL and integrity. The shared library remains in
mainsequence-devtools; no backend or other adapter changes are required.

For local verification, run `npm ci --ignore-scripts`, then
`npm run release:check`. Set `MS_CLAUDE_DESKTOP_BINARY`, disposable
`CLAUDE_CONFIG_DIR` and `CLAUDE_SECURESTORAGE_CONFIG_DIR` for native checks.

Publication is separate: publish and verify devtools first, refresh/verify the
consumer lock against the public archive, run a clean `npm ci --ignore-scripts` and
release checks, then publish Claude through its existing workflow. Update the public
catalog only after its release archive exists and its checksum is verified. Do not
publish a rebuilt archive under an already released version. Desktop needs no npm
install, source checkout or runtime dependency download.
