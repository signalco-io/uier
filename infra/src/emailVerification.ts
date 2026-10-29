import { assertAuthoritativeEmailDmarc } from './emailDmarc.js';

export const emailVerificationKeys = ['domain', 'sPF', 'dKIM', 'dKIM2'] as const;
type VerifiedEmailDomain = {
    fromSenderDomain: string;
    verificationStates: Partial<Record<typeof emailVerificationKeys[number], { status?: string }>>;
};

/** Fail the preview and deployment before linking or changing the production sender. */
export function assertEmailDomainVerified(domain: VerifiedEmailDomain) {
    if (domain.fromSenderDomain.toLowerCase() !== 'notify.uier.io') throw new Error('Unexpected transactional email sender domain.');
    for (const key of emailVerificationKeys) {
        if (domain.verificationStates[key]?.status !== 'Verified')
            throw new Error(`notify.uier.io email ${key} must be Verified before sender cutover.`);
    }
}

/** Both independent checks must succeed before any link or sender change. */
export async function verifyTransactionalEmailDomain<T extends VerifiedEmailDomain>(domain: T,
    verifyDmarc: (domain: string) => Promise<void> = assertAuthoritativeEmailDmarc) {
    assertEmailDomainVerified(domain);
    await verifyDmarc(domain.fromSenderDomain);
    return domain;
}
