import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';

/*
 * Outbound requests to addresses a client chose (OAuth client metadata documents, MCP event
 * callbacks) reach only public addresses. Pass `publicLookup` as the request's `lookup`, so the
 * check runs on the connection's own resolution and DNS cannot change in between.
 */

const blocked = new BlockList();
for (const [network, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
    ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const)
    blocked.addSubnet(network, prefix, 'ipv4');
// No `::ffff:0:0/96` rule: BlockList checks IPv4-mapped addresses against the IPv4 rules above, and
// such a rule would also match every IPv4 address.
for (const [network, prefix] of [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
    ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const)
    blocked.addSubnet(network, prefix, 'ipv6');

export function isPublicAddress(address: string) {
    const family = isIP(address);
    if (!family) return false;
    const mapped = family === 6 ? /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1] : undefined;
    if (mapped) return !blocked.check(mapped, 'ipv4');
    return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** Raised when a host resolves to any non-public address. Its message names no address. */
export const BLOCKED_ADDRESS_CODE = 'EBLOCKED';

/** A `lookup` for `http(s).request` that fails unless every resolved address is public. */
export function publicLookup(hostname: string, options: { all?: boolean }, callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) {
    dnsLookup(hostname, { all: true }, (error, addresses) => {
        if (error) return callback(error, '');
        if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address)))
            return callback(Object.assign(new Error('The host is not public.'), { code: BLOCKED_ADDRESS_CODE }), '');
        if (options.all) return callback(null, addresses);
        callback(null, addresses[0]!.address, addresses[0]!.family);
    });
}
