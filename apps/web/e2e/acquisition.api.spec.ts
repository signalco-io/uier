import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { allowsAnalytics, analyticsUrl, attributionLink, classifyAttribution, incomingAttribution } from '../src/lib/acquisition/types';
import { claimAcquisitionEvents, markAcquisitionMilestone } from '../src/lib/acquisition/server';
import { getAppStore } from '../src/lib/app/store';
import { userPk, type DbUser, type DbProject } from '../src/lib/app/model';
import { createProjectComment } from '../src/lib/review/comments';
import { persistProjectAccess } from './support/projectAccess';

const priorLocal = process.env.UIER_LOCAL;
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => { if (priorLocal === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = priorLocal; });
const attribution = { channel: 'ai_search', source: 'chatgpt' } as const;
async function user({ legacy = false, old = false } = {}) {
    const id = `u_${randomUUID()}`, now = new Date(Date.now() - (old ? 25 * 60 * 60 * 1000 : 0)).toISOString();
    const doc: DbUser = { type: 'user', id, pk: userPk(id), name: 'Test', email: `${id}@example.test`, createdAt: now, updatedAt: now,
        ...(!legacy ? { acquisition: { version: 1, milestones: {}, delivered: [] } } : {}) };
    await getAppStore().create(doc);
    return doc;
}
async function state(doc: DbUser) { return (await getAppStore().get<DbUser>(doc.pk, doc.id))!.doc.acquisition; }

test('source attribution returns bounded labels without URLs, searches or arbitrary campaign values', () => {
    for (const [referrer, source, channel] of [
        ['https://www.google.com/search?q=private', 'google', 'organic_search'],
        ['https://www.bing.com/search?q=private', 'bing', 'organic_search'],
        ['https://chatgpt.com/c/private', 'chatgpt', 'ai_search'],
        ['https://copilot.microsoft.com/chats/private', 'copilot', 'ai_search'],
        ['https://perplexity.ai/search/private', 'perplexity', 'ai_search'],
        ['https://claude.ai/chat/private', 'claude', 'ai_search'],
        ['https://github.com/private/repo', 'github', 'social'],
        ['https://news.example/private', 'other', 'referral']
    ]) expect(classifyAttribution('https://uier.io/?token=private', referrer!)).toEqual({ source, channel });
    expect(classifyAttribution('https://uier.io/?utm_source=chatgpt&utm_campaign=private', '')).toEqual(attribution);
    expect(classifyAttribution('https://uier.io/?utm_source=google&utm_medium=cpc', '')).toEqual({ source: 'google', channel: 'campaign' });
    expect(classifyAttribution('https://uier.io/?utm_source=private-email@example.com', '')).toEqual({ source: 'other', channel: 'campaign' });
    expect(classifyAttribution('https://uier.io/', 'https://chatgpt.com.evil.example/private')).toEqual({ source: 'other', channel: 'referral' });
    expect(classifyAttribution('https://uier.io/', '')).toEqual({ source: 'direct', channel: 'direct' });
    expect(classifyAttribution('https://uier.io/', 'not a URL')).toEqual({ source: 'unknown', channel: 'unknown' });
});

test('analytics strips query strings, fragments and all private app path segments', () => {
    for (const path of ['/app/projects/private/comments/secret?token=private#reply', '/app/sign-in/confirm?token=private', '/app/connect/private'])
        expect(analyticsUrl(`https://uier.io${path}`)).toBe('https://uier.io/app');
    expect(analyticsUrl('https://uier.io/guides/nextjs?utm_source=private#section')).toBe('https://uier.io/guides/nextjs');
    expect(analyticsUrl('https://uier.io/notifications?token=private')).toBe('https://uier.io/notifications');
});

test('Do Not Track and Global Privacy Control independently suppress analytics', () => {
    expect(allowsAnalytics({})).toBe(true);
    expect(allowsAnalytics({ doNotTrack: '0', globalPrivacyControl: false })).toBe(true);
    expect(allowsAnalytics({ doNotTrack: '1' })).toBe(false);
    expect(allowsAnalytics({ doNotTrack: '0', globalPrivacyControl: true })).toBe(false);
});

test('bounded source hints survive the app sign-in redirect without browser storage', () => {
    const target = attributionLink(new URL('https://uier.io/app'), attribution);
    expect([...target.searchParams]).toEqual([['acq_channel', 'ai_search'], ['acq_source', 'chatgpt']]);
    expect(incomingAttribution(target.href, 'https://uier.io/')).toEqual(attribution);
    const signIn = new URL('https://uier.io/app/sign-in');
    signIn.searchParams.set('next', target.pathname + target.search);
    expect(incomingAttribution(signIn.href, 'https://uier.io/')).toEqual(attribution);
    expect(incomingAttribution('https://uier.io/app?acq_source=private-email&acq_channel=private-url', '')).toEqual({ source: 'unknown', channel: 'unknown' });
    expect(incomingAttribution('https://uier.io/app', 'https://accounts.google.com/')).toEqual({ source: 'unknown', channel: 'unknown' });
    expect(incomingAttribution('https://uier.io/guides', 'https://chatgpt.com/private')).toEqual(attribution);
    expect(analyticsUrl(signIn.href)).toBe('https://uier.io/app');
});

test('milestones are recorded once; concurrent claims deliver each stage once and preserve first source', async () => {
    const doc = await user();
    await Promise.all([markAcquisitionMilestone(doc.id, 'sign_in'), markAcquisitionMilestone(doc.id, 'first_project')]);
    const first = await state(doc);
    await markAcquisitionMilestone(doc.id, 'first_project');
    expect((await state(doc))!.milestones.first_project).toBe(first!.milestones.first_project);
    const claims = await Promise.all([claimAcquisitionEvents(doc.id, attribution), claimAcquisitionEvents(doc.id, { channel: 'direct', source: 'direct' })]);
    const events = claims.flatMap(claim => claim.events);
    expect(events.map(e => e.stage).sort()).toEqual(['first_project', 'sign_in']);
    expect(events.every(e => e.source === events[0]!.source)).toBe(true);
    for (const event of events) expect(Object.keys(event).sort()).toEqual(['channel', 'source', 'stage']);
    expect(await claimAcquisitionEvents(doc.id, attribution)).toEqual({ enabled: true, events: [] });
    await markAcquisitionMilestone(doc.id, 'first_review');
    const final = await claimAcquisitionEvents(doc.id, attribution);
    expect(final.enabled).toBe(false);
    expect(final.events).toEqual([{ ...events[0], stage: 'first_review' }]);
});

test('existing accounts are not backfilled, late source claims become unknown and erased accounts stay erased', async () => {
    const legacy = await user({ legacy: true });
    await markAcquisitionMilestone(legacy.id, 'first_project');
    expect(await claimAcquisitionEvents(legacy.id, attribution)).toEqual({ enabled: false, events: [] });
    expect(await state(legacy)).toBeUndefined();
    const old = await user({ old: true });
    expect((await claimAcquisitionEvents(old.id, attribution)).events[0]).toMatchObject({ channel: 'unknown', source: 'unknown' });
    await getAppStore().delete(old.pk, old.id);
    await markAcquisitionMilestone(old.id, 'first_project');
    expect(await claimAcquisitionEvents(old.id, attribution)).toEqual({ enabled: false, events: [] });
    expect(await getAppStore().get(old.pk, old.id)).toBeNull();
});

test('only a committed real-project review activates its creator; a failed write and showcase do not', async () => {
    const owner = await user();
    const project = { id: randomUUID().replaceAll('-', '').slice(0, 12), createdBy: owner.id } as DbProject;
    await persistProjectAccess(project, [{ userId: owner.id, name: 'Owner', isAdmin: true }]);
    const actor = { kind: 'member', userId: owner.id, name: 'Owner', isAdmin: true } as const;
    const input = { path: '/', origin: 'https://reviewed.example', text: 'private feedback', kind: 'comment' as const, position: { type: 'page' as const } };
    const request = new Request('http://127.0.0.1/api/review');
    await expect(createProjectComment(request, project, { kind: 'guest', visitorId: '' }, input)).rejects.toBeDefined();
    expect((await state(owner))!.milestones.first_review).toBeUndefined();
    const saved = await createProjectComment(request, project, actor, input);
    expect(saved.id).toBeTruthy();
    expect((await state(owner))!.milestones.first_review).toBeTruthy();
    const other = await user();
    const showcase = { ...project, id: 'uier00000001', createdBy: other.id };
    await persistProjectAccess(showcase, [{ userId: other.id, name: 'Owner', isAdmin: true }]);
    await createProjectComment(request, showcase, { ...actor, userId: other.id }, input);
    expect((await state(other))!.milestones.first_review).toBeUndefined();
});

test('the collection API rejects foreign origins and unsigned callers without caching', async ({ request, baseURL }) => {
    const foreign = await request.post('/api/acquisition', { headers: { Origin: 'https://other.example' }, data: attribution });
    expect(foreign.status()).toBe(403);
    expect(foreign.headers()['cache-control']).toBe('no-store');
    const signedOut = await request.post('/api/acquisition', { headers: { Origin: baseURL! }, data: attribution });
    expect(signedOut.status()).toBe(401);
    expect(signedOut.headers()['cache-control']).toBe('no-store');
});
