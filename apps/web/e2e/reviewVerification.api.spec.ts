import { expect, test } from '@playwright/test';
import { signToken } from '../src/lib/app/tokens';
import { assertVerifiedWrite, createVerification } from '../src/lib/review/verification';
import type { ReviewApiContext } from '../src/lib/review/http';

test('review verification rejects bots and expired, tampered or transplanted proofs', async () => {
    const saved = { local: process.env.UIER_LOCAL, verdict: process.env.UIER_BOTID_DEV_BYPASS };
    process.env.UIER_LOCAL = '1';
    try {
        const project = { id: 'abcdefghijkl', urls: ['https://reviewed.example'] } as ReviewApiContext['project'];
        const actor = { kind: 'guest', visitorId: 'visitor-hash' } as const;
        const payload = { projectId: project.id, origin: project.urls[0]!, authorId: actor.visitorId };
        const context = (token: string, overrides: Partial<ReviewApiContext> = {}): ReviewApiContext => ({
            request: new Request('https://uier.io/api/review/abcdefghijkl/comments', {
                method: 'POST', headers: { 'X-Uier-Verification': token }
            }),
            project, actor, siteOrigin: payload.origin, ...overrides
        });
        const token = signToken('review-verification', payload, 300);
        await expect(assertVerifiedWrite(context(token))).resolves.toBeUndefined();
        for (const invalid of ['', `${token}x`, signToken('review-verification', payload, -1), signToken('review', payload, 300)])
            await expect(assertVerifiedWrite(context(invalid))).rejects.toMatchObject({ code: 'bot_detected' });
        for (const overrides of [
            { project: { ...project, id: 'another-code' } },
            { siteOrigin: 'https://other.example' },
            { actor: { kind: 'guest', visitorId: 'someone-else' } as const }
        ])
            await expect(assertVerifiedWrite(context(token, overrides))).rejects.toMatchObject({ code: 'bot_detected' });

        process.env.UIER_BOTID_DEV_BYPASS = 'BAD-BOT';
        await expect(assertVerifiedWrite(context('', { siteOrigin: undefined }))).rejects.toMatchObject({ code: 'bot_detected' });
        const verificationRequest = new Request('https://uier.io/api/review/abcdefghijkl/verification', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ origin: payload.origin })
        });
        await expect(createVerification(context('', { request: verificationRequest, siteOrigin: undefined })))
            .rejects.toMatchObject({ code: 'bot_detected' });
    } finally {
        if (saved.local === undefined) delete process.env.UIER_LOCAL;
        else process.env.UIER_LOCAL = saved.local;
        if (saved.verdict === undefined) delete process.env.UIER_BOTID_DEV_BYPASS;
        else process.env.UIER_BOTID_DEV_BYPASS = saved.verdict;
    }
});
