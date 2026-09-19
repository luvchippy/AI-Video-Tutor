/**
 * Outbound-request address guard, shared by every module that fetches a URL it
 * did not build from a constant:
 *
 *   - the search providers, whose endpoint guard backs the test seam
 *     (`endpointOverride`) and a defence-in-depth check before each request;
 *   - the platform subtitle sources, which fetch a caption URL taken out of the
 *     page's own JSON payload — remote data, so it is checked before use.
 *
 * Pure: no fetch, no DOM, no Node APIs.
 */

/**
 * Host suffixes that resolve to the local machine or the local network even
 * though they are not IP literals.
 */
const BLOCKED_HOST_SUFFIXES = ['.local', '.localhost', '.internal', '.home.arpa'];

/**
 * Private, loopback, link-local, multicast, reserved and documentation IPv4
 * space. Takes the first three octets: the URL parser has already canonicalized
 * the host to dotted-quad form, so `127.1`, `2130706433`, `0x7f000001` and
 * `192.168.001.001` all arrive here as their canonical form.
 */
function isBlockedIpv4(a: number, b: number, c: number): boolean {
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0.0/24, 192.0.2.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 doc
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 doc
  if (a >= 224) return true; // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved, broadcast
  return false;
}

/** Canonicalize a dotted-quad host, or null when it is not one. */
function parseDottedQuad(
  host: string,
): [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return [octets[0]!, octets[1]!, octets[2]!, octets[3]!];
}

/** One IPv6 group (16 bits), or the trailing embedded IPv4 when allowed. */
function ipv6GroupToBytes(group: string, allowIpv4: boolean): number[] | null {
  if (group.includes('.')) {
    if (!allowIpv4) return null;
    const quad = parseDottedQuad(group);
    return quad === null ? null : [quad[0], quad[1], quad[2], quad[3]];
  }
  if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
  const value = Number.parseInt(group, 16);
  return [value >> 8, value & 0xff];
}

/** Expand an IPv6 literal (brackets and zone id stripped) to its 16 bytes. */
function parseIpv6Bytes(rawHost: string): number[] | null {
  const zoneAt = rawHost.indexOf('%');
  const text = (
    zoneAt === -1 ? rawHost : rawHost.slice(0, zoneAt)
  ).toLowerCase();
  const gapAt = text.indexOf('::');
  if (gapAt !== -1 && text.indexOf('::', gapAt + 2) !== -1) return null;

  const headText = gapAt === -1 ? text : text.slice(0, gapAt);
  const tailText = gapAt === -1 ? '' : text.slice(gapAt + 2);
  const head = headText === '' ? [] : headText.split(':');
  const tail = tailText === '' ? [] : tailText.split(':');
  const lastIndex = head.length + tail.length - 1;

  const toBytes = (groups: string[], offset: number): number[] | null => {
    const bytes: number[] = [];
    for (let i = 0; i < groups.length; i += 1) {
      const groupBytes = ipv6GroupToBytes(groups[i]!, offset + i === lastIndex);
      if (groupBytes === null) return null;
      bytes.push(...groupBytes);
    }
    return bytes;
  };

  const headBytes = toBytes(head, 0);
  const tailBytes = toBytes(tail, head.length);
  if (headBytes === null || tailBytes === null) return null;

  if (gapAt === -1) {
    // No "::" shorthand: all eight groups must be present.
    return head.length === 8 ? headBytes : null;
  }
  // The shorthand must stand for at least one group.
  const missing = 16 - headBytes.length - tailBytes.length;
  if (missing < 1) return null;
  return [
    ...headBytes,
    ...new Array<number>(missing).fill(0),
    ...tailBytes,
  ];
}

/** Loopback, unspecified, ULA, link-local, multicast and other reserved v6 space. */
function isBlockedIpv6(bytes: number[]): boolean {
  if (bytes.length !== 16) return true;
  const [b0 = 0, b1 = 0, b2 = 0, b3 = 0] = bytes;
  // ::/120 — unspecified, loopback and the deprecated IPv4-compatible range.
  if (bytes.slice(0, 15).every((b) => b === 0)) return true;
  if ((b0 & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (b0 === 0xfe && (b1 & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (b0 === 0xff) return true; // ff00::/8 multicast
  if (b0 === 0x20 && b1 === 0x01 && b2 === 0x0d && b3 === 0xb8) return true; // 2001:db8::/32 doc
  if (b0 === 0x20 && b1 === 0x02) return true; // 2002::/16 6to4, embeds an arbitrary IPv4
  // Tunnels carrying an embedded IPv4 target: IPv4-mapped (::ffff:a.b.c.d) and
  // NAT64 (64:ff9b::/96). Re-check the embedded address against the v4 rules.
  const isMapped =
    bytes.slice(0, 10).every((b) => b === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;
  const isNat64 = b0 === 0x00 && b1 === 0x64 && b2 === 0xff && b3 === 0x9b;
  if (isMapped || isNat64) {
    return isBlockedIpv4(bytes[12]!, bytes[13]!, bytes[14]!);
  }
  return false;
}

/**
 * True only for an absolute http/https URL pointing at public space. Rejects
 * missing/unsupported schemes, embedded credentials, loopback, localhost,
 * private ranges, link-local (incl. cloud metadata), multicast and reserved
 * addresses, and their obfuscated forms (`127.1`, `2130706433`, `0x7f000001`,
 * `localhost.`, `[::1]`, …). The URL parser canonicalizes those before we
 * inspect the host, and anything it cannot parse is refused.
 */
export function isSafeHttpUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.username !== '' || parsed.password !== '') return false;

  const rawHost = parsed.hostname.toLowerCase();
  if (rawHost === '') return false;

  if (rawHost.startsWith('[')) {
    const inner =
      rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost.slice(1);
    const bytes = parseIpv6Bytes(inner);
    return bytes !== null && !isBlockedIpv6(bytes);
  }

  // A trailing dot is the same name to DNS ("localhost." === "localhost").
  const host = rawHost.endsWith('.') ? rawHost.slice(0, -1) : rawHost;
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) {
    return false;
  }
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return false;
  }

  const quad = parseDottedQuad(host);
  if (quad !== null) return !isBlockedIpv4(quad[0], quad[1], quad[2]);
  // Anything still all-digits-and-dots is numeric garbage, not a public name.
  if (/^[\d.]+$/.test(host)) return false;
  return true;
}