import assert from 'node:assert/strict';
import test from 'node:test';
import { assertEmailDomainVerified, emailVerificationKeys } from '../dist/emailVerification.js';

const verified = () => ({ fromSenderDomain: 'uier.io', verificationStates: Object.fromEntries(emailVerificationKeys.map(key => [key, { status: 'Verified' }])) });

test('cutover requires the expected domain and all five live verification states', () => {
    assert.doesNotThrow(() => assertEmailDomainVerified(verified()));
    assert.throws(() => assertEmailDomainVerified({ ...verified(), fromSenderDomain: 'another.example' }));
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
