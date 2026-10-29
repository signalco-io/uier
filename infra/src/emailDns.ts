type EmailDnsRecord = { name: string; type: string; value: string };
export type EmailDnsKey = 'domain' | 'sPF' | 'dKIM' | 'dKIM2' | 'dMARC';

/** ACS's live 2026-03-18 response can omit DMARC. That policy belongs to the domain owner. */
export function emailDnsRecord(records: Partial<Record<EmailDnsKey, EmailDnsRecord>>, key: EmailDnsKey, type: 'TXT' | 'CNAME', domainName?: string) {
    const record = records[key] ?? (key === 'dMARC'
        ? { name: `_dmarc.${domainName ?? 'uier.io'}`, type: 'TXT', value: 'v=DMARC1; p=reject' }
        : undefined);
    if (!record || record.type.toUpperCase() !== type) throw new Error(`Missing/invalid ACS ${key} verification record.`);
    // Preserve the existing root-domain resource inputs. Azure supplies DKIM names relative
    // to the sending domain's zone; explicitly qualify them for a subdomain in the uier.io zone.
    if (!domainName) return record;
    const name = record.name.replace(/\.$/, '').toLowerCase();
    const domain = domainName.toLowerCase();
    if (name === domain || name.endsWith(`.${domain}`)) return { ...record, name };
    if (name === '@') return { ...record, name: domain };
    if (name === '_dmarc' || /^[a-z0-9_-]+\._domainkey$/.test(name)) return { ...record, name: `${name}.${domain}` };
    throw new Error(`Unexpected ACS ${key} DNS owner for the sending domain.`);
}
