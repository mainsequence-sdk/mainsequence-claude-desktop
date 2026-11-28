import * as os from 'node:os';
import * as path from 'node:path';
import type { HostServices } from '@dev-mainsequence/devtools';

/** Whether macOS lets the browser that opens the sign-in page reach the local network. */
export type LocalNetworkAccess = 'allowed' | 'denied' | 'unknown';
/** `rules`: how many rows System Settings lists under that browser's name, one per path it ran from. */
export type BrowserAccess = { name: string; access: LocalNetworkAccess; rules: number };
/** One app's Local Network choice as macOS keeps it: a path rule in the network extension
 * preferences, where `DenyMulticast` is the switch and `MulticastPreferenceSet` says it was chosen. */
export type NetworkRule = { path: string; signingIdentifier: string; denied: boolean; decided: boolean };

const RULES_FILE = '/Library/Preferences/com.apple.networkextension.plist';
const HANDLERS_FILE = 'Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist';
const READ_MS = 3_000;
const KNOWN: Record<string, string> = { 'com.apple.safari': 'Safari', 'com.google.chrome': 'Google Chrome', 'com.microsoft.edgemac': 'Microsoft Edge',
  'org.mozilla.firefox': 'Firefox', 'com.brave.browser': 'Brave Browser', 'company.thebrowser.browser': 'Arc', 'com.vivaldi.vivaldi': 'Vivaldi' };
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (text: string) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, entity: string) => entity[0] !== '#' ? ENTITIES[entity] ?? all
  : String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))));

/** The XML property list `plutil -convert xml1` writes: dict, array, key, string, numbers, booleans, data and dates. */
export function parsePlistXml(xml: string): unknown {
  const tokens: Array<{ tag?: string; close?: boolean; empty?: boolean; text?: string }> = [];
  for (const match of xml.replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>/g, '').matchAll(/<(\/?)([a-zA-Z]+)\b[^>]*?(\/?)>|([^<]+)/g)) {
    tokens.push(match[2] ? { tag: match[2], close: match[1] === '/', empty: match[3] === '/' } : { text: match[4] });
  }
  let at = 0;
  const skip = () => { while (tokens[at]?.text !== undefined && !tokens[at].text!.trim()) at++; };
  const closes = (tag: string) => { skip(); return tokens[at]?.close === true && tokens[at].tag === tag; };
  const end = (tag: string) => { if (!closes(tag)) throw new Error(`Expected </${tag}>.`); at++; };
  const leaf = (tag: string) => {
    const text = tokens[at]?.text !== undefined ? decode(tokens[at++].text!) : '';
    if (!(tokens[at]?.close && tokens[at].tag === tag)) throw new Error(`Expected </${tag}>.`);
    at++;
    return text;
  };
  const value = (): unknown => {
    skip();
    const token = tokens[at++];
    if (!token?.tag || token.close) throw new Error('Expected a property list value.');
    if (token.empty) return ({ true: true, false: false, array: [], dict: {}, string: '' } as Record<string, unknown>)[token.tag] ?? null;
    if (token.tag === 'plist') { const inner = value(); end('plist'); return inner; }
    if (token.tag === 'array') { const list: unknown[] = []; while (!closes('array')) list.push(value()); at++; return list; }
    if (token.tag === 'dict') {
      const dict: Record<string, unknown> = {};
      while (!closes('dict')) {
        const key = tokens[at++];
        if (key?.tag !== 'key' || key.close) throw new Error('Expected a <key>.');
        const name = key.empty ? '' : leaf('key');
        dict[name] = value();
      }
      at++;
      return dict;
    }
    const text = leaf(token.tag);
    return token.tag === 'integer' || token.tag === 'real' ? Number(text) : text;
  };
  return value();
}

/** The Local Network rules in a keyed archive of the network extension preferences. */
export function localNetworkRules(xml: string): NetworkRule[] {
  const root = parsePlistXml(xml) as Record<string, unknown> | null;
  const objects = Array.isArray(root?.$objects) ? root!.$objects as unknown[] : [];
  const deref = (value: unknown): unknown => value && typeof value === 'object' && typeof (value as Record<string, unknown>)['CF$UID'] === 'number'
    ? objects[(value as Record<string, number>)['CF$UID']] : value;
  const text = (value: unknown) => { const resolved = deref(value); return typeof resolved === 'string' && resolved !== '$null' ? resolved : ''; };
  return objects.flatMap(object => {
    if (!object || typeof object !== 'object' || Array.isArray(object)) return [];
    const fields = object as Record<string, unknown>, kind = deref(fields.$class) as Record<string, unknown> | undefined;
    const signingIdentifier = text(fields.SigningIdentifier);
    if (kind?.$classname !== 'NEPathRule' || !signingIdentifier) return [];
    return [{ path: text(fields.Path), signingIdentifier, denied: deref(fields.DenyMulticast) === true, decided: deref(fields.MulticastPreferenceSet) === true }];
  });
}

/** The app that opens web links, from the Launch Services handlers; Safari when none was chosen. */
export function defaultBrowserId(handlers: unknown): string {
  const list = Array.isArray((handlers as Record<string, unknown> | null)?.LSHandlers) ? (handlers as { LSHandlers: Array<Record<string, unknown>> }).LSHandlers : [];
  for (const scheme of ['https', 'http']) {
    const entry = list.find(handler => handler?.LSHandlerURLScheme === scheme);
    const id = entry?.LSHandlerRoleAll ?? entry?.LSHandlerRoleViewer;
    if (typeof id === 'string' && id) return id.toLowerCase();
  }
  return 'com.apple.safari';
}

const appName = (file: string) => file.match(/\/([^/]+)\.app(?:\.bundle)?\/Contents\/MacOS\/[^/]+$/)?.[1] || '';
const decide = (rules: NetworkRule[]): LocalNetworkAccess => rules.some(rule => rule.decided && rule.denied) ? 'denied'
  : rules.length && rules.every(rule => rule.decided) ? 'allowed' : 'unknown';

/** macOS keeps one rule per executable path, and Chrome also runs from copies of itself
 * (`…code_sign_clone…/Google Chrome.app.bundle`), each with a rule of its own. The running copy's
 * rule decides; a browser that is not running is judged by the rule for its installed path. */
export function browserAccess(bundleId: string, rules: NetworkRule[], running: string[]): BrowserAccess {
  const own = rules.filter(rule => rule.signingIdentifier.toLowerCase() === bundleId.toLowerCase());
  const executables = new Set(own.map(rule => path.basename(rule.path)).filter(Boolean));
  const live = running.filter(file => /\.app(?:\.bundle)?\/Contents\/MacOS\/[^/]+$/.test(file) && executables.has(path.basename(file)));
  const pathless = own.filter(rule => !rule.path);
  const name = [...live, ...own.map(rule => rule.path)].map(appName).find(Boolean) || KNOWN[bundleId.toLowerCase()] || 'Your browser';
  const applying = live.length ? own.filter(rule => live.includes(rule.path)) : own.filter(rule => rule.path && !rule.path.includes('.code_sign_clone/'));
  return { name, access: decide([...applying, ...pathless]), rules: own.length };
}

/** Reads the default browser's Local Network choice on macOS; null elsewhere or when it can't be read. */
export async function readBrowserAccess(host: Pick<HostServices, 'runProcess'>, platform: string = process.platform, home: string = os.homedir()): Promise<BrowserAccess | null> {
  if (platform !== 'darwin') return null;
  const run = (executable: string, args: string[]) => host.runProcess({ executable, args, cwd: home, timeoutMs: READ_MS });
  try {
    const [handlers, rules, processes] = await Promise.all([
      run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(home, HANDLERS_FILE)]),
      run('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', RULES_FILE]),
      run('/bin/ps', ['-axo', 'comm='])]);
    if (rules.exitCode !== 0) return null;
    let choice: unknown = {};
    try { if (handlers.exitCode === 0) choice = JSON.parse(handlers.stdout); } catch { /* Safari, the system default */ }
    const running = processes.exitCode === 0 ? processes.stdout.split('\n').map(line => line.trim()).filter(Boolean) : [];
    return browserAccess(defaultBrowserId(choice), localNetworkRules(rules.stdout), running);
  } catch { return null; }
}
