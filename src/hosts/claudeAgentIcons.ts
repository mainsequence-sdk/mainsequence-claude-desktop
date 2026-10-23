import { ActionResult, HostServices, ToolingError, createSessionService, requireBackend } from '@dev-mainsequence/devtools';
import { claudeFailure } from './claudeProtocol';
import { shrinkPng } from './claudePng';

type Icon = { rendering: 'mask' | 'color'; imageRendering: 'auto' | 'pixelated'; url: string;
  poses: Record<string, string>; toolPoses: Record<string, string> };
export type AgentIconImage = { source: string; stillSource: string; animated: boolean };
export type ClaudeAgentIconsRequest = { action: 'agent-icons'; backend: string; environmentUid: string;
  expectedAccount: string; agentUids: string[]; includePoses?: boolean;
  /** The ETag of the idle icon the hook already holds, per requested agent: an unchanged icon is reported, not resent. */
  known?: Record<string, string> };

/** A backend entity tag as the icon route sends it (`"…"` or `W/"…"`); anything else is no tag. */
export function entityTag(value: unknown): string | null {
  return typeof value === 'string' && /^(?:W\/)?"[\x21\x23-\x7e]{1,200}"$/.test(value) ? value : null;
}
/** Weak comparison (RFC 9110 §8.8.3.2): the same opaque tag names the same icon bytes, strong or weak. */
export const sameEntity = (a: string | null, b: string | null): boolean => !!a && !!b && a.replace(/^W\//, '') === b.replace(/^W\//, '');
const headerRecord = (headers: HeadersInit | undefined): Record<string, string> => {
  const record: Record<string, string> = {};
  if (headers instanceof Headers) headers.forEach((value, name) => { record[name] = value; });
  else if (Array.isArray(headers)) for (const [name, value] of headers) record[name] = value;
  else Object.assign(record, headers ?? {});
  return record;
};

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) {
    throw new ToolingError('INVALID_REQUEST', 'Choose agents from the current environment.');
  }
  return value.toLowerCase();
}

/** The platform guarantees the default PNG image is APNG frame zero. */
export function agentIconStill(bytes: Buffer): Buffer {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return bytes;
  const parts = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const end = offset + 12 + bytes.readUInt32BE(offset);
    if (end > bytes.length) throw new ToolingError('API_ERROR', 'The agent icon is incomplete.');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!['acTL', 'fcTL', 'fdAT'].includes(type)) parts.push(bytes.subarray(offset, end));
    offset = end;
    if (type === 'IEND') {
      if (offset !== bytes.length) throw new ToolingError('API_ERROR', 'The agent icon is invalid.');
      return Buffer.concat(parts);
    }
  }
  throw new ToolingError('API_ERROR', 'The agent icon is incomplete.');
}

/** Native Svg is an isolated desktop image/frame, limited to 128 KiB of markup. */
export function nativeAgentIcon(bytes: Buffer, mime: string, icon: Pick<Icon, 'rendering' | 'imageRendering'>): AgentIconImage | null {
  const still = agentIconStill(bytes);
  const animated = !still.equals(bytes) && icon.rendering === 'color';
  const uri = (data: Buffer) => `data:${mime};base64,${data.toString('base64')}`;
  const image = (data: Buffer, className = '') => `<image class="${className}" width="32" height="32" href="${uri(data)}"/>`;
  const wrap = (body: string, styles = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}svg{display:block;width:100%;height:100%}${styles}</style>${body}</svg>`;
  // SVG bytes remain an image, never executable markup in the native frame.
  const paint = (data: Buffer) => icon.rendering === 'mask'
    ? wrap(`<defs><mask id="icon" style="mask-type:alpha">${image(data)}</mask></defs><rect width="32" height="32" fill="currentColor" mask="url(#icon)"/>`,
      ':root{color:#202020}@media(prefers-color-scheme:dark){:root{color:#eeeeee}}')
    : wrap(image(data), icon.imageRendering === 'pixelated' ? 'image{image-rendering:pixelated}' : '');
  const stillSource = paint(still);
  const oversized = stillSource.length > 131072;
  // Claude draws icons at 20-32 px; a large PNG (Command Center allows 512 KiB and 512 px) is
  // shrunk to at most 128 px instead of being dropped, and a heavy static one is shrunk anyway
  // because its markup crosses into Claude on every redraw. Animated icons keep their frames
  // while they fit; shrinking would cost the animation.
  if (mime === 'image/png' && (oversized || (!animated && still.length > 32768))) {
    for (const size of [128, 96, 64, 48]) {
      const small = shrinkPng(still, size, icon.imageRendering === 'pixelated');
      if (!small) break;
      const fitted = paint(small);
      if (fitted.length <= 131072) return { source: fitted, stillSource: fitted, animated: false };
    }
  }
  if (oversized) return null;
  const source = animated ? wrap(image(bytes, 'moving') + image(still, 'still'),
    `${icon.imageRendering === 'pixelated' ? 'image{image-rendering:pixelated}' : ''}.still{display:none}@media(prefers-reduced-motion:reduce){.moving{display:none}.still{display:inline}}`) : stillSource;
  return { source: source.length <= 131072 ? source : stillSource, stillSource,
    animated: animated && source.length <= 131072 };
}

/** A desktop media bridge over the public session service; credentials never leave it. */
export function createClaudeAgentIcons(options: { host: HostServices; signal?: AbortSignal;
  env?: NodeJS.ProcessEnv; fetch?: typeof fetch }) {
  const transport = options.fetch ?? fetch;
  // Revalidation: the hook's known ETag travels only to the canonical icon route it was read from,
  // as If-None-Match. A 304, or a 200 that carries the same tag again (the route sends ETags but
  // does not yet answer conditional requests), comes back as an "unchanged" record without bytes.
  const conditional = new Map<string, string>();
  const session = createSessionService(options.host, { env: options.env, signal: options.signal,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const media = /^\/api\/v1\/command-center\/agents\/[a-f0-9-]{36}\/icon\/(?:[a-zA-Z0-9_-]+\/)?$/.test(url.pathname);
      const known = media ? conditional.get(url.pathname) : undefined;
      const response = await transport(input, known ? { ...init, headers: { ...headerRecord(init?.headers), 'If-None-Match': known } } : init);
      if (!media) return response;
      if (known && (response.status === 304 || response.ok && sameEntity(entityTag(response.headers.get('etag')), known))) {
        await response.body?.cancel();
        return new Response(JSON.stringify({ unchanged: true, etag: known }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (!response.ok) return response;
      const mime = response.headers.get('content-type')?.split(';')[0].trim();
      if (mime !== 'image/png' && mime !== 'image/svg+xml' && mime !== 'image/webp') {
        await response.body?.cancel(); throw new ToolingError('API_ERROR', 'The agent icon format is unsupported.');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new ToolingError('API_ERROR', 'The agent icon is unavailable.');
      const parts: Buffer[] = [];
      let size = 0;
      try {
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          size += item.value.length;
          if (size > 524288) throw new ToolingError('API_ERROR', 'The agent icon exceeds the platform limit.');
          parts.push(Buffer.from(item.value));
        }
      } finally { await reader.cancel().catch(() => {}); }
      // SessionService owns JWT selection/renewal. Its public request method reads JSON;
      // adapt only canonical icon responses to JSON inside that authenticated transport.
      return new Response(JSON.stringify({ bytes: Buffer.concat(parts).toString('base64'), mime, etag: entityTag(response.headers.get('etag')) }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    } });

  async function dispatch(input: ClaudeAgentIconsRequest): Promise<ActionResult> {
    try {
      const backend = requireBackend(input.backend), environmentUid = uuid(input.environmentUid);
      if (!input.expectedAccount || !Array.isArray(input.agentUids) || !input.agentUids.length || input.agentUids.length > 4
        || input.includePoses !== undefined && typeof input.includePoses !== 'boolean'
        || input.includePoses && input.agentUids.length !== 1) throw new ToolingError('INVALID_REQUEST', 'Choose up to four visible agents.');
      const requested = new Set(input.agentUids.map(uuid));
      const known: Record<string, string> = Object.create(null);
      if (input.known !== undefined) {
        const invalid = new ToolingError('INVALID_REQUEST', 'known maps requested agents to the ETag of their idle icon.');
        if (!input.known || typeof input.known !== 'object' || Array.isArray(input.known) || input.includePoses) throw invalid;
        for (const [agentUid, tag] of Object.entries(input.known)) {
          if (!requested.has(uuid(agentUid)) || !entityTag(tag)) throw invalid;
          known[uuid(agentUid)] = tag as string;
        }
      }
      // Sign-in saved the account with the session; icon batches must not ask the backend for it again.
      let identity = await session.status(backend);
      if (identity.authenticated && !identity.username) identity = await session.status(backend, true);
      if (!identity.authenticated || identity.username !== input.expectedAccount) throw new ToolingError('AUTH_REJECTED', 'Refresh agents after changing account.');
      const projection = await session.request<unknown>(backend, 'GET', `/api/v1/command-center/agents/?organization_environment_uid=${environmentUid}`);
      if (!Array.isArray(projection)) throw new ToolingError('API_ERROR', 'The agent icon directory is unavailable.');
      const icons: Record<string, unknown> = Object.create(null);
      for (const row of projection) {
        if (!row || typeof row !== 'object' || !requested.has(String(row.agentUid).toLowerCase())) continue;
        const agentUid = uuid(row.agentUid), raw = row.commandCenterIcon;
        if (!raw || !['mask', 'color'].includes(raw.rendering)) continue;
        const base = `/api/v1/command-center/agents/${agentUid}/icon/`;
        const canonical = (value: unknown, expected: string) => {
          if (typeof value !== 'string') return false;
          try { return new URL(value, backend).href === new URL(expected, backend).href; } catch { return false; }
        };
        if (!canonical(raw.url, base)) continue;
        const poses: Record<string, string> = Object.create(null);
        for (const [pose, url] of Object.entries(raw.poses ?? {}).slice(0, 12)) {
          if (pose !== 'idle' && /^[a-zA-Z0-9_-]{1,64}$/.test(pose) && canonical(url, `${base}${pose}/`)) poses[pose] = `${base}${pose}/`;
        }
        const toolPoses: Record<string, string> = Object.create(null);
        for (const [application, pose] of Object.entries(raw.toolPoses ?? {}).slice(0, 100)) {
          if (/^[a-zA-Z0-9_-]{1,100}$/.test(application) && typeof pose === 'string' && Object.hasOwn(poses, pose)) toolPoses[application] = pose;
        }
        const icon: Icon = { rendering: raw.rendering, imageRendering: raw.rendering === 'color' && raw.imageRendering === 'pixelated' ? 'pixelated' : 'auto',
          url: base, poses, toolPoses };
        const load = async (url: string): Promise<{ image: AgentIconImage | null; etag: string | null } | 'unchanged'> => {
          try {
            const data = await session.request<{ bytes?: string; mime?: string; etag?: unknown; unchanged?: boolean }>(backend, 'GET', url);
            if (data.unchanged === true) return 'unchanged';
            return { image: nativeAgentIcon(Buffer.from(String(data.bytes ?? ''), 'base64'), String(data.mime ?? ''), icon), etag: entityTag(data.etag) };
          } catch (error) {
            if (options.signal?.aborted || error instanceof ToolingError && ['AUTH_REJECTED', 'NOT_AUTHENTICATED'].includes(error.code)) throw error;
            return { image: null, etag: null };
          }
        };
        const images: Record<string, AgentIconImage | null> = Object.create(null);
        conditional.clear();
        if (known[agentUid]) conditional.set(base, known[agentUid]);
        const idle = await load(base);
        conditional.clear();
        if (idle === 'unchanged') {
          icons[agentUid] = { rendering: icon.rendering, imageRendering: icon.imageRendering, toolPoses, images, etag: known[agentUid], unchanged: true, posesLoaded: false };
          continue;
        }
        images.idle = idle.image;
        let total = JSON.stringify(images).length;
        if (input.includePoses) for (const [pose, url] of Object.entries(poses)) {
          const loaded = await load(url), image = loaded === 'unchanged' ? null : loaded.image, length = JSON.stringify(image).length;
          if (total + length > 2500000) break;
          total += length; images[pose] = image;
        }
        icons[agentUid] = { rendering: icon.rendering, imageRendering: icon.imageRendering, toolPoses, images,
          // The tag names the idle bytes delivered here; a dropped idle has none to revalidate.
          etag: idle.image ? idle.etag : null, posesLoaded: input.includePoses === true };
      }
      return { schemaVersion: 1, action: input.action, status: 'success', summary: 'Agent icons loaded.',
        data: { environmentUid, account: identity.username, icons } };
    } catch (error) { return claudeFailure(input.action, error, options.signal?.aborted); }
  }
  return { dispatch };
}
