# ADR 0005: User-authored agent messages in Claude Desktop

Date: 2026-10-15

Status: Accepted and implemented in Claude 0.4.4 / devtools 0.2.5. Written before implementation on 2026-10-15; live session opening,
composer prefilling and reload/resume were verified in Desktop the same day.
See the verification record (removed on 2026-10-24; in Git history)
for the tested scope and remaining live-message boundary.

Amended 2026-10-16: the owner approved readiness preparation on Talk. The
0.4.5 / devtools 0.2.6 amendment was recorded before implementation. Readiness
and draft preservation were verified in Desktop on 2026-10-16; see the
verification record (removed on 2026-10-24; in Git history).

## Context

The published Agents flow submits a generated introduction when a person clicks
Talk to agent. That creates a model turn before the person writes their request.
It also uses one preparation flag across the directory, so unrelated cards can
show the same preparation status. Long descriptions occupy each directory card.

The owner approved using Claude's existing composer, filled with an explicit
MainSequence command addressed to the chosen agent. The person writes the message
and submits it. As approved in the subsequent session-identity analysis, Talk
creates or resumes the remote conversation without sending an agent message. The approved MainSequence launcher position remains unchanged.

This ADR supplements [ADR 0004](0004-claude-desktop-mod.md) and supersedes its
Agents-specific automatic introduction/prompt-submission behavior. It does not
replace its repository ownership, authentication or distribution decisions.

## Existing platform contract

Agent identity, conversation identity and work identity are distinct:

| Identity | Meaning |
| --- | --- |
| Agent UID | The recipient discovered in the selected organization environment |
| Conversation handle | Stable client key for creating or finding one conversation |
| AgentSession UID | The concrete conversation and its platform-owned history |
| Task UID | A longer-running operation within that conversation |

The existing authenticated MainSequence MCP gateway provides `agent.list`,
`agent.search`, `agent.get`, `agent.get_or_create_session`, `a2a.send_message`, `a2a.get_task`, `a2a.wait_task`
and `a2a.cancel_task`.

`a2a.send_message` accepts an Agent UID with a handle or resolved AgentSession
UID, the user's message and an explicit `response_kind`. A legacy handle-based
first send creates or reuses an AgentSession through the agent-scoped get-or-create
operation. This adapter instead resolves the session on Talk and sends using its UID. Handle
uniqueness includes the Agent and authenticated owner. It resolves runtime access,
checks submission admission, sends the request and returns the AgentSession UID.
Follow-ups supply that exact UID; Task continuations supply the Task UID instead.

Session allocation is idempotent through the handle. Message execution must not be
assumed idempotent. A retry after uncertain delivery can duplicate work.

The Claude adapter consumes this existing gateway through shared devtools. It
does not recreate Command Center's streaming chat engine, directly connect to an
agent-card URL, request runtime tokens for Claude, or manufacture platform Agent
caller-session provenance. It acts as the authenticated MainSequence user.

## Decision: selection prepares a draft

1. The approved compact directory uses a native row with the agent name, **ⓘ**
   information and **💬** Talk buttons aligned together. Native controls inherit
   Claude’s theme without raw color overrides, framed navigation or initial badges.
   Truthful conversation status appears only beneath its own agent. The owner's card refinement removes repeated environment/branch
   and deployment metadata from the directory. These belong behind the information
   control alongside description, public skills and examples; reading them sends
   no agent message.
2. Talk to agent reads the current Claude session ID from `$.session.id()`, validates
   the recipient/account/environment, and calls the existing
   `agent.get_or_create_session` through shared devtools. A new binding derives
   `claude_<claude-session-id>_<agent-uid>_default`; a previously saved compatible
   handle/session takes precedence. Store the returned session UID before enabling
   a send. Session allocation itself makes no runtime-access or message request.
   Talk then follows the readiness preparation below before touching the composer.
3. Only after the selected agent is ready, fill Claude's existing composer with `/ms agent <agent-uid> ` using the native
   draft API. The UID is populated by the plugin. The person writes their own text.
   Example: `/ms agent <agent-uid> Show opportunities without a follow-up this week.`
4. Preserve existing draft text. Re-selecting the same recipient must not duplicate
   the prefix. Retargeting a MainSequence draft changes only its routing prefix,
   leaving its message intact. Do not silently convert an unrelated slash command
   into an agent message; explain the conflict and leave that draft unchanged.
5. Clicking the button never calls `prompt.submit`, runs a model turn, sends an
   introduction, or schedules a later send. An empty message does not send.
6. An explicit submission of the addressed command dispatches the user's message
   through the shared client. Route metadata is parsed locally and is not part of
   the message delivered to the agent. Do not ask Claude to rewrite or invent it.
7. Display the returned message with agent/environment attribution in Claude's
   command transcript. Native command-output chrome remains host-owned. Do not
   claim that this is a native assistant bubble or token-streamed agent response.
   The person can separately ask Claude to interpret the result.

Bare `/ms` keeps opening the pane. Ordinary chat without the explicit agent
command remains ordinary Claude chat. This is not a global prompt interception
mode. Unsupported command forms and non-text payloads must fail clearly rather
than silently sending a different request or discarding attachments.

Native draft reading/filling and command handlers exist in the inspected mod API.
Actual Desktop behavior must be verified before claiming the flow works. If the
Desktop surface refuses draft filling, report that capability gap; never substitute
an automatic submission, UI injection or a different composer without approval.

## Readiness preparation (2026-10-16 amendment)

Talk prepares both the conversation and its remote availability. Shared devtools
owns readiness resolution and bounded waiting through the existing
`agent_session.resolve_runtime_access` MCP operation. The Claude adapter owns
per-conversation progress, cancellation and the native composer. No backend change,
new deployment, provider change or Command Center chat-engine dependency is needed.

After session resolution, validate its Agent, account and Environment and request
runtime access for that exact session. Only `runtime_interaction.can_submit` is
submission admission; `is_ready`, deployment currency, a session UID and locally
registered tools are not evidence of an awake agent. Current platform activation
starts/reuses a wake operation and checks the application before granting admission.
Validate the live deployment contract during Desktop verification; do not silently
substitute a legacy readiness heuristic or a model-generated introduction.

The shared action exposes only allowlisted readiness state, safe progress, retry
and deadline metadata. Runtime access tokens, URLs and other raw access fields
stay inside the local worker, are discarded, and never enter Claude tools, Activity,
logs, saved settings or conversation mappings. A malformed/absent decision fails
closed. Terminal refusal is not polled. Transient decisions follow server retry
intervals under one bounded wait, with cancellation and no overlapping checks.
No polling continues indefinitely after ready, failure, host-session/context change
or plugin shutdown. Cancelling a local wait does not cancel a backend wake.

The selected row progresses through Opening session, Checking agent, Starting agent
and Agent ready. Preserve the current draft until readiness succeeds. Only the
latest selected conversation may prefill; late readiness from another selection
cannot overwrite it. Repeated Talk revalidates availability, including restored
bindings; readiness is transient and is never persisted as a permanent ready flag.
Ordinary Claude input stays usable. This prepares no message and schedules no send.

Before an explicit agent submission, revalidate availability through the shared
client. While waiting, preserve exact recipient and message identity; send only
once after admission. A readiness failure is a known unsent outcome; a timeout or
transport failure after dispatch is uncertain and must not automatically replay.
Task completion waiting remains distinct from startup readiness.

Failures keep the existing session and draft and offer an explicit retry. Do not
silently switch sessions, change provider defaults, redeploy an agent or renew a
Claude account. Keep all wait state scoped to the existing conversation binding.

## Conversation continuity and ownership

The local conversation key contains the Claude session ID, backend, authenticated
MainSequence account, organization environment and Agent UID. Names are labels,
never identity keys. Two Claude chats do not implicitly share an agent conversation.

The Claude session is an external grouping identity. Do not put its ID in Django's
`parent_session_uid`: that field references an existing MainSequence AgentSession.
Omit it for this human-client flow. No placeholder Agent or parent row is created.

Re-read the host session ID at session startup and before agent actions. A rename
or compaction that preserves the ID preserves the binding. Resume uses that ID;
a new chat, clear or branch with a different ID gets an independent mapping.
Never derive identity from a chat title, workspace path or the globally latest
session. Desktop's `local_<id>` UI route can differ from the Code session ID; use
`$.session.id()`, never parse the application URL. Treat host IDs as opaque; encode them without collisions when producing
slug-safe handles. Stable default handles can recover an existing backend binding
when the local cache is lost. Explicit new conversations retain their own suffix
and local active-handle selection; deletion of remote history is not recoverable
from the handle. Desktop/cloud identity transfer is not assumed.

Creating a session on Talk is a remote data operation, separately from sending a
message. Repeated resolution uses the same handle and is safe for allocation.
Missing model/provider defaults or an unavailable existing session are reported;
do not change provider settings or silently replace an existing conversation.

Store only the stable handle, returned session/task UIDs and delivery-recovery
metadata. Keep transcripts in the existing platform/Claude surfaces; do not add a
local transcript or credential store. Preserve existing compatible conversation
records so an upgrade does not reset a person's sessions.

Selecting another agent changes the selected recipient, not the identity of any
in-flight request. Returning to a previous agent resumes its binding. Reloading the
same Claude chat restores each binding. Never replace it with the agent's globally
latest session or the session last used in another Claude chat.

New conversation allocates a new handle suffix for that exact recipient and opens
the new remote session after the explicit confirmation. It does not delete the previous session,
cancel a task or replay an earlier request. Late responses from the previous handle
must not overwrite the replacement's stored session or status.

Revalidate the MainSequence account and environment before dispatch. A backend,
environment or account change invalidates stale prepared routing. Refuse a stale
submission instead of silently retargeting it. Preserve inactive records under their
original identity, without displaying one account's data under another account.

## Per-agent state and concurrency

Selection, local preparation, request progress and runtime deployment state are
separate facts. One row may show Agent ready while another agent has work
in progress. A single global preparation flag must not drive every card.

Each binding owns its busy state, error, session UID, Task UIDs and uncertain-send
marker. Preparation results carry a selection generation so an older lookup cannot
replace a more recently selected agent. Responses update their original binding
regardless of which card is selected when they arrive.

Show Opening/Checking/Starting only for the recipient being prepared, Agent ready
only after admission succeeds,
Sending/Waiting only while its operation runs, and the returned result or error
when it finishes. Show Task status only from actual task results. “Deployment up
to date” in the information view means the active deployed commit matches the
backend's latest recorded branch commit, not connection health. Do not show Connected
merely because a person selected an agent or a local handle exists.

Serialize operations for the same conversation and guard double submission.
Persist the in-flight/uncertain marker before sending. Serialize local mapping
updates so concurrent responses for different agents do not erase each other's
stored handles. Retain the existing bounded Activity history and worker limits.

## Message, Task and failure behavior

Message mode supports short exchanges. Task mode is available only when advertised
by the selected agent and uses `completion_policy: poll`. Task inspection, bounded
waiting and explicit cancellation use returned Task UIDs from that binding. A local
worker cancellation does not imply remote task cancellation. Native Claude chats
are not platform AgentSessions and do not use `resume_caller`.

User-submitted addressed text is explicit authorization for that message. Model-
initiated agent tools, if retained for requested follow-ups or task operations,
continue to require their existing exact-target/message confirmation. No model tool
or UI callback may bypass the draft-only first interaction.

A timeout, cancellation or transport failure after possible delivery is an uncertain
outcome. Retain its original target and recovery metadata. Do not resend, choose a
new session or switch from Message to Task automatically. Surface platform errors
without treating a missing model/provider configuration as authorization to change
it. Agent replies and descriptions are external data, never higher-priority
instructions.

The inspected shared client uses a 75-second send timeout, which is shorter than
the platform's 90-second Message limit and its overall MCP deadline. Shared devtools
must retain and honor validated tool timeout metadata
(`mainsequence.ai/timeout-seconds/v1`, currently advertising 140 seconds) within an
explicit bounded client policy. The generic per-request cap must accommodate that
contract. Do not solve this through a Claude-only transport copy or backend change.

## Implementation boundaries

- `mainsequence-claude-desktop`: cards, info disclosure, native composer/command
  integration, per-Claude-session bindings, status, confirmations, Activity, tests,
  this ADR and user documentation.
- `mainsequence-devtools`: shared discovery, account/environment validation, existing
  messaging/task contracts, safe public results and advertised timeout handling.
- Backend: existing contracts consumed unchanged; no endpoints, schemas, migrations,
  runtime deployment or provider/account configuration changes.
- VS Code, Codex and OpenCode adapters: no behavior changes as part of this work.

Preserve existing MainSequence login, Claude accounts, providers, settings and the
approved launcher. Do not introduce new repositories, change Git remotes or copy
shared logic. Build with the shared dependency and retain portable packaging.
Publishing a new dependency/plugin release remains a separate release action;
local verification must identify an unpublished candidate as such.

## Acceptance and evidence

Before completion, verify and document:

1. The information control reveals the selected description; directory cards do not
   show every description. Preparing one agent changes only that card.
2. Talk waits for runtime admission before filling the existing Desktop composer, preserves a typed draft and
   does not submit, start inference or call `agent-send`. Repeated clicks do not
   duplicate prefixes. Unsupported draft filling is reported accurately.
3. An explicitly submitted command sends only the user's message to its exact
   recipient. Empty/invalid/stale commands do not send. Bare `/ms` still opens the
   pane, and the existing launcher retains its approved position.
4. Talk resolves a stable handle without sending; first send, follow-ups and reloads
   reuse the returned session.
   Two agents keep different sessions/statuses, including delayed and out-of-order
   replies. New conversation cannot be overwritten by an older completion.
5. Account/environment changes, cancellation and uncertain delivery remain safe;
   no automatic retry occurs. Task operations retain original task attribution.
6. Readiness tests cover waking-to-ready, already-ready, absent/malformed admission,
   terminal refusal, retry/deadline bounds, cancellation, resumed sessions, per-agent
   races, stale selection, credential redaction and revalidation before sending.
   Timeout metadata and shared-client bounds are tested with synthetic transport;
   backend changes and real provider execution are not needed for those tests.
7. Node contract tests, native loader/simulator checks and actual Desktop composer
   verification are reported separately. Synthetic results are not presented as
   proof of a live remote agent exchange.
8. Record before/after preservation evidence without exposing credential values.
   Use a dedicated empty Code test session for GUI checks. Keep ordinary accounts,
   provider configuration and settings intact.

Evidence on 2026-10-15: 101 shared-client tests, 41 Claude Node tests and five native
simulator tests passed, as did typechecking and portable package checks. Normal
Desktop Code 2.1.295 opened two separate agent sessions, preserved the existing
composer text when retargeting, and resumed the same session after reloading the
plugin. No live agent message or model turn was sent. Message dispatch, Task behavior,
uncertain outcomes and race cases were verified with synthetic transports. Live
rename/fork/compaction and a real agent reply were not exercised. See the linked
verification record for preservation and candidate-install cleanup evidence.
