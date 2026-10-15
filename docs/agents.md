# Agents in Claude Desktop Code

This addition provides an **Agents** section alongside General, Projects, Current
Project, MCP and Activity. Existing functionality stays available. It uses the
existing MainSequence login and platform agent gateway. It changes no backend
routes, data model, Claude accounts or provider configuration.

## Discover and talk

Choose an organization environment in MCP or Agents. Both sections share the same
selection. Only agents from that environment appear. Search uses the platform's
semantic search; the ordinary directory supports pagination. Cards show the agent's
name, description, environment, branch and runtime update state. “Runtime current”
is version metadata, not a health probe. Details show the public agent-card skills
and examples. Missing capabilities remain explicitly unknown.

**Talk to agent** checks the selected agent and MainSequence account, registers
conversation-specific Claude tools and submits a normal, visibly attributed plugin
prompt to Claude. If Claude is working, the host queues that prompt. The introduction
asks the agent about its purpose, capabilities, inputs and examples, without asking
it to perform analysis or change state. The actual reply reaches Claude as a tool
result. Claude can summarize it and ask follow-up questions. No canned answer or
second model endpoint is used.

The click authorizes the fixed introduction. Subsequent sends display the exact
message and environment for approval. **Continue in Claude** offers a composer
suggestion without replacing the user's draft. An agent must advertise Message
support and have a deployed runtime to start this flow. Task-only agents can be
inspected but cannot use this introduction flow.

When an agent also advertises Task support, Claude can request longer work using
Task mode. The plugin exposes status, bounded wait and cancellation tools for tasks
returned by that conversation. Tasks use the platform's polling policy; there is
no background polling loop or promise that a finished task will proactively wake
Claude. A cancellation request is shown as requested until the platform confirms
its final status. Cancelling a local worker in Activity does not cancel a remote
task; use the agent task cancellation tool for that.

## Identity, continuity and errors

The target is fixed to backend, environment, MainSequence account and agent UID.
Each operation revalidates the account and agent environment in shared devtools.
Tool calls cannot supply a replacement target. Switching environment/backend,
signing out, or selecting another agent disables old tools immediately. Claude's
API cannot unregister their names; any later calls receive an inactive-conversation
error. An already-sent request may still complete, with its original attribution.

For each Claude session, the plugin store keeps only conversation handles, returned
agent-session/task IDs and an uncertain-send marker, partitioned by the target
identity. It stores no agent transcript or credentials there. Activity and Claude's
chat may contain actual replies. A reload of the same Claude session resumes the
stored agent session; a new Claude session has a separate mapping.

Before a send, the plugin persists an in-flight marker. A crash, timeout or ambiguous
response blocks automatic replay, including after reopening the session. Review
Activity and any known task before starting again. **Details → Start new
conversation** explicitly creates a new handle; it does not cancel previous remote
work. Late responses from an older conversation cannot overwrite its replacement.

Agent cards and replies are external data, not instructions overriding this user's
conversation. Credentials remain in the shared MainSequence session service.
The plugin never reads Claude tokens, changes model authentication, sends credentials
to agent-card URLs, or writes backend configuration.

## Implementation ownership

```text
Claude Desktop native pane / prompt / tool-call hooks
  → structured local worker
    → @dev-mainsequence/devtools public API
      → existing authenticated MainSequence /mcp
        → agent.list / agent.search / agent.get
        → a2a.send_message / get_task / wait_task / cancel_task
```

`mainsequence-devtools` owns discovery, public result projection, environment/account
checks, messaging and task contracts. This repository owns native UI, local
conversation mappings, Claude prompt submission, tool confirmations and Activity.
Claude's loader follows host API effects only through functions in the same module,
so those functions live in `hooks/register.mjs`; the pure view is `agentView.mjs`.
VS Code and other adapters are unchanged.

## Verification and coordinated release

The implementation branch prepares Claude **0.4.2** with shared devtools **0.2.4**.
These are unpublished candidates. The checked-in public marketplace stays on 0.4.1.
Publish and verify devtools first, then verify `npm ci` against its public registry
integrity, and only then publish the Claude archive through the existing release
workflow. No new repository, marketplace or runtime dependency download is needed.

For local verification before producer publication:

1. In the shared devtools implementation checkout, run `npm run release:check`.
2. In this checkout run `npm install --ignore-scripts --no-save --package-lock=false /absolute/path/to/dev-mainsequence-devtools-0.2.4.tgz`.
3. Run `npm run release:check`. It bundles the installed package into the portable ZIP.
4. Set `MS_CLAUDE_DESKTOP_BINARY` and disposable `CLAUDE_CONFIG_DIR` and
   `CLAUDE_SECURESTORAGE_CONFIG_DIR` to run `npm run verify:claude` without touching
   normal Desktop settings.

The local tarball must match the consumer lockfile integrity; do not regenerate it
from different producer contents and present it as the verified archive. Local
build/verification does not publish, install or update the normal Desktop plugin.
See [verification evidence](claude-desktop-verification.md) for the distinction
between automated contracts, native simulator checks and live agent acceptance.
