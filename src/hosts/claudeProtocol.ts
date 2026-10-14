import { ActionRequest, ActionResult, ToolingError } from '@dev-mainsequence/devtools';

export type ClaudeScope = 'devtools' | 'projects' | 'accounts';
export type ClaudeEnvelope = {
  protocolVersion: 1;
  id: string;
  request: { scope: ClaudeScope; request: { action: string; [key: string]: unknown } };
};
export type ClaudeMessage = { type: 'progress'; id: string; message: string }
  | { type: 'result'; id: string; result: ActionResult };
export const CLAUDE_INPUT_LIMIT = 1_000_000;

/** No shell parser, model prompt, credentials, or environment overrides cross this boundary. */
export function parseClaudeEnvelope(input: unknown): ClaudeEnvelope {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ToolingError('INVALID_REQUEST', 'Invalid Desktop action envelope.');
  const e = input as Record<string, any>;
  if (e.protocolVersion !== 1 || typeof e.id !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(e.id)
    || Object.keys(e).some(key => !['protocolVersion', 'id', 'request'].includes(key))) {
    throw new ToolingError('INVALID_REQUEST', 'Unsupported Desktop action protocol or request ID.');
  }
  const r = e.request;
  if (!r || typeof r !== 'object' || Array.isArray(r) || !['devtools', 'projects', 'accounts'].includes(r.scope)
    || Object.keys(r).some(key => !['scope', 'request'].includes(key)) || !r.request || typeof r.request !== 'object'
    || Array.isArray(r.request) || typeof r.request.action !== 'string'
    || !/^[a-z][a-z0-9-]{0,63}$/.test(r.request.action)) {
    throw new ToolingError('INVALID_REQUEST', 'Choose a supported MainSequence, project, or account action.');
  }
  return e as ClaudeEnvelope;
}

export function claudeFailure(action: string, error: unknown, cancelled = false): ActionResult {
  const failure = cancelled ? new ToolingError('CANCELLED', 'The action was cancelled.')
    : error instanceof ToolingError ? error : new ToolingError('INTERNAL_ERROR', 'The Desktop action could not complete. Check Activity and runtime diagnostics.');
  return { schemaVersion: 1, action, status: failure.code === 'CANCELLED' ? 'cancelled' : 'failure',
    summary: failure.message, error: { code: failure.code, message: failure.message } };
}

export async function executeClaudeEnvelope(input: unknown, handlers: {
  devtools(request: ActionRequest): Promise<ActionResult>;
  projects(request: any): Promise<ActionResult>;
  accounts(request: any): Promise<ActionResult>;
}): Promise<ActionResult> {
  let action = 'invalid';
  try {
    const envelope = parseClaudeEnvelope(input);
    action = envelope.request.request.action;
    return await handlers[envelope.request.scope](envelope.request.request as any);
  } catch (error) { return claudeFailure(action, error); }
}
