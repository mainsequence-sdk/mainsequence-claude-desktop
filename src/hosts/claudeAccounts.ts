import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ActionResult, HostServices, ToolingError } from '@dev-mainsequence/devtools';
import { createNodeHost } from '@dev-mainsequence/devtools';

/** Adapted account concepts from ivokund/claude-account-rotator, MIT, pinned 60d5aed. */
export type ClaudeCredentialReference = { kind: 'keychain'; service: string; user: string } | { kind: 'file'; path: string };
/** Private adapter input only. This type must never appear in an action result or UI atom. */
export type ClaudePrivateCredential = { accessToken: string; expiresAt: number; refreshTokenExpiresAt?: number };
export type ClaudeUsageWindow = { percentUsed: number; resetsAt?: string };
export type ClaudeAccountUsage = {
  fiveHour?: ClaudeUsageWindow; week?: ClaudeUsageWindow; checkedAt: number;
  /** Only an explicit null weekly window means the API reports no weekly limit. */
  weekStatus?: 'known' | 'not-applicable' | 'unknown';
};
export type ClaudeAccountDisplay = {
  session: 'bars' | 'pie' | 'braille' | 'none'; week: 'bars' | 'pie' | 'braille' | 'none';
  fill: 'left' | 'used'; active: 'lines' | 'tile' | 'dim'; sessionPercent: boolean; weekPercent: boolean;
};
export type ClaudeAccountsConfig = {
  mode: 'manual' | 'automatic'; fiveHourThreshold: number; weeklyThreshold: number;
  sameOrganizationOnly: boolean; eligibleAccountIds?: string[]; display: ClaudeAccountDisplay;
};
export type ClaudeAccountProfile = {
  id: string; label: string; email?: string; organizationId?: string; organizationName?: string; plan?: string;
  health: 'ready' | 'login-needed' | 'logging-in' | 'unavailable'; healthReason?: string;
  expiresAt?: number; refreshExpiresAt?: number; usage?: ClaudeAccountUsage; removable: boolean; usedBySessions: number;
};
type Profile = Omit<ClaudeAccountProfile, 'removable' | 'usedBySessions'> & {
  slot: string; epoch?: string; duplicateOf?: string; rejectedFingerprint?: string; identityFingerprint?: string;
  login?: { id: string; startedAt: number; cancelled?: boolean };
};
export type ClaudeAccountSession = {
  id: string; activeId: string; heartbeatAt: number; state: 'host-managed' | 'pending' | 'projected-unverified';
  pending?: { accountId: string; generation: string; fromAccountId: string; since: number; fromState?: 'host-managed' | 'projected-unverified' };
  recovery?: { attempts: number; startedAt: number };
};
export type ClaudeAccountProjection = {
  generation: string; accountId: string; slot: string; credential: ClaudeCredentialReference; expiresAt: number;
  /** Applying an environment variable is not evidence of which account answered a request. */
  verification: 'pending';
};
export type ClaudeAccountsView = {
  accounts: ClaudeAccountProfile[]; config: ClaudeAccountsConfig; session?: ClaudeAccountSession; projection?: ClaudeAccountProjection;
  leases: { sessionId: string; accountId: string; heartbeatAt: number; stale: boolean }[];
};
export type ClaudeAccountsRequest = {
  action: 'list' | 'add' | 'login' | 'cancel-login' | 'remove' | 'select' | 'rotate' | 'configure' | 'refresh' | 'check' | 'release' | 'confirm' | 'cancel-switch' | 'recover' | 'release-stale';
  sessionId: string; accountId?: string; label?: string; generation?: string;
  failure?: 'rate_limit' | 'authentication_failed'; leaseSessionId?: string; acknowledgeSessionClosed?: boolean;
  config?: Partial<Omit<ClaudeAccountsConfig, 'display'>> & { display?: Partial<ClaudeAccountDisplay> };
};
type Stored = { version: 1; accounts: Profile[]; sessions: Record<string, ClaudeAccountSession>; config: ClaudeAccountsConfig };
export interface ClaudeAccountsOptions {
  host?: HostServices; signal?: AbortSignal; env?: NodeJS.ProcessEnv; home?: string; directory?: string;
  platform?: NodeJS.Platform; now?: () => number; fetch?: typeof fetch; leaseMs?: number;
  /** Trusted fixtures / private native integration. Returned secrets never cross dispatch. */
  readCredential?(reference: ClaudeCredentialReference): Promise<ClaudePrivateCredential | null>;
  claudeExecutable?: string;
}
const DEFAULT_CONFIG: ClaudeAccountsConfig = {
  mode: 'manual', fiveHourThreshold: 90, weeklyThreshold: 95, sameOrganizationOnly: true,
  display: { session: 'braille', week: 'bars', fill: 'left', active: 'lines', sessionPercent: true, weekPercent: true }
};
const USAGE_TTL = 10 * 60_000;
const MAX_USAGE_AGE = 20 * 60_000;
const LOGIN_TIMEOUT = 5 * 60_000;
const ID = /^(?:default|[a-f0-9-]{36})$/;
const SESSION_ID = /^(?!__proto__$|constructor$|prototype$)[a-zA-Z0-9._:-]{1,160}$/;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function safeText(value: unknown, length = 200): string | undefined {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, length) || undefined : undefined;
}
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ToolingError('INVALID_REQUEST', message);
}
export function claudeCredentialReference(slot: string, home: string, user: string | undefined, platform: NodeJS.Platform): ClaudeCredentialReference {
  if (platform === 'darwin') {
    const suffix = slot ? `-${createHash('sha256').update(slot.normalize('NFC')).digest('hex').slice(0, 8)}` : '';
    return { kind: 'keychain', service: `Claude Code-credentials${suffix}`, user: user && /^[a-zA-Z0-9._-]+$/.test(user) ? user : 'claude-code-user' };
  }
  return { kind: 'file', path: path.join(slot || path.join(home, '.claude'), '.credentials.json').normalize('NFC') };
}
export function parseClaudeCredential(raw: string): ClaudePrivateCredential | null {
  try {
    const value = JSON.parse(raw)?.claudeAiOauth;
    if (!value || typeof value.accessToken !== 'string' || !value.accessToken || !Number.isFinite(value.expiresAt)) return null;
    return { accessToken: value.accessToken, expiresAt: value.expiresAt,
      ...(Number.isFinite(value.refreshTokenExpiresAt) ? { refreshTokenExpiresAt: value.refreshTokenExpiresAt } : {}) };
  } catch { return null; }
}
function usageWindow(value: unknown): ClaudeUsageWindow | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>;
  if (typeof v.utilization !== 'number' || !Number.isFinite(v.utilization)) return;
  return { percentUsed: Math.min(100, Math.max(0, v.utilization)),
    ...(typeof v.resets_at === 'string' && Number.isFinite(Date.parse(v.resets_at)) ? { resetsAt: v.resets_at } : {}) };
}
function percentage(window: ClaudeUsageWindow | undefined, now: number): number | undefined {
  if (!window) return;
  return window.resetsAt && Date.parse(window.resetsAt) <= now ? 0 : window.percentUsed;
}
function spent(account: Pick<ClaudeAccountProfile, 'usage'>, config: ClaudeAccountsConfig, now: number): boolean {
  return (percentage(account.usage?.fiveHour, now) ?? 0) >= config.fiveHourThreshold || (percentage(account.usage?.week, now) ?? 0) >= config.weeklyThreshold;
}
export function pickClaudeAccount(accounts: ClaudeAccountProfile[], activeId: string, config: ClaudeAccountsConfig, now: number): ClaudeAccountProfile | undefined {
  const current = accounts.find(a => a.id === activeId);
  return accounts.filter(a => a.id !== activeId && a.health === 'ready' && (a.expiresAt ?? 0) > now + 60_000
    && a.usage && now - a.usage.checkedAt <= MAX_USAGE_AGE && now >= a.usage.checkedAt
    && a.usage.fiveHour && (a.usage.week || a.usage.weekStatus === 'not-applicable') && !spent(a, config, now)
    && (!config.eligibleAccountIds || config.eligibleAccountIds.includes(a.id))
    && (!config.sameOrganizationOnly || (!!current?.organizationId && a.organizationId === current.organizationId)))
    .sort((a, b) => (percentage(a.usage?.fiveHour, now) ?? 100) - (percentage(b.usage?.fiveHour, now) ?? 100))[0];
}

/** Persistent metadata only; tokens stay in Claude's native secure store. */
export function createClaudeAccountsService(options: ClaudeAccountsOptions = {}) {
  const host = options.host ?? createNodeHost();
  const env = options.env ?? process.env;
  const home = path.resolve(options.home ?? env.HOME ?? os.homedir());
  const directory = path.resolve(options.directory ?? path.join(home, '.config', 'mainsequence', 'claude-accounts'));
  const profilesDir = path.join(directory, 'profiles');
  const file = path.join(directory, 'accounts.json');
  const lock = path.join(directory, '.lock');
  const now = options.now ?? Date.now;
  const platform = options.platform ?? process.platform;
  const fetcher = options.fetch ?? fetch;
  const leaseMs = options.leaseMs ?? 5 * 60_000;
  const baseSlot = env.CLAUDE_SECURESTORAGE_CONFIG_DIR || env.CLAUDE_CONFIG_DIR || '';
  const executable = options.claudeExecutable ?? env.MAINSEQUENCE_CLAUDE_EXECUTABLE ?? 'claude';
  const reference = (account: Profile) => claudeCredentialReference(account.slot, home, env.USER, platform);

  async function ensureDirectory() {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ToolingError('STORE_ERROR', 'Claude account metadata must use a private directory.');
    await fs.chmod(directory, 0o700);
  }
  function initial(): Stored {
    return { version: 1, accounts: [{ id: 'default', label: 'Stored Claude account', slot: baseSlot,
      health: 'login-needed', healthReason: 'Sign-in has not been checked.' }], sessions: {}, config: clone(DEFAULT_CONFIG) };
  }
  async function read(): Promise<Stored> {
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe');
      const value: Stored = JSON.parse(await fs.readFile(file, 'utf8'));
      if (value.version !== 1 || !Array.isArray(value.accounts) || !value.sessions || typeof value.sessions !== 'object' || !value.config) throw new Error('shape');
      for (const account of value.accounts) {
        if (!ID.test(account.id) || typeof account.slot !== 'string'
          || (account.id !== 'default' && account.slot !== path.join(profilesDir, account.id))) throw new Error('profile');
      }
      validateConfig(value.config);
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return initial();
      throw new ToolingError('STORE_ERROR', 'Claude account metadata is invalid. Restore its backup before continuing.');
    }
  }
  async function write(value: Stored) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, { force: true }); }
  }
  async function transaction<T>(work: (data: Stored) => T | Promise<T>): Promise<T> {
    await ensureDirectory();
    const owner = randomUUID();
    const ownerName = `${owner}.json`;
    const claim = path.join(directory, `.claim-${owner}`);
    // Publish a fully initialized, nonempty directory atomically. There is no
    // crash window in which the public lock exists without its owner record.
    await fs.mkdir(claim, { mode: 0o700 });
    await fs.writeFile(path.join(claim, ownerName), JSON.stringify({ pid: process.pid, owner }), { mode: 0o600 });
    const deadline = Date.now() + 10_000;
    let acquired = false;
    try {
      for (;;) {
        try {
          await fs.rename(claim, lock); acquired = true; break;
        } catch (error) {
          if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
          try {
            const names = await fs.readdir(lock);
            if (names.length === 1 && /^(?:[a-f0-9-]{36}|owner)\.json$/.test(names[0])) {
              const entry = JSON.parse(await fs.readFile(path.join(lock, names[0]), 'utf8'));
              if (Number.isSafeInteger(entry.pid) && entry.pid > 0) {
                try { process.kill(entry.pid, 0); }
                catch (failure) {
                  if ((failure as NodeJS.ErrnoException).code === 'ESRCH') {
                    // The unique filename makes recovery safe with several
                    // waiters: only one can unlink this dead owner's record;
                    // a later live owner's differently named record survives.
                    await fs.unlink(path.join(lock, names[0]));
                    await fs.rmdir(lock).catch(() => undefined);
                  }
                }
              }
            }
          } catch { /* a different waiter may have acquired or recovered it */ }
          if (Date.now() >= deadline) throw new ToolingError('PROJECT_BUSY', 'Another process is updating Claude accounts. Try again shortly.');
          if (options.signal?.aborted) throw new ToolingError('CANCELLED', 'Account operation cancelled.');
          await delay(20 + Math.floor(Math.random() * 30));
        }
      }
      const data = await read();
      // A suspended Desktop can remain active with an old heartbeat. Leases are
      // released explicitly; elapsed time alone never authorizes native logout.
      for (const a of data.accounts) if (a.login && now() - a.login.startedAt > LOGIN_TIMEOUT + 30_000) {
        delete a.login; a.epoch = randomUUID(); a.health = 'login-needed'; a.healthReason = 'An interrupted sign-in needs to be checked again.';
      }
      const result = await work(data);
      await write(data);
      return result;
    } finally {
      if (acquired) {
        try { await fs.unlink(path.join(lock, ownerName)); await fs.rmdir(lock).catch(() => undefined); }
        catch { /* another writer must never lose its lock */ }
      }
      await fs.rm(claim, { recursive: true, force: true });
    }
  }
  function session(data: Stored, id: string): ClaudeAccountSession {
    const s = (Object.hasOwn(data.sessions, id) ? data.sessions[id] : undefined) ?? { id, activeId: 'default', state: 'host-managed' as const, heartbeatAt: now() };
    s.heartbeatAt = now(); data.sessions[id] = s; return s;
  }
  function account(data: Stored, id: string | undefined): Profile {
    const found = data.accounts.find(a => a.id === id);
    if (!found) throw new ToolingError('INVALID_REQUEST', 'Select an existing Claude account.');
    return found;
  }
  function view(data: Stored, sessionId: string, projection?: ClaudeAccountProjection): ClaudeAccountsView {
    const accounts = data.accounts.map(a => {
      // Explicit projection is intentional: private/native fields added later
      // must not silently become part of worker stdout or a rendered atom.
      return { id: a.id, label: a.label, email: a.email, organizationId: a.organizationId, organizationName: a.organizationName,
        plan: a.plan, health: a.health, healthReason: a.healthReason, expiresAt: a.expiresAt, refreshExpiresAt: a.refreshExpiresAt,
        usage: a.usage, removable: a.id !== 'default', usedBySessions: Object.values(data.sessions)
        .filter(s => s.activeId === a.id || s.pending?.accountId === a.id).length };
    });
    const leases = Object.values(data.sessions).filter(s => s.state !== 'host-managed').map(s => ({ sessionId: s.id,
      accountId: s.pending?.accountId ?? s.activeId, heartbeatAt: s.heartbeatAt, stale: now() - s.heartbeatAt > leaseMs }));
    return clone({ accounts, config: data.config, session: data.sessions[sessionId], leases, ...(projection ? { projection } : {}) });
  }
  async function credential(profile: Profile): Promise<ClaudePrivateCredential | null> {
    const ref = reference(profile);
    if (options.readCredential) return options.readCredential(ref);
    if (ref.kind === 'file') {
      try { return parseClaudeCredential(await fs.readFile(ref.path, 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new ToolingError('STORE_UNAVAILABLE', 'Claude credentials could not be read.'); }
    }
    const result = await host.runProcess({ executable: '/usr/bin/security', args: ['find-generic-password', '-a', ref.user, '-w', '-s', ref.service], cwd: home, env, timeoutMs: 10_000, signal: options.signal });
    if (result.exitCode === 44) return null;
    if (result.exitCode !== 0) throw new ToolingError('STORE_UNAVAILABLE', 'Claude Keychain credentials could not be read. Unlock the login Keychain and try again.');
    return parseClaudeCredential(result.stdout);
  }
  function childEnv(profile: Profile): NodeJS.ProcessEnv {
    const values: NodeJS.ProcessEnv = { ...env, CLAUDE_SECURESTORAGE_CONFIG_DIR: profile.slot };
    if (profile.slot) values.CLAUDE_CONFIG_DIR = profile.slot;
    else delete values.CLAUDE_CONFIG_DIR;
    for (const name of ['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) delete values[name];
    return values;
  }
  async function identify(profile: Profile): Promise<Partial<Profile>> {
    const result = await host.runProcess({ executable, args: ['auth', 'status', '--json'], cwd: home, env: childEnv(profile), timeoutMs: 20_000, signal: options.signal });
    if (result.exitCode !== 0) return {};
    try {
      const value = JSON.parse(result.stdout);
      if (value.loggedIn !== true) return {};
      return { email: safeText(value.email), organizationId: safeText(value.orgId), organizationName: safeText(value.orgName), plan: safeText(value.subscriptionType) };
    } catch { return {}; }
  }
  async function inspect(profile: Profile, force: boolean): Promise<Partial<Profile>> {
    if (profile.login && now() - profile.login.startedAt < LOGIN_TIMEOUT + 30_000) return {};
    if (profile.duplicateOf) return { health: 'login-needed', healthReason: 'This sign-in duplicates another saved account. Sign in as another account or organization.' };
    let secret: ClaudePrivateCredential | null;
    try { secret = await credential(profile); }
    catch { return { health: 'unavailable', healthReason: 'Native credentials are temporarily unavailable.' }; }
    if (!secret) return { health: 'login-needed', healthReason: 'Sign in to this account.', expiresAt: undefined };
    if (secret.expiresAt <= now() + 60_000 || (secret.refreshTokenExpiresAt !== undefined && secret.refreshTokenExpiresAt <= now())) {
      return { health: 'login-needed', healthReason: 'Sign in again to renew this account before using it in Desktop.', expiresAt: secret.expiresAt };
    }
    const fingerprint = createHash('sha256').update(secret.accessToken).digest('hex');
    if (profile.rejectedFingerprint === fingerprint) return { health: 'login-needed', healthReason: 'Claude rejected this sign-in. Sign in again.' };
    const credentialChanged = profile.identityFingerprint !== fingerprint;
    const patch: Partial<Profile> = { health: 'ready', healthReason: undefined, expiresAt: secret.expiresAt,
      refreshExpiresAt: secret.refreshTokenExpiresAt, rejectedFingerprint: undefined,
      ...(credentialChanged ? { usage: undefined } : {}) };
    if (credentialChanged) {
      const identity = await identify(profile);
      if (!identity.email) return { ...patch, health: 'unavailable', healthReason: 'Claude could not identify this sign-in. Check again before using it.',
        email: undefined, organizationId: undefined, organizationName: undefined, plan: undefined, identityFingerprint: undefined };
      Object.assign(patch, identity, { identityFingerprint: fingerprint });
    }
    if (!force && !credentialChanged && profile.usage && now() - profile.usage.checkedAt < USAGE_TTL) return patch;
    try {
      const controller = new AbortController();
      const abort = () => controller.abort();
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) controller.abort();
      const timer = setTimeout(abort, 15_000);
      let response: Response;
      try { response = await fetcher('https://api.anthropic.com/api/oauth/usage', { headers: { Authorization: `Bearer ${secret.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' }, signal: controller.signal }); }
      finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
      if (options.signal?.aborted) throw new ToolingError('CANCELLED', 'Account operation cancelled.');
      if (response.status === 401 || response.status === 403) return { ...patch, health: 'login-needed', rejectedFingerprint: fingerprint, healthReason: 'Claude rejected this sign-in. Sign in again.' };
      if (!response.ok) return { ...patch, healthReason: 'Usage is temporarily unavailable; automatic rotation needs a fresh reading.' };
      const body = await response.json() as Record<string, unknown>;
      const fiveHour = usageWindow(body.five_hour), week = usageWindow(body.seven_day);
      if (fiveHour || week) patch.usage = { ...(fiveHour ? { fiveHour } : {}), ...(week ? { week } : {}),
        weekStatus: week ? 'known' : Object.hasOwn(body, 'seven_day') && body.seven_day === null ? 'not-applicable' : 'unknown', checkedAt: now() };
    } catch {
      if (options.signal?.aborted) throw new ToolingError('CANCELLED', 'Account operation cancelled.');
      patch.healthReason = 'Usage is temporarily unavailable; automatic rotation needs a fresh reading.';
    }
    return patch;
  }
  async function refresh(sessionId: string, force: boolean) {
    const profiles = await transaction(data => { session(data, sessionId); return clone(data.accounts); });
    for (const profile of profiles) {
      if (options.signal?.aborted) throw new ToolingError('CANCELLED', 'Account operation cancelled.');
      const patch = await inspect(profile, force);
      if (options.signal?.aborted) throw new ToolingError('CANCELLED', 'Account operation cancelled.');
      await transaction(data => {
        const current = data.accounts.find(a => a.id === profile.id);
        if (current && !current.login && current.epoch === profile.epoch) {
          Object.assign(current, patch);
          const duplicate = current.email && data.accounts.find(other => other.id !== current.id && other.email === current.email && (other.organizationId ?? '') === (current.organizationId ?? ''));
          if (duplicate && current.id !== 'default') { current.duplicateOf = duplicate.id; current.health = 'login-needed'; current.healthReason = 'This sign-in duplicates another saved account.'; }
        }
      });
    }
  }
  async function prepare(data: Stored, sessionId: string, targetId: string): Promise<ClaudeAccountProjection> {
    const s = session(data, sessionId), target = account(data, targetId), current = account(data, s.activeId);
    if (s.pending) throw new ToolingError('PROJECT_BUSY', 'Another account switch is pending. Finish or cancel it before switching again.');
    requireValue(!target.login, 'Wait until this account finishes signing in.');
    requireValue(!target.duplicateOf, 'Sign in with a different account before selecting this duplicate profile.');
    requireValue(!data.config.eligibleAccountIds || data.config.eligibleAccountIds.includes(target.id), 'This account is outside the eligible account group.');
    const secret = await credential(target);
    if (!secret || secret.expiresAt <= now() + 60_000 || (secret.refreshTokenExpiresAt !== undefined && secret.refreshTokenExpiresAt <= now())) {
      throw new ToolingError('NOT_AUTHENTICATED', 'Sign in again before selecting this Claude account.');
    }
    const fingerprint = createHash('sha256').update(secret.accessToken).digest('hex');
    if (target.rejectedFingerprint === fingerprint) {
      throw new ToolingError('AUTH_REJECTED', 'Claude rejected this sign-in. Sign in again before selecting it.');
    }
    if (target.identityFingerprint !== fingerprint) {
      const identity = await identify(target);
      if (!identity.email) throw new ToolingError('NOT_AUTHENTICATED', 'Claude could not identify this sign-in. Check it before selecting it.');
      Object.assign(target, identity, { identityFingerprint: fingerprint, usage: undefined });
    }
    if (data.accounts.some(other => other.id !== target.id && other.email === target.email && (other.organizationId ?? '') === (target.organizationId ?? ''))) {
      throw new ToolingError('INVALID_REQUEST', 'This profile duplicates another account. Sign in with a different account or organization.');
    }
    if (data.config.sameOrganizationOnly && target.id !== current.id && current.organizationId && target.organizationId !== current.organizationId) {
      throw new ToolingError('INVALID_REQUEST', 'This account belongs to a different organization. Change the account group policy before switching.');
    }
    if (options.signal?.aborted) throw new ToolingError('CANCELLED', 'Account operation cancelled.');
    const generation = randomUUID();
    s.pending = { accountId: target.id, generation, fromAccountId: s.activeId, since: now(), fromState: s.state === 'projected-unverified' ? 'projected-unverified' : 'host-managed' }; s.state = 'pending';
    return { accountId: target.id, generation, slot: target.slot, credential: reference(target), expiresAt: secret.expiresAt, verification: 'pending' };
  }
  async function login(sessionId: string, accountId: string) {
    const jobId = randomUUID();
    const profile = await transaction(data => {
      session(data, sessionId); const a = account(data, accountId);
      if (Object.values(data.sessions).some(s => s.id !== sessionId && s.state !== 'host-managed' && (s.activeId === accountId || s.pending?.accountId === accountId))) {
        throw new ToolingError('PROJECT_BUSY', 'Another session uses this Claude account. Release or switch that session before signing in again.');
      }
      if (a.login && now() - a.login.startedAt < LOGIN_TIMEOUT + 30_000) throw new ToolingError('PROJECT_BUSY', 'This account is already signing in.');
      const previous = clone(a);
      a.epoch = randomUUID(); a.login = { id: jobId, startedAt: now() }; a.health = 'logging-in'; a.healthReason = undefined;
      delete a.email; delete a.organizationId; delete a.organizationName; delete a.plan; delete a.identityFingerprint;
      return { ...previous, login: a.login, epoch: a.epoch };
    });
    const abort = new AbortController();
    const stop = () => abort.abort();
    options.signal?.addEventListener('abort', stop, { once: true });
    if (options.signal?.aborted) abort.abort();
    let polling = false;
    const timer = setInterval(() => {
      if (polling) return; polling = true;
      void transaction(data => { const job = data.accounts.find(a => a.id === accountId)?.login; return job?.id === jobId && !job.cancelled; })
        .then(owns => { if (!owns) abort.abort(); }).catch(() => abort.abort()).finally(() => { polling = false; });
    }, 250);
    try {
      await fs.mkdir(profile.slot || path.join(home, '.claude'), { recursive: true, mode: 0o700 });
      host.progress?.('Approve the Claude sign-in in your browser.');
      const result = await host.runProcess({ executable, args: ['auth', 'login', '--claudeai', ...(profile.email ? ['--email', profile.email] : [])], cwd: home, env: childEnv(profile), signal: abort.signal, timeoutMs: LOGIN_TIMEOUT });
      if (result.cancelled || abort.signal.aborted) throw new ToolingError('CANCELLED', 'Claude sign-in cancelled.');
      if (result.timedOut) throw new ToolingError('LOGIN_TIMEOUT', 'Claude sign-in timed out. Try again.');
      if (result.exitCode !== 0) throw new ToolingError('PROCESS_FAILED', 'Claude sign-in did not finish. Try again from the account panel.');
      const identity = await identify(profile);
      const patch = await inspect({ ...profile, ...identity, login: undefined, duplicateOf: undefined, rejectedFingerprint: undefined, identityFingerprint: undefined }, true);
      return await transaction(data => {
        const a = account(data, accountId);
        if (a.login?.id !== jobId || a.login.cancelled) throw new ToolingError('CANCELLED', 'Claude sign-in cancelled.');
        const duplicate = data.accounts.find(other => other.id !== a.id && identity.email && other.email === identity.email && (other.organizationId ?? '') === (identity.organizationId ?? ''));
        if (duplicate) {
          Object.assign(a, identity); a.duplicateOf = duplicate.id; a.health = 'login-needed'; a.healthReason = `This is already account ${duplicate.label}. Sign in with another account or organization.`; delete a.login;
        } else { Object.assign(a, identity, patch); delete a.duplicateOf; delete a.login; }
        return view(data, sessionId);
      });
    } finally {
      clearInterval(timer); options.signal?.removeEventListener('abort', stop);
      await transaction(data => {
        const a = data.accounts.find(item => item.id === accountId);
        if (a?.login?.id === jobId) { delete a.login; a.epoch = randomUUID(); a.health = 'login-needed'; a.healthReason = 'Sign-in did not finish. Try again.'; }
      });
    }
  }
  async function remove(sessionId: string, accountId: string) {
    // Reserve using the same login field so other workers cannot sign in/select/remove this slot.
    const reservation = randomUUID();
    const profile = await transaction(data => {
      session(data, sessionId); const a = account(data, accountId);
      requireValue(a.id !== 'default', 'The original Claude account is preserved.');
      if (a.login) throw new ToolingError('PROJECT_BUSY', 'Wait until this account operation finishes.');
      if (Object.values(data.sessions).some(s => s.activeId === a.id || s.pending?.accountId === a.id)) throw new ToolingError('PROJECT_BUSY', 'This account is used by a live session. Switch those sessions before removing it.');
      a.login = { id: reservation, startedAt: now() }; return clone(a);
    });
    try {
      const result = await host.runProcess({ executable, args: ['auth', 'logout'], cwd: home, env: childEnv(profile), signal: options.signal, timeoutMs: 20_000 });
      if (result.cancelled || options.signal?.aborted) throw new ToolingError('CANCELLED', 'Logout was interrupted. This account was kept; check its sign-in before using it.');
      if (result.timedOut) throw new ToolingError('PROCESS_TIMEOUT', 'Logout timed out. This account was kept; check its sign-in before using it.');
      if (result.exitCode !== 0) throw new ToolingError('PROCESS_FAILED', 'Claude could not sign out this account. It was kept in the list.');
      return await transaction(data => {
        const a = account(data, accountId);
        if (a.login?.id !== reservation) throw new ToolingError('PROJECT_BUSY', 'The account changed during removal. Refresh the account list.');
        data.accounts = data.accounts.filter(item => item.id !== accountId);
        if (data.config.eligibleAccountIds) data.config.eligibleAccountIds = data.config.eligibleAccountIds.filter(id => id !== accountId);
        return view(data, sessionId);
      });
    } finally {
      await transaction(data => { const a = data.accounts.find(item => item.id === accountId); if (a?.login?.id === reservation) delete a.login; });
    }
  }
  async function dispatch(request: ClaudeAccountsRequest): Promise<ActionResult> {
    const action = `claude-accounts.${safeText(request?.action, 40) ?? 'invalid'}`;
    try {
      requireValue(request && SESSION_ID.test(request.sessionId), 'A valid Claude session ID is required.');
      requireValue(platform === 'darwin' || platform === 'linux', 'Claude account switching currently supports macOS and Linux.');
      if (options.signal?.aborted) throw new ToolingError('CANCELLED', 'Account operation cancelled.');
      let data: ClaudeAccountsView;
      if (request.action === 'login') {
        requireValue(request.accountId && ID.test(request.accountId), 'Select an existing Claude account.');
        data = await login(request.sessionId, request.accountId);
      } else if (request.action === 'remove') {
        requireValue(request.accountId && ID.test(request.accountId), 'Select an existing Claude account.');
        data = await remove(request.sessionId, request.accountId);
      } else {
        if (request.action === 'refresh' || request.action === 'check' || request.action === 'rotate' || request.action === 'recover') await refresh(request.sessionId, request.action !== 'refresh');
        if (options.signal?.aborted) throw new ToolingError('CANCELLED', 'Account operation cancelled.');
        data = await transaction(async stored => {
          const s = session(stored, request.sessionId);
          let projection: ClaudeAccountProjection | undefined;
          switch (request.action) {
            case 'list': break;
            case 'add': {
              const id = randomUUID();
              stored.accounts.push({ id, slot: path.join(profilesDir, id), label: safeText(request.label, 80) ?? `Account ${stored.accounts.length + 1}`, health: 'login-needed', healthReason: 'Sign in to this account.' });
              break;
            }
            case 'cancel-login': {
              const a = account(stored, request.accountId);
              if (a.health === 'logging-in' && a.login) { a.login.cancelled = true; a.healthReason = 'Cancelling sign-in…'; }
              break;
            }
            case 'select': projection = await prepare(stored, request.sessionId, request.accountId ?? ''); break;
            case 'rotate': {
              const target = pickClaudeAccount(view(stored, request.sessionId).accounts, s.activeId, stored.config, now());
              if (!target) throw new ToolingError('NOT_AUTHENTICATED', 'No eligible account has fresh usage and sufficient capacity.');
              projection = await prepare(stored, request.sessionId, target.id); break;
            }
            case 'refresh': case 'check': {
              const current = account(stored, s.activeId);
              if (stored.config.mode === 'automatic' && s.state === 'projected-unverified' && !s.pending && (current.health === 'login-needed' || spent(current, stored.config, now()))) {
                const target = pickClaudeAccount(view(stored, request.sessionId).accounts, s.activeId, stored.config, now());
                if (target) projection = await prepare(stored, request.sessionId, target.id);
              }
              break;
            }
            case 'confirm': {
              requireValue(s.pending && s.pending.generation === request.generation, 'This account switch is stale. Refresh and select the account again.');
              s.activeId = s.pending.accountId; delete s.pending; s.state = 'projected-unverified'; break;
            }
            case 'cancel-switch': {
              requireValue(s.pending && s.pending.generation === request.generation, 'This account switch is stale.');
              s.state = s.pending.fromState ?? (s.activeId === 'default' ? 'host-managed' : 'projected-unverified'); delete s.pending; break;
            }
            case 'recover': {
              requireValue(request.failure === 'rate_limit' || request.failure === 'authentication_failed', 'A supported Claude failure is required.');
              requireValue(stored.config.mode === 'automatic' && s.state === 'projected-unverified', 'Select a Claude account and enable automatic mode before automatic recovery.');
              if (s.pending) throw new ToolingError('PROJECT_BUSY', 'An account switch is already pending.');
              const current = account(stored, s.activeId);
              if (request.failure === 'authentication_failed') {
                const secret = await credential(current);
                current.health = 'login-needed'; current.healthReason = 'Claude rejected this sign-in. Sign in again.';
                if (secret) current.rejectedFingerprint = createHash('sha256').update(secret.accessToken).digest('hex');
              } else current.usage = { ...current.usage, fiveHour: { ...current.usage?.fiveHour, percentUsed: 100 }, checkedAt: now() };
              const recovery = s.recovery && now() - s.recovery.startedAt < 5 * 60_000 ? s.recovery : { attempts: 0, startedAt: now() };
              if (recovery.attempts >= 2) throw new ToolingError('PROJECT_BUSY', 'Automatic recovery paused after two switches. Review accounts and resume manually.');
              const target = pickClaudeAccount(view(stored, request.sessionId).accounts, s.activeId, stored.config, now());
              if (!target) throw new ToolingError('NOT_AUTHENTICATED', 'No eligible account can recover this request. Review account usage and sign-ins.');
              projection = await prepare(stored, request.sessionId, target.id);
              s.recovery = { ...recovery, attempts: recovery.attempts + 1 };
              break;
            }
            case 'release-stale': {
              requireValue(request.acknowledgeSessionClosed === true && request.leaseSessionId && SESSION_ID.test(request.leaseSessionId), 'Confirm that the selected session is closed before releasing its lease.');
              const stale = stored.sessions[request.leaseSessionId];
              requireValue(stale && stale.id !== request.sessionId && now() - stale.heartbeatAt > leaseMs, 'This lease is active or belongs to the current session.');
              delete stored.sessions[stale.id]; break;
            }
            case 'configure': {
              requireValue(request.config && typeof request.config === 'object', 'Account configuration is required.');
              const incoming = request.config, previous = stored.config;
              const next: ClaudeAccountsConfig = { mode: incoming.mode ?? previous.mode,
                fiveHourThreshold: incoming.fiveHourThreshold ?? previous.fiveHourThreshold,
                weeklyThreshold: incoming.weeklyThreshold ?? previous.weeklyThreshold,
                sameOrganizationOnly: incoming.sameOrganizationOnly ?? previous.sameOrganizationOnly,
                eligibleAccountIds: incoming.eligibleAccountIds ?? previous.eligibleAccountIds,
                display: { session: incoming.display?.session ?? previous.display.session, week: incoming.display?.week ?? previous.display.week,
                  fill: incoming.display?.fill ?? previous.display.fill, active: incoming.display?.active ?? previous.display.active,
                  sessionPercent: incoming.display?.sessionPercent ?? previous.display.sessionPercent, weekPercent: incoming.display?.weekPercent ?? previous.display.weekPercent } };
              validateConfig(next); stored.config = clone(next); break;
            }
            case 'release': delete stored.sessions[request.sessionId]; break;
            default: throw new ToolingError('INVALID_REQUEST', 'Unknown Claude account action.');
          }
          return view(stored, request.sessionId, projection);
        });
      }
      return { schemaVersion: 1, action, status: 'success', summary: data.projection ? 'Account switch prepared. Desktop must apply it; request identity remains unverified.' : 'Claude account state updated.', data };
    } catch (error) {
      const known = error instanceof ToolingError ? error : new ToolingError('INTERNAL_ERROR', 'The Claude account operation could not finish. Refresh the panel and try again.');
      return { schemaVersion: 1, action, status: known.code === 'CANCELLED' ? 'cancelled' : 'failure', summary: known.message, error: { code: known.code, message: known.message } };
    }
  }
  return { dispatch };
}

function validateConfig(value: ClaudeAccountsConfig) {
  requireValue(value.mode === 'manual' || value.mode === 'automatic', 'Rotation mode must be manual or automatic.');
  for (const threshold of [value.fiveHourThreshold, value.weeklyThreshold]) requireValue(Number.isFinite(threshold) && threshold >= 1 && threshold <= 100, 'Usage thresholds must be between 1 and 100.');
  requireValue(typeof value.sameOrganizationOnly === 'boolean', 'Organization policy must be true or false.');
  requireValue(value.eligibleAccountIds === undefined || (Array.isArray(value.eligibleAccountIds) && value.eligibleAccountIds.every(id => typeof id === 'string' && ID.test(id))), 'Eligible accounts must be account IDs.');
  const d = value.display;
  requireValue(d && ['bars', 'pie', 'braille', 'none'].includes(d.session) && ['bars', 'pie', 'braille', 'none'].includes(d.week)
    && ['left', 'used'].includes(d.fill) && ['lines', 'tile', 'dim'].includes(d.active)
    && typeof d.sessionPercent === 'boolean' && typeof d.weekPercent === 'boolean', 'Invalid account display options.');
}
