type EmailDnsRecord = { name: string; type: string; value: string };
export type EmailDnsKey = 'domain' | 'sPF' | 'dKIM' | 'dKIM2' | 'dMARC';

/** ACS's live 2026-03-18 response can omit DMARC. That policy belongs to the domain owner. */
export function emailDnsRecord(records: Partial<Record<EmailDnsKey, EmailDnsRecord>>, key: EmailDnsKey, type: 'TXT' | 'CNAME') {
    const record = records[key] ?? (key === 'dMARC'
        ? { name: '_dmarc.uier.io', type: 'TXT', value: 'v=DMARC1; p=reject' }
        : undefined);
    if (!record || record.type.toUpperCase() !== type) throw new Error(`Missing/invalid ACS ${key} verification record.`);
    return record;
}
