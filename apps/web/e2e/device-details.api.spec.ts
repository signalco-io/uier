import { persistProjectAccess } from './support/projectAccess';
import { randomInt, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { feedbackMarkdown } from '@uier/toolbar/feedback-context';
import type { DbComment, DbCommentDevice } from '../src/lib/db/schema';
import type { DbProject } from '../src/lib/app/model';
import { createCommentSchema } from '../src/lib/comments/validation';
import { createComment } from '../src/lib/comments/service';
import { toCommentDto } from '../src/lib/comments/dto';
import { toReproductionContext } from '../src/lib/comments/reproduction';
import { createProjectComment } from '../src/lib/review/comments';
import { toReviewCommentDto } from '../src/lib/review/dto';
import { projectFeedbackExport } from '../src/lib/review/feedbackContext';
import { getCommentsStore } from '../src/lib/repo/commentsStore';

const previousRuntime = process.env.UIER_LOCAL;
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => { if (previousRuntime === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = previousRuntime; });

const origin = 'https://reviewed.example';
/** What the toolbar sends (`getDeviceInfo`) */
const device: DbCommentDevice = {
    capturedAt: '2026-11-09T09:00:00.000Z', size: 'mobile', windowSize: [393, 852], pixelRatio: 3,
    browser: 'Google Chrome (131)', os: 'Android 14', model: 'Pixel 8', input: 'touch', colorScheme: 'dark', reducedMotion: true, pageLanguage: 'en-GB'
};

/** Everything the in-memory stores hold: comments, screenshots, submissions, rate-limit counters and app documents */
function storedEverything() {
    const memory = globalThis as typeof globalThis & {
        __uierCommentsMemoryStore2?: { domains: Map<string, Map<string, { document: unknown }>>; counters: Map<string, unknown> };
        __uierAppMemoryStore?: { partitions: Map<string, Map<string, { doc: unknown }>> };
    };
    const comments = memory.__uierCommentsMemoryStore2!;
    return JSON.stringify({
        documents: [...comments.domains.values()].flatMap(entries => [...entries.values()].map(entry => entry.document)),
        counters: [...comments.counters.entries()],
        app: [...memory.__uierAppMemoryStore?.partitions.values() ?? []].flatMap(entries => [...entries.values()].map(entry => entry.doc))
    });
}

test('device details are validated: bounded names, known settings; anything else is dropped or stripped', async () => {
    const base = { path: '/pricing', position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 }, text: 'Device details' };
    const parsed = await createCommentSchema.parseAsync({ ...base, device: { ...device,
        // A client must never send these; unknown keys are stripped, never stored
        userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36', ip: '198.51.100.7', timeZone: 'Europe/Zagreb', fonts: ['Arial'], gpu: 'Adreno 740'
    } });
    expect(parsed.device).toEqual(device);

    // Values this version does not know are dropped; the comment is still saved
    const unknown = await createCommentSchema.parseAsync({ ...base, device: {
        size: 'desktop', model: 'x'.repeat(65), input: 'stylus', colorScheme: 'sepia', reducedMotion: 'yes',
        pageLanguage: 'en-x-reviewer', browser: ' Firefox​ (133)\n', os: '‮Windows'
    } });
    expect(Object.fromEntries(Object.entries(unknown.device!).filter(([, value]) => value !== undefined)))
        .toEqual({ size: 'desktop', browser: 'Firefox (133)', os: 'Windows' });
    for (const pageLanguage of ['en_US', 'english', 'en-GB-oxendict', '<b>en</b>', 'zh-Hant-TW', 'es-419'])
        expect((await createCommentSchema.parseAsync({ ...base, device: { pageLanguage } })).device?.pageLanguage, pageLanguage)
            .toBe(['zh-Hant-TW', 'es-419'].includes(pageLanguage) ? pageLanguage : undefined);

    // The browser and system names keep their existing bound: too long is refused, as before
    expect((await createCommentSchema.safeParseAsync({ ...base, device: { browser: 'x'.repeat(65) } })).success).toBe(false);
    expect((await createCommentSchema.safeParseAsync({ ...base, device: { os: 'x'.repeat(65) } })).success).toBe(false);
});

test('a comment stores only the parsed device fields, never the user-agent string or the IP address', async () => {
    const userAgent = `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 Probe/${randomUUID()}`;
    const ip = `198.51.100.${randomInt(1, 255)}`;
    const ipv6 = `2001:db8:${randomInt(1, 0xffff).toString(16)}::${randomInt(1, 0xffff).toString(16)}`;
    // Unique probe: saved user queries can legitimately contain Europe/Zagreb.
    const cityProbe = `GeoProbe-${randomUUID()}`;
    const headers = (address: string) => ({ 'user-agent': userAgent, 'x-forwarded-for': `${address}, 10.0.0.1`, 'x-real-ip': address, 'x-vercel-ip-country': 'HR', 'x-vercel-ip-city': cityProbe });
    const input = await createCommentSchema.parseAsync({
        path: '/pricing', position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 }, text: 'Stored device', device: { ...device, userAgent, ip }
    });

    // The public comments API (uier's own site)
    const domain = `devices-${randomUUID()}`;
    const publicComment = await createComment({ request: new Request(`https://uier.io/api/comments`, { method: 'POST', headers: headers(ip) }), domain, visitor: { authorId: `visitor-${randomUUID()}` } }, input);
    // A project review, from IPv6 and IPv4 addresses (the reviewer's kind does not change what is stored)
    const project = { id: `devices-${randomUUID()}`, urls: [origin] } as DbProject;
    await persistProjectAccess(project);
    const review = (address: string) => createProjectComment(new Request(`https://uier.io/api/review/${project.id}/comments`, { method: 'POST', headers: headers(address) }),
        project, { kind: 'guest', visitorId: `guest-${randomUUID()}` }, { ...input, origin });
    const fromIpv6 = await review(ipv6);
    const fromIpv4 = await review(ip);

    for (const [partition, id] of [[domain, publicComment.id], [fromIpv6.domain, fromIpv6.id], [fromIpv4.domain, fromIpv4.id]] as const) {
        const stored = (await getCommentsStore().get(partition, id))!.comment;
        expect(stored.device).toEqual(device);
    }
    // Nowhere in the store, rate-limit counters included (they keep a keyed hash of the IP bucket)
    const everything = storedEverything();
    for (const value of [userAgent, 'Probe/', ip, ipv6, ipv6.split('::')[0], cityProbe, '"HR"', 'userAgent', 'x-forwarded-for'])
        expect(everything, value).not.toContain(value);
});

test('only project members see the details; guests and the public API keep the screen size and viewport', async () => {
    const project = { id: `devices-${randomUUID()}`, urls: [origin] } as DbProject;
    const comment: DbComment = {
        id: `comment_${randomUUID()}`, domain: `project:${project.id}`, origin, path: '/pricing', authorId: 'guest-owner', device: { ...device },
        position: { type: 'page' }, kind: 'bug', thread: { items: [{ id: 'first', text: 'It overlaps on my phone', authorId: 'guest-owner' }] }
    };
    await persistProjectAccess(project);
    await getCommentsStore().create(comment);
    const owner = { kind: 'guest', visitorId: 'guest-owner' } as const;
    const other = { kind: 'guest', visitorId: 'guest-other' } as const;
    const member = { kind: 'member', userId: 'member', name: 'Member', isAdmin: false } as const;

    const memberView = toReviewCommentDto(comment, member, new Map(), [origin])!;
    expect(memberView.device).toEqual({ size: 'mobile', windowSize: [393, 852] });
    expect(memberView.reproduction).toMatchObject({
        browser: 'Google Chrome (131)', os: 'Android 14', model: 'Pixel 8', input: 'touch', colorScheme: 'dark', reducedMotion: true, pageLanguage: 'en-GB'
    });
    expect(memberView.reproduction!.text).toBe([
        'Browser: Google Chrome (131)', 'Operating system: Android 14', 'Viewport: 393×852 CSS px', 'Pixel ratio: 3',
        'Model: Pixel 8', 'Input: Touch', 'Colour scheme: Dark', 'Reduced motion: On', 'Page language: en-GB',
        'Captured: 2026-11-09T09:00:00.000Z', `Page: ${origin}/pricing`
    ].join('\n'));
    // Guests (the author too) and the public API: the screen size and viewport only, as before
    for (const actor of [owner, other]) {
        const view = toReviewCommentDto(comment, actor, new Map(), [origin]);
        expect(view?.device).toEqual({ size: 'mobile', windowSize: [393, 852] });
        expect(view?.reproduction).toBeUndefined();
        expect(JSON.stringify(view)).not.toMatch(/Pixel 8|Android 14|Chrome|touch|dark|reducedMotion|en-GB/);
    }
    expect(toCommentDto(comment, 'guest-owner')?.device).toEqual({ size: 'mobile', windowSize: [393, 852] });

    // Copy issue: members get the details in the packet and its Markdown, guests do not
    const memberPacket = await projectFeedbackExport(project, member, comment.id, undefined, 'https://uier.example');
    expect(memberPacket.context.reproduction).toMatchObject({ model: 'Pixel 8', input: 'touch', colorScheme: 'dark', reducedMotion: true, pageLanguage: 'en-GB' });
    expect(memberPacket.markdown).toContain('Operating system: ` Android 14 `\n\nPixel ratio: 3\n\nModel: ` Pixel 8 `\n\nInput: Touch\n\nColour scheme: Dark\n\nReduced motion: On\n\nPage language: en-GB\n\nCaptured:');
    expect(memberPacket.markdown).toBe(feedbackMarkdown(memberPacket.context));
    const guestPacket = await projectFeedbackExport(project, owner, comment.id, origin, 'https://uier.example');
    expect(guestPacket.context.reproduction).toEqual({ device: 'mobile', windowSize: [393, 852] });
    expect(guestPacket.markdown).not.toMatch(/Model:|Input:|Colour scheme:|Reduced motion:|Page language:/);
});

test('older comments keep what they recorded; stored values that are not valid are left out', () => {
    const legacy = { id: 'comment_legacy', domain: 'project:legacy', origin, path: '/', position: { type: 'page' }, thread: { items: [] } } as unknown as DbComment;
    // The client hint names of before: the marks still read them, nothing new is invented
    const before = toReproductionContext({ ...legacy, device: { browser: 'Microsoft Edge (156)', os: 'macOS', windowSize: [1280, 720], pixelRatio: 2 } }, [origin]);
    expect(before).toMatchObject({ browser: 'Microsoft Edge (156)', os: 'macOS' });
    for (const key of ['model', 'input', 'colorScheme', 'reducedMotion', 'pageLanguage'] as const) expect(before[key]).toBeUndefined();
    expect(before.text).toBe(['Browser: Microsoft Edge (156)', 'Operating system: macOS', 'Viewport: 1280×720 CSS px', 'Pixel ratio: 2', 'Captured: Unavailable', `Page: ${origin}/`].join('\n'));
    // A document edited by hand, or written by a version with other values
    const odd = toReproductionContext({ ...legacy, device: { input: 'pen', colorScheme: 'sepia', reducedMotion: 'yes', pageLanguage: 'en-x-reviewer', model: '‮Pixel​ 8' } as unknown as DbComment['device'] }, [origin]);
    expect(odd).toMatchObject({ input: undefined, colorScheme: undefined, reducedMotion: undefined, pageLanguage: undefined, model: 'Pixel 8' });
});
