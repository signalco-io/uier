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
