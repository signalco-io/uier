import { Resolver, resolve4 } from 'node:dns/promises';

export const emailDmarcAuthorities = ['rita.ns.cloudflare.com', 'aragorn.ns.cloudflare.com'] as const;
type DmarcLookup = (authority: string, owner: string) => Promise<string[][]>;

/** Require the published rejection policy independently of ACS's unsupported DMARC state. */
export function assertEmailDmarcRecord(records: string[][]) {
    const policies = records.map(chunks => chunks.join('')).filter(value => /^v=DMARC1(?:\s*;|$)/.test(value));
    if (policies.length !== 1) throw new Error('Expected exactly one authoritative DMARC policy.');
    const tags = new Map<string, string>();
    for (const tag of policies[0]!.split(';').map(value => value.trim()).filter(Boolean)) {
        const equals = tag.indexOf('=');
        const key = tag.slice(0, equals).trim().toLowerCase();
        const value = tag.slice(equals + 1).trim();
        if (equals <= 0 || tags.has(key)) throw new Error('Invalid or duplicate DMARC policy tags.');
        tags.set(key, value);
    }
    if (tags.get('v') !== 'DMARC1' || tags.get('p') !== 'reject' || (tags.has('pct') && tags.get('pct') !== '100'))
        throw new Error('Transactional email requires an authoritative DMARC rejection policy.');
}

const authoritativeLookup: DmarcLookup = async (authority, owner) => {
    const resolver = new Resolver({ timeout: 5000, tries: 2 });
    resolver.setServers(await resolve4(authority));
    return resolver.resolveTxt(owner);
};

/** Query both configured Cloudflare authoritative servers, rather than a recursive DNS cache. */
export async function assertAuthoritativeEmailDmarc(domain: string, lookup: DmarcLookup = authoritativeLookup) {
    let records: string[][][];
    try {
        records = await Promise.all(emailDmarcAuthorities.map(authority => lookup(authority, `_dmarc.${domain}`)));
    } catch {
        throw new Error('Authoritative transactional DMARC DNS is unavailable.');
    }
    records.forEach(assertEmailDmarcRecord);
}
