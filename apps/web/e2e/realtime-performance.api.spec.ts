import { expect, test } from '@playwright/test';
import { createRealtimeAuthorizer, type RealtimeClaims } from '../src/lib/realtime/tickets';
import type { ProjectActor } from '../src/lib/review/actor';

const claims: RealtimeClaims = {
    domain: 'project:fixture', projectId: 'fixture', workspaceId: 'workspace',
    origin: 'https://reviewed.example', apiOrigin: 'https://uier.example', audience: 'review',
    identity: { kind: 'member', userId: 'member' }
};
const member: ProjectActor = { kind: 'member', userId: 'member', name: 'Member', isAdmin: false };

test('overlapping identical authorization reads share work, while settled and rejected reads are fresh', async ({}, testInfo) => {
    let reads = 0;
    let allowed = true;
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const authorize = createRealtimeAuthorizer(async () => {
        reads++;
        await blocked;
        if (!allowed) throw new Error('Access revoked');
        return member;
    });
    const firstTick = Array.from({ length: 20 }, () => authorize({ ...claims, identity: { ...claims.identity } }));
    await Promise.resolve();
    expect(reads).toBe(1);
    release();
    expect(await Promise.all(firstTick)).toEqual(Array(20).fill(member));
    allowed = false;
    await expect(authorize(claims)).rejects.toThrow('Access revoked');
    expect(reads).toBe(2);
    allowed = true;
    expect(await authorize(claims)).toEqual(member);
    expect(reads).toBe(3);
    await testInfo.attach('realtime-overlapping-authorization-reads', { contentType: 'application/json', body: JSON.stringify({
        concurrentIdenticalRequests: firstTick.length, beforeReadOperations: firstTick.length, afterReadOperations: 1,
        nextRevokedReadWasFresh: true, subsequentRestoredReadWasFresh: true,
        productionSavingsMeasured: false
    }) });
});

test('authorization work never crosses the identity, project, workspace, audience or origin boundary', async () => {
    let reads = 0;
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const authorize = createRealtimeAuthorizer(async () => { reads++; await blocked; return member; });
    const independent: RealtimeClaims[] = [claims,
        { ...claims, identity: { kind: 'member', userId: 'another-member' } },
        { ...claims, identity: { kind: 'guest', visitorId: 'member' } },
        { ...claims, projectId: 'another-project' },
        { ...claims, workspaceId: 'another-workspace' },
        { ...claims, domain: 'project:another-partition' },
        { ...claims, audience: 'showcase' },
        { ...claims, origin: 'https://another.example' },
        { ...claims, apiOrigin: 'https://another-api.example' }];
    const requests = independent.map(scope => authorize(scope));
    await Promise.resolve();
    expect(reads).toBe(independent.length);
    release();
    await Promise.all(requests);
});
