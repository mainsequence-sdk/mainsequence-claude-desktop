# Agent icons in Claude Desktop

The integration uses the same Agent icon projection and assets as Command
Center. The existing MainSequence login and selected Organization Environment
govern access. No message is sent to load an icon.

## Presentation

- Agent rows show a 20 px idle icon; the detail heading shows it at 32 px.
  Both animate an APNG when available, matching the current Command Center app.
- The selected conversation’s native band above the composer shows a 24 px icon, agent name and
  readable activity. It remains available after closing the MainSequence pane. The footer keeps its existing launcher; Desktop compresses that render site into a text slot.
- MainSequence Agent tool rows show the corresponding Agent icon. The running
  row may animate; completed rows use a still.
- Attributed `/ms` command replies emitted in the current loaded session have
  a still icon. Other commands, people and ordinary Claude replies retain their
  original presentation. Identical output from different Agents is left undecorated
  when it cannot be attributed safely. These transient decorations are not a new
  transcript store and are not restored across plugin reloads.
- A missing, loading or failed icon draws nothing. There is no placeholder or
  reserved icon slot. Icon failures never block
  discovery, readiness, drafting, sending or task operations.

Colour assets retain their colours. Pixel-art assets retain sharp pixels. Mask
assets use an alpha mask with a light/dark foreground selected by the SVG
image’s colour-scheme media query. The SVG includes a reduced-motion media query
that selects the exact first frame when the image renderer exposes that preference. The native widget does not inherit the host’s
CSS, so a manually overridden Claude theme is not an independently verified mask
colour signal.

## Activity and tool poses

The selected conversation uses `thinking` while a request or known task is in
progress, `error` for a failed operation/task, and idle otherwise. Approval uses
idle and “Review agent request.” Missing poses fall back to idle. An uncertain
delivery retains its explicit review notice.

The pose resolver follows Command Center’s priority: declared application pose
from `toolPoses` while its tool runs, otherwise `working`, then `error`, then
`thinking`, then idle. The adapter fetches the selected Agent’s declared poses.
However, the current `a2a.send_message` / task polling path supplies no live
internal tool calls, and the platform history projection currently supplies no
in-progress message. Consequently this integration does not claim an application
such as CRM is running, and it adds no polling loop or duplicate message path to
infer one. Live application-specific poses require an activity-capable Agent
transport; the native widgets and pose resolver already accept that presentation.

## Native capability and size limits

Claude Desktop Code 2.1.299 renders the native Svg widget as an image with
embedded PNG data. The interactive frame rendered blank in the live app, so the
integration uses image mode. Signed-in Desktop screenshots confirmed changing
frames in the real Tutorial agent's detail icon and thinking icon above the composer.
Five agents without custom icons showed no placeholder or reserved image slot.

A disposable Chromium image probe confirmed APNG animation. Forcing the browser's
reduced-motion preference kept all six samples on frame zero. Page-only motion
emulation did not propagate into nested SVG images; live operating-system motion
and manually overridden theme preferences have not been independently verified.

The platform permits icons up to 512 KiB and 512 px, and Claude draws icons at 20–32 px.
The engine accepts Svg markup up to 128 KiB, but Desktop does not draw everything it
accepts: in the live app, animated Agent icons of 43–45 KB never appeared while every one
up to 40 KB did. Every icon the pane draws is therefore at most 32 KiB of markup. An
animated icon keeps its frames only within that; a heavier one is drawn as its frame-zero
still, a few KB. A PNG still heavier than that is decoded and shrunk in the worker (to at
most 128 px, smaller when needed; nearest pixel for `pixelated` icons, an alpha-weighted
average otherwise) and re-encoded, so a 512 px Command Center icon of about 105 KB is
embedded as roughly 12 KB. The hook applies the same bound to records an older worker
cached. The backend limit is tracked in
[tdag-django#1136](https://github.com/Main-Sequence-Server-Side/tdag-django/issues/1136).
The adapter first tries the animated widget, then its frame-zero still, then a shrunk
PNG still, and draws no image only when none of these fits (for example an oversized
SVG, which is never rasterized). It never truncates SVG markup or changes the stored
asset. An SVG asset is nested as an image, rather than
inserted as executable frame markup.

## Authentication, caching and lifecycle

The worker checks the expected MainSequence account and the environment projection
before fetching assets. Only the canonical icon and pose routes for selected,
visible Agent UUIDs are accepted. Credentials stay in the public devtools session
service; only bounded embedded image sources cross the private worker channel.
They are excluded from Activity, model tool results and the plugin store.

Idle assets load in batches of at most eight visible Agents. Every batch has its own
worker and they run at the same time; a worker reads the environment's directory once
and its icons four at a time, so a page of Agents gets its icons together instead of
one batch after another. Details/Talk preload up to twelve declared poses for one Agent.
Requests share an in-flight guard and a ten-minute in-memory cache. A failed read (a slow
backend's timeout, an error status) gets a one-minute backoff, after which the shown Agents
ask for it again once; a failed media refresh keeps an existing image. Backend, account,
environment and host-session changes discard presentation state; late old-context
responses cannot repopulate it. There is no background animation timer.

Idle icons are also shared by every Claude session for ten minutes. The worker keeps
them, with their tags, in one file per backend, environment and account under the
MainSequence state folder (`claude-desktop/agent-icons`, owner-only). Within ten minutes
of any session reading an icon, another session's worker answers it from that file
without contacting the backend. An Agent the directory lists without an icon is
remembered the same way; a read that failed is never kept, so the next request tries
again. Poses are not kept there. The file holds image markup and tags only, never
credentials.

An icon changed in Command Center reaches an open pane on its own within ten minutes.
While the pane stays on Agents the hook re-checks the listed Agents' idle icons every
ten minutes, through the shared file. **Refresh** reads the list and every icon from
the backend at once. A re-check sends the backend the entity tag (`ETag`) it holds for
each drawn icon as `If-None-Match`, on the canonical icon route only. An icon the backend
answers with 304, or with 200 and the same tag (the route sends tags but does not yet
answer conditional requests, so the worker compares them itself and drops the bytes
unread), keeps its image and tag; a changed one arrives with its new tag and is redrawn;
a failed re-check keeps the drawn icon. The timer stops when the pane closes or another
section is shown, and a section left open pauses re-checking after four hours until
Refresh. Poses are still read with Details and Talk only. Icons and tags never enter
the plugin store.
