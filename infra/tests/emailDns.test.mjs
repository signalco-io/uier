import assert from 'node:assert/strict';
import test from 'node:test';
import { emailDnsRecord } from '../dist/emailDns.js';

test('live ACS omission of DMARC uses the explicit domain policy; supplied records remain authoritative', () => {
    assert.deepEqual(emailDnsRecord({}, 'dMARC', 'TXT'), { name: '_dmarc.uier.io', type: 'TXT', value: 'v=DMARC1; p=reject' });
    const record = { name: '_dmarc.uier.io', type: 'TXT', value: 'v=DMARC1; p=quarantine' };
    assert.equal(emailDnsRecord({ dMARC: record }, 'dMARC', 'TXT'), record);
    for (const key of ['domain', 'sPF', 'dKIM', 'dKIM2']) assert.throws(() => emailDnsRecord({}, key, 'TXT'));
    assert.throws(() => emailDnsRecord({ dMARC: { ...record, type: 'CNAME' } }, 'dMARC', 'TXT'));
});

test('transactional DNS owners belong to notify.uier.io within the parent zone', () => {
    const domain = 'notify.uier.io';
    assert.deepEqual(emailDnsRecord({}, 'dMARC', 'TXT', domain), { name: '_dmarc.notify.uier.io', type: 'TXT', value: 'v=DMARC1; p=reject' });
    for (const key of ['dKIM', 'dKIM2']) {
        const record = { name: 'selector1-azurecomm-prod-net._domainkey', type: 'CNAME', value: 'selector1-azurecomm-prod-net._domainkey.azurecomm.net' };
        assert.equal(emailDnsRecord({ [key]: record }, key, 'CNAME', domain).name, `${record.name}.${domain}`);
        assert.equal(emailDnsRecord({ [key]: { ...record, name: `${record.name}.${domain}.` } }, key, 'CNAME', domain).name, `${record.name}.${domain}`);
        assert.throws(() => emailDnsRecord({ [key]: { ...record, name: `${record.name}.uier.io` } }, key, 'CNAME', domain), /Unexpected ACS/);
    }
    const record = { name: domain, type: 'TXT', value: 'provider-value' };
    assert.equal(emailDnsRecord({ domain: record }, 'domain', 'TXT', domain).name, domain);
    assert.throws(() => emailDnsRecord({ domain: { ...record, name: 'uier.io' } }, 'domain', 'TXT', domain), /Unexpected ACS/);
});
