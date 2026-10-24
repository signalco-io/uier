import { createHash, randomUUID } from 'node:crypto';
import { expect, test as base } from '@playwright/test';
import type { APIRequestContext, APIResponse } from '@playwright/test';

// Comments API (app/api/comments) against `next start` with the in-memory store. Every request
// context is a separate anonymous visitor (own `uier_visitor` cookie). Each test writes to pages
// of its own, so tests don't affect each other (or the landing page).

type VisitorOptions = {
    /** Client IP as reported by the proxy (loopback requests are not IP rate limited when running locally) */
    ip?: string;
    headers?: Record<string, string>;
};

const test = base.extend<{ newVisitor: (options?: VisitorOptions) => Promise<APIRequestContext> }>({
    newVisitor: async ({ playwright, baseURL }, use) => {
        const visitors: APIRequestContext[] = [];
        await use(async ({ ip, headers } = {}) => {
            const visitor = await playwright.request.newContext({
                baseURL,
                extraHTTPHeaders: {
                    ...(ip ? { 'X-Forwarded-For': ip } : {}),
                    ...headers
                }
            });
            visitors.push(visitor);
            return visitor;
        });
        await Promise.all(visitors.map(visitor => visitor.dispose()));
    }
});

// Selectors in the form the toolbar creates them (`getElementSelector` from @signalco/js)
const pointPosition = { type: 'point', selector: 'body>main>h1,#hero>h1', xNormal: 0.5, yNormal: 0.25 };
const selectionPosition = {
    type: 'text',
    text: 'leaving comments',
    startSelector: 'main>section.hero>p:nth-of-type(2)',
    startOffset: 38,
    startType: 'text',
    endSelector: 'main>section.hero>p:nth-of-type(2)',
    endOffset: 54,
    endType: 'text'
};

const commentKeys = ['createdAt', 'id', 'isMine', 'path', 'position', 'resolved', 'thread'];
const leakedFields = ['authorId', 'ipHash', 'ttl', 'domain', 'windowSize', 'pixelRatio', 'browser', 'os', 'userAgent', 'updatedAt'];

type CommentDto = {
    id: string;
    path: string;
    position: Record<string, unknown>;
    // A deleted first item has only `id`, `deleted` and `createdAt`
    thread: { items: { id: string; text: string; quotedText?: string; author: { name: string; isMe: boolean }; createdAt?: string; deleted?: true }[] };
    device?: { size?: string };
    resolved: boolean;
    isMine: boolean;
    createdAt?: string;
};

function uniquePagePath() {
    return `/e2e/${randomUUID()}`;
}

/** A random IP from 198.18.0.0/15 (reserved for benchmarking), so every test has an IP of its own */
function uniqueIp() {
    const octet = () => Math.floor(Math.random() * 254) + 1;
    return `198.${18 + Math.floor(Math.random() * 2)}.${octet()}.${octet()}`;
}

/** A random IPv6 /64 from 2001:db8::/32 (documentation range); returns a function for addresses in it */
function uniqueIpv6Network() {
    const group = () => Math.floor(Math.random() * 0xffff).toString(16);
    const prefix = `2001:db8:${group()}:${group()}`;
    return (host: number) => `${prefix}:${host.toString(16)}::${group()}`;
}

async function createComment(visitor: APIRequestContext, path: string, data: Record<string, unknown> = {}) {
    return await visitor.post('/api/comments', {
        data: { path, position: pointPosition, text: 'The heading could use a subtitle.', ...data }
    });
}

async function created(response: APIResponse) {
    expect(response.status(), await response.text()).toBe(201);
    return await response.json() as CommentDto;
}

async function listComments(visitor: APIRequestContext, path: string) {
    const response = await visitor.get('/api/comments', { params: { path } });
    expect(response.status()).toBe(200);
    return await response.json() as CommentDto[];
}

async function expectError(response: APIResponse, status: number, error: string) {
    expect(response.status(), await response.text()).toBe(status);
    const body = await response.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(error === 'rate_limited' ? ['error', 'message', 'reason'] : ['error', 'message']);
    expect(body.error).toBe(error);
    expect(typeof body.message).toBe('string');
    return body;
}

function visitorCookie(response: APIResponse) {
    return response.headersArray()
        .filter(header => header.name.toLowerCase() === 'set-cookie')
        .map(header => header.value)
        .find(value => value.startsWith('uier_visitor='));
}

test('create, list, reply, resolve and delete a comment', async ({ newVisitor }) => {
    const path = uniquePagePath();
    const author = await newVisitor();
    const visitor = await newVisitor();

    const comment = await created(await createComment(author, path, { text: '  Nice page\u202e!  ' }));
    expect(Object.keys(comment).sort()).toEqual(commentKeys);
    expect(comment).toMatchObject({ path, position: pointPosition, resolved: false, isMine: true });
    expect(comment.id).toMatch(/^comment_/);
    expect(Date.parse(comment.createdAt ?? '')).not.toBeNaN();
    expect(comment.thread.items).toHaveLength(1);
    const [firstItem] = comment.thread.items;
    expect(Object.keys(firstItem!).sort()).toEqual(['author', 'createdAt', 'id', 'text']);
    // Trimmed, bidirectional overrides removed
    expect(firstItem).toMatchObject({ text: 'Nice page!', author: { isMe: true } });
    expect(firstItem!.id).toMatch(/^item_/);
    expect(firstItem!.author.name).toMatch(/^Guest [0-9A-F]{4}$/);

    // Public: every visitor sees it, with the same author name
    expect(await listComments(author, path)).toEqual([comment]);
    const [seenByVisitor] = await listComments(visitor, path);
    expect(seenByVisitor).toMatchObject({ id: comment.id, isMine: false });
    expect(seenByVisitor!.thread.items[0]!.author).toEqual({ name: firstItem!.author.name, isMe: false });

    // Anyone can reply
    const replied = await created(await visitor.post(`/api/comments/${comment.id}/replies`, { data: { text: 'Agreed, +1' } }));
    expect(replied.isMine).toBe(false);
    expect(replied.thread.items.map(item => [item.text, item.author.isMe])).toEqual([['Nice page!', false], ['Agreed, +1', true]]);
    const replyItem = replied.thread.items[1]!;
    expect(replyItem.author.name).toMatch(/^Guest [0-9A-F]{4}$/);
    expect(replyItem.author.name).not.toBe(firstItem!.author.name);

    // The author resolves and reopens it
    const resolved = await author.patch(`/api/comments/${comment.id}`, { data: { resolved: true } });
    expect(resolved.status()).toBe(200);
    expect(await resolved.json()).toMatchObject({ id: comment.id, resolved: true, isMine: true });
    expect((await listComments(visitor, path))[0]).toMatchObject({ id: comment.id, resolved: true });
    const reopened = await author.patch(`/api/comments/${comment.id}`, { data: { resolved: false } });
    expect(await reopened.json()).toMatchObject({ resolved: false });

    // Replies are deleted by their author
    await expectError(await author.delete(`/api/comments/${comment.id}/replies/${replyItem.id}`), 403, 'forbidden');
    const withoutReply = await visitor.delete(`/api/comments/${comment.id}/replies/${replyItem.id}`);
    expect(withoutReply.status()).toBe(200);
    expect((await withoutReply.json() as CommentDto).thread.items.map(item => item.id)).toEqual([firstItem!.id]);

    // The author deletes the comment
    const deleted = await author.delete(`/api/comments/${comment.id}`);
    expect(deleted.status()).toBe(204);
    expect(await listComments(visitor, path)).toEqual([]);
    await expectError(await author.delete(`/api/comments/${comment.id}`), 404, 'not_found');
});

test('only the author can resolve or delete a comment', async ({ newVisitor }) => {
    const path = uniquePagePath();
    const author = await newVisitor();
    const other = await newVisitor();
    const comment = await created(await createComment(author, path));
    const firstItemId = comment.thread.items[0]!.id;

    await expectError(await other.patch(`/api/comments/${comment.id}`, { data: { resolved: true } }), 403, 'forbidden');
    await expectError(await other.delete(`/api/comments/${comment.id}`), 403, 'forbidden');
    await expectError(await other.delete(`/api/comments/${comment.id}/replies/${firstItemId}`), 403, 'forbidden');
    expect(await listComments(other, path)).toMatchObject([{ id: comment.id, resolved: false }]);

    // Deleting the first thread item deletes the comment
    const deleted = await author.delete(`/api/comments/${comment.id}/replies/${firstItemId}`);
    expect(deleted.status()).toBe(204);
    expect(await listComments(author, path)).toEqual([]);
});

test('deleting a comment others replied to keeps the thread', async ({ newVisitor }) => {
    const path = uniquePagePath();
    const author = await newVisitor();
    const replier = await newVisitor();
    const comment = await created(await createComment(author, path, {
        position: selectionPosition,
        text: 'This sentence is hard to read.',
        quotedText: 'leaving comments directly on it'
    }));
    const firstItem = comment.thread.items[0]!;
    const othersReply = (await created(await replier.post(`/api/comments/${comment.id}/replies`, { data: { text: 'I like it' } }))).thread.items[1]!;
    const ownReply = (await created(await author.post(`/api/comments/${comment.id}/replies`, { data: { text: 'Fair enough' } }))).thread.items[2]!;

    // The author deletes the comment: its text goes, the thread and every reply stay
    const response = await author.delete(`/api/comments/${comment.id}`);
    expect(response.status(), await response.text()).toBe(200);
    const kept = await response.json() as CommentDto;
    expect(Object.keys(kept).sort()).toEqual(commentKeys);
    // Nobody owns the thread any more; the position (and the selected page text in it) stays
    expect(kept).toMatchObject({ id: comment.id, path, position: selectionPosition, resolved: false, isMine: false });
    const [placeholder, ...replies] = kept.thread.items;
    expect(placeholder).toEqual({ id: firstItem.id, deleted: true, createdAt: firstItem.createdAt });
    expect(replies.map(item => [item.id, item.text, item.author.isMe])).toEqual([
        [othersReply.id, 'I like it', false],
        [ownReply.id, 'Fair enough', true]
    ]);

    // Every visitor sees the placeholder; the text and quoted text are not returned to anyone
    const [seenByReplier] = await listComments(replier, path);
    expect(seenByReplier).toMatchObject({ id: comment.id, isMine: false });
    expect(seenByReplier!.thread.items[0]).toEqual(placeholder);
    for (const visitor of [author, replier]) {
        const listed = JSON.stringify(await listComments(visitor, path));
        expect(listed).not.toContain('hard to read');
        expect(listed).not.toContain('directly on it');
    }

    // Nobody can resolve or delete the thread now, or delete the placeholder
    for (const visitor of [author, replier]) {
        await expectError(await visitor.patch(`/api/comments/${comment.id}`, { data: { resolved: true } }), 403, 'forbidden');
        await expectError(await visitor.delete(`/api/comments/${comment.id}`), 403, 'forbidden');
        await expectError(await visitor.delete(`/api/comments/${comment.id}/replies/${firstItem.id}`), 403, 'forbidden');
    }

    // Anyone can still reply
    const third = await newVisitor();
    const thirdReply = (await created(await third.post(`/api/comments/${comment.id}/replies`, { data: { text: 'Same here' } }))).thread.items[3]!;

    // Replies are deleted by their authors only; the last one takes the thread with it
    await expectError(await replier.delete(`/api/comments/${comment.id}/replies/${ownReply.id}`), 403, 'forbidden');
    for (const [visitor, item] of [[author, ownReply], [third, thirdReply]] as const) {
        const deleted = await visitor.delete(`/api/comments/${comment.id}/replies/${item.id}`);
        expect(deleted.status()).toBe(200);
        expect((await deleted.json() as CommentDto).thread.items[0]).toEqual(placeholder);
    }
    const last = await replier.delete(`/api/comments/${comment.id}/replies/${othersReply.id}`);
    expect(last.status()).toBe(204);
    expect(await listComments(author, path)).toEqual([]);
    await expectError(await replier.post(`/api/comments/${comment.id}/replies`, { data: { text: 'Hello?' } }), 404, 'not_found');
});

test('deleting a comment without other visitors\' replies deletes it with the author\'s replies', async ({ newVisitor }) => {
    const path = uniquePagePath();
    const author = await newVisitor();
    const comment = await created(await createComment(author, path));
    await created(await author.post(`/api/comments/${comment.id}/replies`, { data: { text: 'One more thing' } }));

    const deleted = await author.delete(`/api/comments/${comment.id}/replies/${comment.thread.items[0]!.id}`);
    expect(deleted.status()).toBe(204);
    expect(await listComments(author, path)).toEqual([]);
    await expectError(await author.post(`/api/comments/${comment.id}/replies`, { data: { text: 'Hello?' } }), 404, 'not_found');
});

test('a thread keeps its resolved state when its comment is deleted', async ({ newVisitor }) => {
    const path = uniquePagePath();
    const author = await newVisitor();
    const replier = await newVisitor();
    const comment = await created(await createComment(author, path));
    await created(await replier.post(`/api/comments/${comment.id}/replies`, { data: { text: 'Done' } }));
    expect((await author.patch(`/api/comments/${comment.id}`, { data: { resolved: true } })).status()).toBe(200);

    const deleted = await author.delete(`/api/comments/${comment.id}`);
    expect(deleted.status()).toBe(200);
    expect(await deleted.json()).toMatchObject({ resolved: true, isMine: false });
    // Without an author nobody can reopen it
    await expectError(await author.patch(`/api/comments/${comment.id}`, { data: { resolved: false } }), 403, 'forbidden');
    expect(await listComments(replier, path)).toMatchObject([{ id: comment.id, resolved: true }]);
});

test('a reply sent while the author deletes the comment is never lost or brought back', async ({ newVisitor }) => {
    for (let round = 0; round < 5; round++) {
        const path = uniquePagePath();
        const author = await newVisitor();
        const comment = await created(await createComment(author, path));
        const repliers = await Promise.all(Array.from({ length: 5 }, () => newVisitor()));

        const [deleted, ...replies] = await Promise.all([
            author.delete(`/api/comments/${comment.id}`),
            ...repliers.map((replier, index) => replier.post(`/api/comments/${comment.id}/replies`, { data: { text: `Reply ${index}` } }))
        ]);
        const saved: string[] = [];
        for (const [index, reply] of replies.entries()) {
            if (reply.status() === 201) {
                saved.push(`Reply ${index}`);
            } else {
                await expectError(reply, 404, 'not_found');
            }
        }

        const stored = await listComments(author, path);
        if (deleted.status() === 204) {
            // Deleted before any reply was saved: the replies found nothing to attach to
            expect(saved).toEqual([]);
            expect(stored).toEqual([]);
        } else {
            // A reply was saved first: the thread stays, with every reply
            expect(deleted.status(), await deleted.text()).toBe(200);
            expect(saved).toHaveLength(repliers.length);
            expect(stored).toHaveLength(1);
            const [placeholder, ...rest] = stored[0]!.thread.items;
            expect(placeholder).toMatchObject({ id: comment.thread.items[0]!.id, deleted: true });
            expect(rest.map(item => item.text).sort()).toEqual(saved.sort());
        }
    }
});

test('unknown comments are not found', async ({ newVisitor }) => {
    const visitor = await newVisitor();
    await expectError(await visitor.patch('/api/comments/comment_missing', { data: { resolved: true } }), 404, 'not_found');
    await expectError(await visitor.delete('/api/comments/comment_missing'), 404, 'not_found');
    await expectError(await visitor.post('/api/comments/comment_missing/replies', { data: { text: 'Hello' } }), 404, 'not_found');

    const comment = await created(await createComment(visitor, uniquePagePath()));
    await expectError(await visitor.delete(`/api/comments/${comment.id}/replies/item_missing`), 404, 'not_found');
});

test('comments are listed per page (path), newest first', async ({ newVisitor }) => {
    const base = uniquePagePath();
    const visitor = await newVisitor();

    const first = await created(await createComment(visitor, `${base}/a`, { text: 'First' }));
    const second = await created(await createComment(visitor, `${base}/a/`, { text: 'Second', position: selectionPosition }));
    const other = await created(await createComment(visitor, `${base}/b?ref=mail#top`, { text: 'Other page' }));

    // Query string, hash and trailing slash are removed
    expect(second.path).toBe(`${base}/a`);
    expect(other.path).toBe(`${base}/b`);

    expect((await listComments(visitor, `${base}/a`)).map(c => c.id)).toEqual([second.id, first.id]);
    expect((await listComments(visitor, `${base}/a/?x=1`)).map(c => c.id)).toEqual([second.id, first.id]);
    expect((await listComments(visitor, `${base}/b`)).map(c => c.id)).toEqual([other.id]);
    expect(await listComments(visitor, `${base}/c`)).toEqual([]);

    await expectError(await visitor.get('/api/comments'), 400, 'invalid_request');
    await expectError(await visitor.get('/api/comments', { params: { path: 'no-leading-slash' } }), 400, 'invalid_request');
});

test('responses never contain author ids, IP hashes or device details', async ({ newVisitor }) => {
    const path = uniquePagePath();
    const author = await newVisitor({ ip: uniqueIp() });
    const other = await newVisitor({ ip: uniqueIp() });

    const createResponse = await createComment(author, path, {
        position: selectionPosition,
        quotedText: 'leaving comments',
        device: { size: 'mobile', windowSize: [390, 844], pixelRatio: 3, browser: 'Chrome', os: 'Android' }
    });
    const token = visitorCookie(createResponse)?.match(/^uier_visitor=([^;]+)/)?.[1];
    expect(token).toBeTruthy();
    const authorId = createHash('sha256').update(token!).digest('hex');

    const comment = await created(createResponse);
    expect(comment.device).toEqual({ size: 'mobile' });
    expect(comment.thread.items[0]).toMatchObject({ text: 'The heading could use a subtitle.', quotedText: 'leaving comments' });
    await created(await other.post(`/api/comments/${comment.id}/replies`, { data: { text: 'A reply' } }));

    const bodies = [
        JSON.stringify(comment),
        await (await author.get('/api/comments', { params: { path } })).text(),
        await (await other.get('/api/comments', { params: { path } })).text(),
        await (await author.patch(`/api/comments/${comment.id}`, { data: { resolved: true } })).text()
    ];
    for (const body of bodies) {
        for (const field of leakedFields) {
            expect(body).not.toContain(`"${field}"`);
        }
        expect(body).not.toContain(authorId);
        expect(body).not.toContain(token!);
        expect(body).not.toContain('Android');
    }
});

test('anonymous visitor cookie', async ({ newVisitor }) => {
    const path = uniquePagePath();
    const visitor = await newVisitor();

    // Reading never places a cookie, and nothing is "mine" without one
    const read = await visitor.get('/api/comments', { params: { path } });
    expect(read.headers()['cache-control']).toBe('no-store');
    expect(visitorCookie(read)).toBeUndefined();

    // Neither does a rejected write
    expect(visitorCookie(await createComment(visitor, path, { text: '' }))).toBeUndefined();

    // The first successful write does
    const first = await createComment(visitor, path);
    expect(first.status()).toBe(201);
    const cookie = visitorCookie(first);
    expect(cookie).toMatch(/^uier_visitor=[A-Za-z0-9_-]{43}; /);
    const attributes = cookie!.split('; ').slice(1);
    expect(attributes).toEqual(expect.arrayContaining(['Path=/', 'Max-Age=31536000', 'HttpOnly', 'SameSite=Lax']));
    // Not `Secure` on plain http://127.0.0.1 (local development and tests)
    expect(attributes).not.toContain('Secure');

    // Known visitors keep their identity
    const second = await createComment(visitor, path);
    expect(visitorCookie(second)).toBeUndefined();
    expect((await listComments(visitor, path)).map(comment => comment.isMine)).toEqual([true, true]);
    expect((await listComments(await newVisitor(), path)).map(comment => comment.isMine)).toEqual([false, false]);

    // Secure behind an HTTPS proxy
    const httpsVisitor = await newVisitor({ headers: { 'X-Forwarded-Proto': 'https' } });
    const httpsCookie = visitorCookie(await createComment(httpsVisitor, path));
    expect(httpsCookie?.split('; ')).toContain('Secure');
});

test('visitor: guest name and signing out', async ({ newVisitor }) => {
    const path = uniquePagePath();
    const visitor = await newVisitor();

    // No guest name before the first write, and asking for it doesn't create an identity
    const before = await visitor.get('/api/visitor');
    expect(before.status()).toBe(200);
    expect(before.headers()['cache-control']).toBe('no-store');
    expect(await before.json()).toEqual({ name: null });
    expect(visitorCookie(before)).toBeUndefined();

    const comment = await created(await createComment(visitor, path));
    expect(await (await visitor.get('/api/visitor')).json()).toEqual({ name: comment.thread.items[0]!.author.name });

    // Signing out removes the cookie; the comment stays but is no longer the visitor's
    const signOut = await visitor.delete('/api/visitor');
    expect(signOut.status()).toBe(204);
    expect(visitorCookie(signOut)?.split('; ')).toEqual(expect.arrayContaining(['uier_visitor=', 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax']));
    expect(await (await visitor.get('/api/visitor')).json()).toEqual({ name: null });
    expect((await listComments(visitor, path)).map(c => c.isMine)).toEqual([false]);

    // Signing out never creates an identity
    expect(visitorCookie(await visitor.delete('/api/visitor'))).toMatch(/^uier_visitor=; /);
    expect(await (await visitor.get('/api/visitor')).json()).toEqual({ name: null });

    // Other sites can't sign anyone out
    await expectError(await (await newVisitor({ headers: { Origin: 'https://evil.example' } })).delete('/api/visitor'), 403, 'forbidden');
});

test('writes must be same-origin JSON', async ({ newVisitor }) => {
    const path = uniquePagePath();
    const visitor = await newVisitor();
    const body = JSON.stringify({ path, position: pointPosition, text: 'Hello' });

    // Content types a cross-site form or `fetch` could send without a CORS preflight
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
        await expectError(await visitor.post('/api/comments', { headers: { 'Content-Type': contentType }, data: body }), 415, 'unsupported_media_type');
    }

    await expectError(await createComment(await newVisitor({ headers: { Origin: 'https://evil.example' } }), path), 403, 'forbidden');
    await expectError(await createComment(await newVisitor({ headers: { 'Sec-Fetch-Site': 'cross-site' } }), path), 403, 'forbidden');
    const comment = await created(await createComment(visitor, path));
    await expectError(await (await newVisitor({ headers: { Origin: 'null' } })).post(`/api/comments/${comment.id}/replies`, { data: { text: 'Hi' } }), 403, 'forbidden');

    // Same origin (the toolbar on this site)
    const origin = new URL(test.info().project.use.baseURL!).origin;
    await created(await createComment(await newVisitor({ headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin' } }), path));
    expect(await listComments(visitor, path)).toHaveLength(2);
});

test('requests are validated', async ({ newVisitor }) => {
    const path = uniquePagePath();
    const visitor = await newVisitor();

    const invalidComments: Record<string, unknown>[] = [
        { text: '' },
        { text: '   ' },
        { text: 'x'.repeat(1001) },
        { text: 42 },
        { quotedText: 'x'.repeat(1001) },
        { path: 'relative/path' },
        { path: `/${'x'.repeat(512)}` },
        { position: { ...pointPosition, xNormal: 1.5 } },
        { position: { ...pointPosition, yNormal: '0.5' } },
        { text: '\u200b\u2060' },
        { text: '\u3164' },
        { text: '\u202e' },
        { position: { ...pointPosition, selector: 'x'.repeat(1025) } },
        // Selectors the toolbar never creates (and some no browser can parse)
        { position: { ...pointPosition, selector: 'main))((' } },
        { position: { ...pointPosition, selector: 'main h1' } },
        { position: { ...pointPosition, selector: '#1abc' } },
        { position: { ...pointPosition, selector: 'a[href^="javascript"]' } },
        { position: { ...pointPosition, selector: 'main>h1,' } },
        { position: { ...selectionPosition, endSelector: 'p:has(a)' } },
        { position: { ...selectionPosition, startOffset: 1.5 } },
        { position: { ...selectionPosition, text: 'x'.repeat(2001) } },
        { position: { type: 'area' } },
        { device: { windowSize: [390] } },
        { device: { pixelRatio: 11 } },
        { device: { browser: 'x'.repeat(65) } }
    ];
    for (const data of invalidComments) {
        await expectError(await createComment(visitor, path, data), 400, 'invalid_request');
    }

    // Body that is not JSON
    await expectError(await visitor.post('/api/comments', { headers: { 'Content-Type': 'application/json' }, data: '{"path":' }), 400, 'invalid_request');
    // Bodies above 16 KB
    await expectError(await createComment(visitor, path, { text: 'x'.repeat(17 * 1024) }), 413, 'too_large');

    const comment = await created(await createComment(visitor, path, { text: 'x'.repeat(1000) }));
    await expectError(await visitor.post(`/api/comments/${comment.id}/replies`, { data: { text: 'x'.repeat(1001) } }), 400, 'invalid_request');
    await expectError(await visitor.patch(`/api/comments/${comment.id}`, { data: { resolved: 'yes' } }), 400, 'invalid_request');

    // Unknown fields are ignored; ids, authors and state are set by the server
    const forged = await created(await createComment(visitor, path, {
        id: 'comment_forged',
        authorId: 'someone-else',
        resolved: true,
        isMine: false,
        extra: 'ignored',
        thread: { items: [{ id: 'item_forged', text: 'Forged' }] }
    }));
    expect(forged.id).not.toBe('comment_forged');
    expect(forged).toMatchObject({ resolved: false, isMine: true });
    expect(forged.thread.items.map(item => item.text)).toEqual(['The heading could use a subtitle.']);
    expect(Object.keys(forged).sort()).toEqual(commentKeys);
    expect(await listComments(visitor, path)).toHaveLength(2);
});

test('concurrent replies are all kept', async ({ newVisitor }) => {
    const path = uniquePagePath();
    const author = await newVisitor();
    const comment = await created(await createComment(author, path));

    const repliers = await Promise.all(Array.from({ length: 20 }, () => newVisitor()));
    await Promise.all(repliers.map(async (replier, index) =>
        await created(await replier.post(`/api/comments/${comment.id}/replies`, { data: { text: `Reply ${index}` } }))));

    const [stored] = await listComments(author, path);
    expect(stored!.thread.items.map(item => item.text).sort()).toEqual(['The heading could use a subtitle.', ...repliers.map((_, index) => `Reply ${index}`)].sort());
});

test('a thread holds at most 50 messages', async ({ newVisitor }) => {
    const author = await newVisitor();
    const comment = await created(await createComment(author, uniquePagePath()));
    // Two repliers, each below their own limit of 30 replies an hour
    const repliers = [await newVisitor(), await newVisitor()];
    for (let i = 0; i < 49; i++) {
        await created(await repliers[i % 2]!.post(`/api/comments/${comment.id}/replies`, { data: { text: `Reply ${i}` } }));
    }
    const full = await expectError(await author.post(`/api/comments/${comment.id}/replies`, { data: { text: 'One more' } }), 400, 'invalid_request');
    expect(full.message).toContain('full');
});

test.describe('rate limits', () => {
    async function expectRateLimited(response: APIResponse, reason: 'too_fast' | 'page_full' = 'too_fast') {
        const body = await expectError(response, 429, 'rate_limited');
        expect(body.reason).toBe(reason);
        expect(Number(response.headers()['retry-after'])).toBeGreaterThan(0);
    }

    test('10 new comments per visitor and hour', async ({ newVisitor }) => {
        const path = uniquePagePath();
        const visitor = await newVisitor();
        for (let i = 0; i < 10; i++) {
            await created(await createComment(visitor, path, { text: `Comment ${i}` }));
        }
        await expectRateLimited(await createComment(visitor, uniquePagePath()));

        // Other visitors are not affected
        await created(await createComment(await newVisitor(), path));
    });

    test('30 replies per visitor and hour', async ({ newVisitor }) => {
        const author = await newVisitor();
        const comment = await created(await createComment(author, uniquePagePath()));
        const replier = await newVisitor();
        for (let i = 0; i < 30; i++) {
            await created(await replier.post(`/api/comments/${comment.id}/replies`, { data: { text: `Reply ${i}` } }));
        }
        await expectRateLimited(await replier.post(`/api/comments/${comment.id}/replies`, { data: { text: 'One more' } }));
    });

    test('30 writes per IP and hour', async ({ newVisitor }) => {
        const ip = uniqueIp();
        const path = uniquePagePath();
        // 3 visitors (new cookies) from the same IP: 10 comments each
        for (let v = 0; v < 3; v++) {
            const visitor = await newVisitor({ ip });
            for (let i = 0; i < 10; i++) {
                await created(await createComment(visitor, path, { text: `Comment ${v}.${i}` }));
            }
        }

        const fresh = await newVisitor({ ip });
        await expectRateLimited(await createComment(fresh, path));
        const [comment] = await listComments(fresh, path);
        await expectRateLimited(await fresh.post(`/api/comments/${comment!.id}/replies`, { data: { text: 'Reply' } }));

        // Another IP is not affected
        await created(await createComment(await newVisitor({ ip: uniqueIp() }), path));
    });

    test('30 writes per IPv6 /64 and hour', async ({ newVisitor }) => {
        const address = uniqueIpv6Network();
        const path = uniquePagePath();
        // 3 visitors, each from its own address in the same /64: 10 comments each
        for (let v = 0; v < 3; v++) {
            const visitor = await newVisitor({ ip: address(v) });
            for (let i = 0; i < 10; i++) {
                await created(await createComment(visitor, path, { text: `Comment ${v}.${i}` }));
            }
        }

        await expectRateLimited(await createComment(await newVisitor({ ip: address(3) }), path));
        // IPv4-mapped addresses count as IPv4
        await created(await createComment(await newVisitor({ ip: `::ffff:${uniqueIp()}` }), path));
    });

    test('100 new comments per page and day', async ({ newVisitor }) => {
        const path = uniquePagePath();
        // 10 visitors x 10 comments (each visitor's own limit)
        await Promise.all(Array.from({ length: 10 }, async (_, v) => {
            const visitor = await newVisitor();
            for (let i = 0; i < 10; i++) {
                await created(await createComment(visitor, path, { text: `Comment ${v}.${i}` }));
            }
        }));

        const latecomer = await newVisitor();
        await expectRateLimited(await createComment(latecomer, path), 'page_full');
        // Replies and other pages are not affected
        const [comment] = await listComments(latecomer, path);
        await created(await latecomer.post(`/api/comments/${comment!.id}/replies`, { data: { text: 'Reply' } }));
        await created(await createComment(latecomer, uniquePagePath()));
    });
});
