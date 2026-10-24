import { Config, type Input } from '@pulumi/pulumi';
import { DnsRecord } from '@pulumi/cloudflare';

// Inlined from signalco infra/packages/pulumi/src/cloudflare/dnsRecord.ts.
export function dnsRecord(name: string, dnsName: Input<string>, value: Input<string>, type: 'CNAME' | 'TXT' | 'MX' | 'A', protect: boolean) {
    const config = new Config();
    const zoneId = config.requireSecret('zoneid');
    return new DnsRecord(name, {
        name: dnsName,
        zoneId,
        type,
        content: value,
        priority: type === 'MX' ? 10 : undefined,
        ttl: 1,
    }, {
        protect,
        // State written by @pulumi/cloudflare 5.x holds this record as `cloudflare:index/record:Record`.
        // The 6.x SDK already adds this alias itself; it is repeated here so the state migration
        // does not depend on the SDK keeping it.
        aliases: [{ type: 'cloudflare:index/record:Record' }],
    });
}
