import * as dns from 'node:dns/promises';
import * as net from 'node:net';
import type { HostServices } from '@dev-mainsequence/devtools';
import { readBrowserAccess, type BrowserAccess } from './localNetworkAccess';

type Lookup = (host: string) => Promise<Array<{ address: string }>>;
const LOOKUP_MS = 2_000;

/** An address macOS counts as the local network: the private IPv4 ranges, link-local, and IPv6
 * unique-local and link-local. Loopback is not: a browser reaches 127.0.0.1 without permission. */
export function localNetworkAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (!net.isIPv6(ip)) return false;
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return localNetworkAddress(mapped[1]);
  return /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip);
}

/** Whether the sign-in page is on the local network, where macOS lets a browser connect only once
 * it is allowed under Privacy & Security → Local Network. A denied browser fails with
 * ERR_ADDRESS_UNREACHABLE while every terminal tool still reaches the same address. */
export async function signInOverLocalNetwork(url: string, platform: string = process.platform,
  lookup: Lookup = host => dns.lookup(host, { all: true })): Promise<boolean> {
  return !!await signInLocalAddress(url, platform, lookup);
}

/** The local-network address the sign-in page's host resolves to on macOS, such as `192.168.50.7`;
 * empty when the page is elsewhere or the lookup fails. */
export async function signInLocalAddress(url: string, platform: string = process.platform,
  lookup: Lookup = host => dns.lookup(host, { all: true })): Promise<string> {
  if (platform !== 'darwin') return '';
  let timer: NodeJS.Timeout | undefined;
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    const addresses = net.isIP(host) ? [host] : (await Promise.race([lookup(host),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('lookup timed out')), LOOKUP_MS); })])).map(entry => entry.address);
    return addresses.find(localNetworkAddress) || '';
  } catch { return ''; }
  finally { clearTimeout(timer); }
}

/** What the pane says about the sign-in page: whether it is on the local network, the address,
 * and whether the browser that opens it is allowed there. */
export type SignInFindings = { localNetwork: boolean; address?: string; browser?: BrowserAccess };
export type SignInPage = { type: 'browser'; url: string } & SignInFindings;

export async function checkSignInPage(url: string, host: Pick<HostServices, 'runProcess'>): Promise<SignInFindings> {
  const address = await signInLocalAddress(url);
  if (!address) return { localNetwork: false };
  const browser = await readBrowserAccess(host);
  return { localNetwork: true, address, ...(browser ? { browser } : {}) };
}

/** Sign-in waits for the browser. Before the page opens, the pane learns its link, to copy into a
 * browser other than the default one, and whether the page is on the local network. */
export function announceSignInPage(host: HostServices, write: (page: SignInPage) => void, progress: (message: string) => void,
  check: (url: string) => Promise<boolean | SignInFindings> = url => checkSignInPage(url, host)): void {
  const open = host.openBrowser.bind(host);
  host.openBrowser = async url => {
    const found = await check(url);
    write({ type: 'browser', url, ...(typeof found === 'boolean' ? { localNetwork: found } : found) });
    progress('Waiting for you to sign in in your browser…');
    return open(url);
  };
}
