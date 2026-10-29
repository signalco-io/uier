import assert from 'node:assert/strict';
import test from 'node:test';
import { assertEmailDomainVerified, emailVerificationKeys, verifyTransactionalEmailDomain } from '../dist/emailVerification.js';

const verified = () => ({ fromSenderDomain: 'notify.uier.io', verificationStates: Object.fromEntries(emailVerificationKeys.map(key => [key, { status: 'Verified' }])) });

test('cutover requires the notify domain and four supported live Azure states', () => {
    assert.doesNotThrow(() => assertEmailDomainVerified(verified()));
    assert.throws(() => assertEmailDomainVerified({ ...verified(), fromSenderDomain: 'another.example' }));
    assert.throws(() => assertEmailDomainVerified({ ...verified(), fromSenderDomain: 'uier.io' }));
    assert.doesNotThrow(() => assertEmailDomainVerified({ ...verified(), verificationStates: {
        ...verified().verificationStates, dMARC: { status: 'NotStarted' } } }));
    for (const key of emailVerificationKeys) {
        for (const status of ['NotStarted', 'VerificationRequested', 'VerificationInProgress', 'VerificationFailed', 'CancellationRequested', undefined]) {
            const value = verified();
            value.verificationStates[key] = { status };
            assert.throws(() => assertEmailDomainVerified(value), /must be Verified/);
        }
        const value = verified();
        delete value.verificationStates[key];
        assert.throws(() => assertEmailDomainVerified(value), /must be Verified/);
    }
});

test('authoritative DMARC is required after Azure checks, and a failed check blocks cutover', async () => {
    const domain = verified();
    const lookups = [];
    assert.equal(await verifyTransactionalEmailDomain(domain, async name => { lookups.push(name); }), domain);
    assert.deepEqual(lookups, ['notify.uier.io']);
    await assert.rejects(verifyTransactionalEmailDomain(domain, async () => { throw new Error('DNS unavailable'); }), /DNS unavailable/);
    await assert.rejects(verifyTransactionalEmailDomain({ ...domain, verificationStates: {} }, async () => {
        throw new Error('Must not query DNS before Azure is verified');
    }), /must be Verified/);
});
