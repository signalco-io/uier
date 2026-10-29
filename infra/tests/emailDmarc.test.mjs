import assert from 'node:assert/strict';
import test from 'node:test';
import { assertEmailDmarcRecord, assertAuthoritativeEmailDmarc, emailDmarcAuthorities } from '../dist/emailDmarc.js';

test('DMARC requires one unambiguous full rejection policy and supports split TXT strings', () => {
    assert.doesNotThrow(() => assertEmailDmarcRecord([['v=DMARC1; ', 'p=reject']]));
    assert.doesNotThrow(() => assertEmailDmarcRecord([['v=DMARC1; p=reject; pct=100; rua=mailto:reports@example.com']]));
    for (const records of [[], [['v=DMARC1; p=none']], [['v=DMARC1; p=quarantine']], [['v=DMARC1; p=reject; pct=50']],
        [['v=DMARC1; p=reject'], ['v=DMARC1; p=reject']], [['v=DMARC1; p=reject; p=none']], [['v=DMARC1; p=reject; bad-tag']]])
        assert.throws(() => assertEmailDmarcRecord(records));
});

test('both authoritative servers must supply the sending subdomain policy', async () => {
    const calls = [];
    await assertAuthoritativeEmailDmarc('notify.uier.io', async (authority, owner) => {
        calls.push([authority, owner]);
        return [['v=DMARC1; p=reject']];
    });
    assert.deepEqual(calls, emailDmarcAuthorities.map(authority => [authority, '_dmarc.notify.uier.io']));
    await assert.rejects(assertAuthoritativeEmailDmarc('notify.uier.io', async authority =>
        authority === emailDmarcAuthorities[0] ? [['v=DMARC1; p=reject']] : []));
    await assert.rejects(assertAuthoritativeEmailDmarc('notify.uier.io', async () => {
        throw new Error('private resolver details');
    }), /^Error: Authoritative transactional DMARC DNS is unavailable\.$/);
});
