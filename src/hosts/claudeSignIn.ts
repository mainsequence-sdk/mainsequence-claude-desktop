import * as dns from 'node:dns/promises';
import * as net from 'node:net';
import type { HostServices } from '@dev-mainsequence/devtools';

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
  if (platform !== 'darwin') return false;
  let timer: NodeJS.Timeout | undefined;
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    const addresses = net.isIP(host) ? [host] : (await Promise.race([lookup(host),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('lookup timed out')), LOOKUP_MS); })])).map(entry => entry.address);
    return addresses.some(localNetworkAddress);
  } catch { return false; }
  finally { clearTimeout(timer); }
}

export type SignInPage = { type: 'browser'; url: string; localNetwork: boolean };

/** Sign-in waits for the browser. Before the page opens, the pane learns its link, to copy into a
 * browser other than the default one, and whether the page is on the local network. */
export function announceSignInPage(host: HostServices, write: (page: SignInPage) => void, progress: (message: string) => void,
  check: (url: string) => Promise<boolean> = url => signInOverLocalNetwork(url)): void {
  const open = host.openBrowser.bind(host);
  host.openBrowser = async url => {
    write({ type: 'browser', url, localNetwork: await check(url) });
    progress('Waiting for you to sign in in your browser…');
    return open(url);
  };
}
