export const emailVerificationKeys = ['domain', 'sPF', 'dKIM', 'dKIM2', 'dMARC'] as const;

/** Fail the preview and deployment before linking or changing the production sender. */
export function assertEmailDomainVerified(domain: {
    fromSenderDomain: string;
    verificationStates: Partial<Record<typeof emailVerificationKeys[number], { status?: string }>>;
}) {
    if (domain.fromSenderDomain !== 'uier.io') throw new Error('Unexpected email sender domain.');
    for (const key of emailVerificationKeys) {
        if (domain.verificationStates[key]?.status !== 'Verified')
            throw new Error(`uier.io email ${key} must be Verified before sender cutover.`);
    }
}
