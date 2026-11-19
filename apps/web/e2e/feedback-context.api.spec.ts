import { persistProjectAccess } from './support/projectAccess';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { feedbackMarkdown } from '@uier/toolbar/feedback-context';
import { docToMarkdown, markdownToDoc } from '@uier/toolbar/editor';
import { markdownPlainText } from '@uier/toolbar/markdown';
import { screenshotDocumentId, type DbComment } from '../src/lib/db/schema';
import { memberId, userPk, workspacePk, type DbMember, type DbProject, type DbUser } from '../src/lib/app/model';
import { getAppStore, updateDoc } from '../src/lib/app/store';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { projectFeedbackExport } from '../src/lib/review/feedbackContext';
import { editProjectCommentItem, editProjectCommentText } from '../src/lib/review/comments';
import { PUBLIC_PROJECT_ID } from '../src/lib/comments/publicProject';
import { pngImage } from './support/images';

test('public change proposals persist without a note, participate in retries, and are removed with the first message', async ({ request, playwright, baseURL }) => {
    const proposal = { styles: { 'padding-left': { original: '4px', proposed: '12px' }, color: { original: 'rgb(0, 0, 0)', proposed: '#123' } } };
    const position = { type: 'point', selector: '#hero>li:nth-of-type(1)', xNormal: 0.5, yNormal: 0.5, proposalLabelHash: 'v1-0123456789abcdef' };
    const input = { path: `/change-${randomUUID()}`, position, proposal, idempotencyKey: randomUUID() };
    const response = await request.post('/api/comments', { data: input });
    expect(response.status(), await response.text()).toBe(201);
    const saved = await response.json();
    expect(saved.proposal).toEqual(proposal);
    expect(saved.position).toEqual(position);
    expect(saved.thread.items[0].text).toBe('Suggested change');
    const retry = await request.post('/api/comments', { data: { ...input, text: '' } });
    expect(retry.status()).toBe(201);
    expect((await retry.json()).id).toBe(saved.id);
    const conflict = await request.post('/api/comments', { data: { ...input, proposal: { styles: { color: { original: '#123', proposed: '#234' } } } } });
    expect(conflict.status()).toBe(409);

    const url = `/api/comments/${saved.id}`;
    expect(await (await request.get(url)).json()).toMatchObject({ proposal, position });
    expect(await (await request.get(`/api/comments?path=${input.path}`)).json()).toEqual([expect.objectContaining({ id: saved.id, proposal })]);
    const packet = await (await request.get(`${url}/context`)).json();
    expect(packet.context.proposal).toEqual(proposal);
    expect(JSON.stringify(packet)).not.toContain(position.proposalLabelHash);
    expect(packet.markdown).toContain('Original CSS:\n\n```text\ncolor: rgb(0, 0, 0);\npadding-left: 4px;\n```');
    expect(packet.markdown).toContain('Proposed CSS:\n\n```text\ncolor: #123;\npadding-left: 12px;\n```');
    const message = saved.thread.items[0];
    const note = await request.patch(`${url}/replies/${message.id}`, { data: { text: 'Leave room for the label.', expectedText: message.text } });
    expect(note.status()).toBe(200);
    expect((await note.json()).proposal).toEqual(proposal);
    const moved = await request.patch(`${url}/anchor`, { data: { path: input.path, expectedRevision: null,
        position: { ...position, selector: '#hero>li:nth-of-type(2)' } } });
    expect(moved.status(), await moved.text()).toBe(200);

    const stranger = await playwright.request.newContext({ baseURL });
    try {
        expect((await stranger.post(`${url}/replies`, { data: { text: 'I will make the change.' } })).status()).toBe(201);
        const deleted = await request.delete(url);
        expect(deleted.status()).toBe(200);
        const remaining = await deleted.json();
        expect(remaining).not.toHaveProperty('proposal');
        expect(remaining.position.selector).toBe('#hero>li:nth-of-type(2)');
        expect(JSON.stringify(remaining)).not.toContain(position.proposalLabelHash);
        const redacted = await (await stranger.get(`${url}/context`)).json();
        expect(redacted.context.feedback.deleted).toBe(true);
        expect(redacted.context).not.toHaveProperty('proposal');
        expect(redacted.markdown).not.toContain('12px');
    } finally { await stranger.dispose(); }
});

test('public proposal validation rejects unsafe or empty changes and preserves literal text in rewrites', async ({ request }) => {
    const point = { type: 'point', selector: '#title', xNormal: 0.5, yNormal: 0.5 };
    const input = { path: `/proposal-validation-${randomUUID()}`, position: point, text: 'Change this' };
    const pair = (proposed: string) => ({ original: '#111', proposed });
    const invalid = [
        { styles: {} },
        { styles: { 'background-image': pair('none') } },
        { styles: { color: pair('url(https://example.test/pixel)') } },
        { styles: { color: pair('var(--secret)') } },
        { styles: { color: pair('#FFF; display: none') } },
        { styles: { color: pair('#111') } },
        { styles: { 'font-weight': { original: '400', proposed: '1001' } } },
        { styles: { 'font-size': { original: '16px', proposed: '9'.repeat(129) } } },
        { text: { original: 'Original', proposed: 'X'.repeat(1001) }, styles: {} },
        { text: { original: 'Original', proposed: '\u202eReordered' }, styles: {} },
        { text: { original: 'Original', proposed: 'Changed', html: '<p>Changed</p>' }, styles: {} },
        JSON.parse('{"styles":{"__proto__":{"original":"4px","proposed":"8px"}}}')
    ];
    for (const proposal of invalid) {
        const response = await request.post('/api/comments', { data: { ...input, proposal } });
        expect(response.status(), JSON.stringify(proposal)).toBe(400);
        expect((await response.json()).error).toBe('invalid_request');
    }
    const text = { original: 'Original text', proposed: 'Keep this literal\n````\n<x> @team' };
    const proposal = { text, styles: {} };
    for (const body of [
        { ...input, position: { ...point, widthNormal: 0.1, heightNormal: 0.1 }, proposal },
        { ...input, kind: 'feedback', position: { type: 'page' }, proposal },
        { ...input, text: '' }
    ]) expect((await request.post('/api/comments', { data: body })).status()).toBe(400);

    // The editor displays a code block with the fence inside it still visible as text.
    const markdown = docToMarkdown(markdownToDoc('`````text\n' + text.proposed + '\n`````')).text;
    expect(markdownPlainText(markdown)).toBe(text.proposed);
    const rewrite = {
        ...input, kind: 'rewrite', text: markdown, proposal,
        position: { type: 'text', text: text.original, startSelector: '#title', startOffset: 0, startType: 'text', endOffset: 13, endType: 'text' }
    };
    for (const data of [
        { ...rewrite, text: 'A different replacement' },
        { ...rewrite, quotedText: 'A different quoted original' },
        { ...rewrite, position: { ...rewrite.position, text: 'A different selection' } }
    ]) expect((await request.post('/api/comments', { data })).status()).toBe(400);
    const response = await request.post('/api/comments', { data: rewrite });
    expect(response.status(), await response.text()).toBe(201);
    const saved = await response.json();
    expect(saved.proposal).toEqual(proposal);
    expect(saved.thread.items[0]).toMatchObject({ text: markdown, quotedText: text.original });
    const packet = await (await request.get(`/api/comments/${saved.id}/context`)).json();
    expect(packet.context.proposal).toEqual(proposal);
    expect(packet.markdown).toContain('Proposed text:\n\n`````text\n' + text.proposed + '\n`````');
    const editedLiteral = 'Keep **stars** and [link](https://example.test) literally\n```';
    const editedMarkdown = docToMarkdown(markdownToDoc('````text\n' + editedLiteral + '\n````')).text;
    const edit = await request.patch(`/api/comments/${saved.id}/replies/${saved.thread.items[0].id}`, {
        data: { text: editedMarkdown, expectedText: markdown }
    });
    expect(edit.status(), await edit.text()).toBe(200);
    expect((await edit.json()).proposal.text).toEqual({ original: text.original, proposed: editedLiteral });
    expect((await (await request.get(`/api/comments/${saved.id}/context`)).json()).context.proposal.text.proposed).toBe(editedLiteral);
});

test('public rewrite edits keep the proposal and exported copy in sync', async ({ request, playwright, baseURL }) => {
    const original = 'Book a table';
    const styles = { 'padding-left': { original: '4px', proposed: '12px' } };
    const position = { type: 'text', text: original, startSelector: '#title', startOffset: 0, startType: 'text', endOffset: original.length, endType: 'text' };
    const firstMarkdown = '**Reserve** a table';
    const input = { path: `/edit-rewrite-${randomUUID()}`, kind: 'rewrite', text: firstMarkdown, position };
    const proposal = { text: { original, proposed: 'Reserve a table' }, styles };
    const created = await request.post('/api/comments', { data: { ...input, proposal } });
    expect(created.status(), await created.text()).toBe(201);
    const saved = await created.json();
    const url = `/api/comments/${saved.id}`;
    const editUrl = `${url}/replies/${saved.thread.items[0].id}`;
    const nextText = 'Find a **seat** [today](https://example.test)';
    const stranger = await playwright.request.newContext({ baseURL });
    try {
        expect((await stranger.patch(editUrl, { data: { text: nextText, expectedText: firstMarkdown } })).status()).toBe(403);
        for (const invalid of [original, '---']) {
            expect((await request.patch(editUrl, { data: { text: invalid, expectedText: firstMarkdown } })).status()).toBe(400);
        }
        const edit = await request.patch(editUrl, { data: { text: nextText, expectedText: firstMarkdown } });
        expect(edit.status(), await edit.text()).toBe(200);
        const updated = { text: { original, proposed: 'Find a seat today' }, styles };
        const body = await edit.json();
        expect(body.proposal).toEqual(updated);
        expect(body.thread.items[0]).toMatchObject({ text: nextText, quotedText: original });
        expect((await request.patch(editUrl, { data: { text: 'Stale change', expectedText: firstMarkdown } })).status()).toBe(409);
        const reply = await request.post(`${url}/replies`, { data: { text: 'A reply' } });
        const replyItem = (await reply.json()).thread.items[1];
        expect((await (await request.patch(`${url}/replies/${replyItem.id}`, { data: { text: 'Edited reply', expectedText: replyItem.text } })).json()).proposal).toEqual(updated);
        const formatOnly = await request.patch(editUrl, { data: { text: 'Find a *seat* today', expectedText: nextText } });
        expect(formatOnly.status(), await formatOnly.text()).toBe(200);
        expect((await formatOnly.json()).proposal).toEqual(updated);
        expect((await (await request.get(url)).json()).proposal).toEqual(updated);
        const packet = await (await request.get(`${url}/context`)).json();
        expect(packet.context.proposal).toEqual(updated);
        expect(packet.markdown).toContain('Proposed text:\n\n```text\nFind a seat today\n```');
        expect(packet.markdown).not.toContain('Reserve a table');
        const legacy = await (await request.post('/api/comments', { data: { ...input, quotedText: original } })).json();
        const legacyEdit = await request.patch(`/api/comments/${legacy.id}/replies/${legacy.thread.items[0].id}`, {
            data: { text: original, expectedText: firstMarkdown }
        });
        expect(legacyEdit.status()).toBe(200);
        expect(await legacyEdit.json()).not.toHaveProperty('proposal');
    } finally {
        await stranger.dispose();
    }
});

test('project toolbar and app edits update saved rewrites and authorized exports', async () => {
    const previous = process.env.UIER_LOCAL;
    process.env.UIER_LOCAL = '1';
    try {
        const origin = 'https://preview.example';
        const project = { id: `proposal-edit-${randomUUID()}`, urls: [origin] } as DbProject;
        await persistProjectAccess(project);
        const store = getMemoryCommentsStore();
        const original = 'Book a table';
        const styles = { 'font-weight': { original: '400', proposed: '600' } };
        const comment: DbComment = {
            id: 'comment_rewrite', domain: `project:${project.id}`, path: '/pricing', origin,
            authorId: 'guest-owner', kind: 'rewrite', private: true,
            position: { type: 'text', text: original, startSelector: '#title', startOffset: 0, startType: 'text', endOffset: original.length, endType: 'text' },
            proposal: { text: { original, proposed: 'Outdated projection' }, styles },
            thread: { items: [{ id: 'item_first', text: '**Reserve** a table', quotedText: original, authorId: 'guest-owner' }] }
        };
        await store.create(comment);
        const guest = { kind: 'guest', visitorId: 'guest-owner' } as const;
        const admin = { kind: 'member', userId: 'admin', name: 'Admin', isAdmin: true } as const;
        const outsider = { kind: 'guest', visitorId: 'outsider' } as const;
        const base = 'https://uier.example';
        const packet = () => projectFeedbackExport(project, guest, comment.id, origin, base);
        expect((await packet()).context.proposal).toEqual({ text: { original, proposed: 'Reserve a table' }, styles });
        await expect(projectFeedbackExport(project, outsider, comment.id, origin, base)).rejects.toMatchObject({ code: 'not_found' });
        const edited = await editProjectCommentItem(project, guest, comment.id, 'item_first', { text: '**Choose** a table', expectedText: '**Reserve** a table' });
        expect(edited.proposal).toEqual({ text: { original, proposed: 'Choose a table' }, styles });
        await expect(editProjectCommentItem(project, guest, comment.id, 'item_first', { text: 'Stale edit', expectedText: '**Reserve** a table' })).rejects.toMatchObject({ code: 'conflict' });
        const appEdit = await editProjectCommentText(project, admin, comment.id, 'Pick a `table`');
        expect(appEdit.proposal).toEqual({ text: { original, proposed: 'Pick a table' }, styles });
        expect((await packet()).context.proposal).toEqual(appEdit.proposal);
        expect((await packet()).markdown).toContain('Proposed text:\n\n```text\nPick a table\n```');
    } finally {
        if (previous === undefined) delete process.env.UIER_LOCAL;
        else process.env.UIER_LOCAL = previous;
    }
});

test('public exports include protected reply images when the original comment has no screenshot', async ({ request }) => {
    const response = await request.post('/api/comments', { data: { path: `/reply-image-${randomUUID()}`, kind: 'feedback', position: { type: 'page' }, text: 'See the redesign in my reply' } });
    expect(response.status(), await response.text()).toBe(201);
    const saved = await response.json();
    const replied = await request.post(`/api/comments/${saved.id}/replies`, { data: { text: 'Redesign variant', screenshot: pngImage } });
    expect(replied.status()).toBe(201);
    const reply = (await replied.json()).thread.items.at(-1);
    const packet = await (await request.get(`/api/comments/${saved.id}/context`)).json();
    expect(packet.context.screenshot).toEqual({ state: 'unavailable' });
    expect(packet.context.discussion[0]).toMatchObject({ id: reply.id, screenshot: { state: 'protected', width: 3, height: 2 } });
    expect(packet.context.discussion[0].screenshot.url).toContain(`/api/comments/${saved.id}/replies/${reply.id}/screenshot`);
    expect((await request.get(packet.context.discussion[0].screenshot.url)).status()).toBe(200);
    expect(packet.markdown).toContain('[Reply image]');
    expect(packet.markdown).not.toContain('data:image');
    await request.delete(`/api/comments/${saved.id}/replies/${reply.id}`);
    const deleted = await (await request.get(`/api/comments/${saved.id}/context`)).json();
    expect(deleted.context.discussion[0]?.screenshot).toBeUndefined();
    expect(deleted.markdown).not.toContain('[Reply image]');
});

test('public exports preserve exact saved element/text/page/rewrite feedback and discussion without private metadata', async ({ request }) => {
    const text = 'Please keep *this* exact.\n```\n[link](https://example.com)\n````';
    const positions = [
        { type: 'point', selector: '#hero', xNormal: 0.5, yNormal: 0.3 },
        { type: 'text', text: 'Original\nselected copy', startSelector: 'h1', startOffset: 0, startType: 'text', endOffset: 12, endType: 'text' },
        { type: 'page' },
        { type: 'text', text: 'Old headline', startSelector: 'h1', startOffset: 0, startType: 'text', endOffset: 12, endType: 'text' },
        { type: 'point', selector: '#hero', xNormal: 0.1, yNormal: 0.2, widthNormal: 0.5, heightNormal: 0.25 },
        { type: 'point', selector: '#account-menu>button:nth-of-type(2)', xNormal: 0.5, yNormal: 0.5, layer: { opener: '#account', label: 'Account' } }
    ];
    for (const [index, position] of positions.entries()) {
        const response = await request.post('/api/comments', { data: {
            path: `/packet-${randomUUID()}`, position, text, kind: index === 3 ? 'rewrite' : index === 2 ? 'bug' : 'comment',
            ...(index === 3 ? { quotedText: 'Old headline' } : {}), ...(index === 0 ? { screenshot: pngImage } : {}),
            device: { size: 'desktop', windowSize: [1280, 720], browser: 'Private browser', os: 'Private OS', pixelRatio: 2, capturedAt: '2026-10-25T10:00:00.000Z' }
        } });
        expect(response.status()).toBe(201);
        const saved = await response.json();
        await request.post(`/api/comments/${saved.id}/replies`, { data: { text: 'Discussion\n*kept*' } });
        const exported = await request.get(`/api/comments/${saved.id}/context?uier-token=do-not-export&token=secret`);
        expect(exported.status()).toBe(200);
        expect(exported.headers()['cache-control']).toContain('no-store');
        const packet = await exported.json();
        expect(packet).toEqual(await (await request.get(`/api/comments/${saved.id}/context`)).json());
        expect(packet.context.identity).toMatchObject({ projectId: PUBLIC_PROJECT_ID, commentId: saved.id, itemId: saved.thread.items[0].id });
        expect(packet.markdown).toContain(`Project: \` ${PUBLIC_PROJECT_ID} \``);
        expect(packet.context.feedback.text).toBe(saved.thread.items[0].text);
        expect(packet.context.discussion[0].text).toBe('Discussion\n*kept*');
        expect(packet.markdown).toContain(`\n${text}\n`);
        expect(packet.markdown).toContain('`````text');
        expect(packet.context.reproduction).toEqual({ device: 'desktop', windowSize: [1280, 720] });
        expect(JSON.stringify(packet)).not.toMatch(/Private browser|Private OS|do-not-export|secret/);
        // Check field names; a random comment/item id may legitimately contain words such as ttl.
        expect(JSON.stringify(packet.context)).not.toMatch(/"(?:capturedAt|pixelRatio|authorId|actorId|isMe|ttl)"\s*:/);
        expect(packet.markdown).toBe(feedbackMarkdown(packet.context));
        if (index === 3) {
            expect(packet.context.feedback.quotedText).toBe('Old headline');
            expect(packet.markdown).toContain('Suggested rewrite (not original page copy)');
            expect(packet.markdown).toContain('Quoted original text:');
        }
        if (index === 4) {
            expect(packet.context.anchor).toEqual({ type: 'point', selector: '#hero', area: { x: 0.1, y: 0.2, width: 0.5, height: 0.25 } });
            expect(packet.markdown).toContain('Anchor: Area of an element');
            expect(packet.markdown).toContain('Area within the element: 10% from the left, 20% from the top, 50% wide, 25% tall');
        }
        if (index === 5) {
            // In a menu: the button that opens it, for reproducing the anchor
            expect(packet.context.anchor).toEqual({ type: 'point', selector: '#account-menu>button:nth-of-type(2)', opener: { selector: '#account', label: 'Account' } });
            expect(packet.markdown).toContain('In a menu, popover or dialog: open it first with ` Account `.');
            expect(packet.markdown).toContain('Opener selector (may no longer match):\n\n```text\n#account\n```');
        }
        if (index === 0) {
            expect(packet.context.screenshot.state).toBe('protected');
            expect(packet.markdown).toContain('Private images cannot be viewed outside uier');
            expect((await request.get(packet.context.screenshot.url)).status()).toBe(200);
            expect(packet.markdown).not.toContain('data:image');
        } else expect(packet.context.screenshot.state).toBe('unavailable');
    }
});

test('isolated local feedback does not claim to belong to the uier project', async ({ playwright, baseURL }) => {
    const visitor = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Host: `packet-${randomUUID()}.localhost` } });
    try {
        const response = await visitor.post('/api/comments', { data: { path: '/', kind: 'feedback', position: { type: 'page' }, text: 'Local feedback' } });
        expect(response.status(), await response.text()).toBe(201);
        const saved = await response.json();
        const packet = await (await visitor.get(`/api/comments/${saved.id}/context`)).json();
        expect(packet.context.identity).not.toHaveProperty('projectId');
        expect(packet.markdown).not.toContain('Project:');
    } finally { await visitor.dispose(); }
});

test('deleted first messages omit old quote/anchor/device/image and missing threads fail freshly', async ({ request, playwright, baseURL }) => {
    const created = await request.post('/api/comments', { data: {
        path: `/deleted-${randomUUID()}`, position: { type: 'text', text: 'Secret old quote', startSelector: 'h1', startOffset: 0, startType: 'text', endOffset: 6, endType: 'text' },
        text: 'Removed text', quotedText: 'Removed quotation', screenshot: pngImage, device: { windowSize: [1280, 720] }
    } });
    const saved = await created.json();
    const stranger = await playwright.request.newContext({ baseURL });
    try {
        await stranger.post(`/api/comments/${saved.id}/replies`, { data: { text: 'Retained reply' } });
        await request.delete(`/api/comments/${saved.id}`);
        const packet = await (await request.get(`/api/comments/${saved.id}/context`)).json();
        expect(packet.context.feedback.deleted).toBe(true);
        expect(packet.context.anchor).toEqual({ type: 'text' });
        expect(packet.context.reproduction).toEqual({});
        expect(packet.context.screenshot.state).toBe('unavailable');
        expect(JSON.stringify(packet)).not.toMatch(/Removed text|Removed quotation|Secret old quote|1280/);
        expect(packet.context.discussion[0].text).toBe('Retained reply');
    } finally { await stranger.dispose(); }
    expect((await request.get('/api/comments/comment_missing/context')).status()).toBe(404);
    expect((await request.get('/api/comments/%24sequence_comments/context')).status()).toBe(404);
});

test('project export enforces private visibility, original allowed source and member-only browser context', async () => {
    const previous = process.env.UIER_LOCAL;
    process.env.UIER_LOCAL = '1';
    try {
        const origin = 'https://preview.example';
        const otherOrigin = 'https://production.example';
        const project = { id: `packet-${randomUUID()}`, urls: [otherOrigin, origin], environments: [{ origin, label: 'Preview' }] } as DbProject;
        const store = getMemoryCommentsStore();
        const comment: DbComment = {
            id: 'comment_packet', domain: `project:${project.id}`, origin, path: '/pricing?plan=team&token=secret&uier-token=proof#/details?plan=team&auth=hidden', pageStateVersion: 1,
            position: { type: 'point', selector: '#price', xNormal: 0.5, yNormal: 0.5 }, private: true, authorId: 'guest-owner',
            device: { browser: 'Original Browser', os: 'Original OS', windowSize: [800, 600], pixelRatio: 2, capturedAt: '2026-10-25T10:00:00.000Z' },
            screenshot: { contentType: 'image/png', width: 3, height: 2, bytes: 100 },
            thread: { items: [{ id: 'item_first', text: 'Saved feedback', authorId: 'guest-owner', authorName: 'Reviewer' },
                { id: 'item_reply', text: 'Redesign variant', authorId: 'guest-owner', authorName: 'Reviewer', screenshot: { contentType: 'image/png', width: 3, height: 2, bytes: 100 } }] }
        };
        await store.create(comment);
        const admin = { kind: 'member', userId: 'admin', name: 'Admin', isAdmin: true } as const;
        const guest = { kind: 'guest', visitorId: 'guest-owner' } as const;
        const base = 'https://uier.example';
        for (const actor of [{ kind: 'guest', visitorId: 'stranger' } as const, { ...admin, isAdmin: false }])
            await expect(projectFeedbackExport(project, actor, comment.id, origin, base)).rejects.toMatchObject({ code: 'not_found' });
        const memberPacket = await projectFeedbackExport(project, admin, comment.id, undefined, base);
        expect(memberPacket.context.reproduction).toMatchObject({ browser: 'Original Browser', os: 'Original OS', windowSize: [800, 600], pixelRatio: 2 });
        expect(memberPacket.context.links.page).toBe(`${origin}/pricing?plan=team#/details?plan=team`);
        expect(memberPacket.context.links.comment).toContain('/app/review/');
        expect(memberPacket.context.source.environment).toBe('Preview');
        expect(JSON.stringify(memberPacket)).not.toMatch(/secret|proof|hidden|uier-token|authorId|guest-owner/);
        // Metadata exists but the actual image is gone: report unavailable, never a broken promise.
        expect(memberPacket.context.screenshot.state).toBe('unavailable');
        expect(memberPacket.context.discussion[0]?.screenshot).toBeUndefined();
        const guestPacket = await projectFeedbackExport(project, guest, comment.id, origin, base);
        expect(guestPacket.context.reproduction).toEqual({ windowSize: [800, 600] });
        expect(guestPacket.context.source.environment).toBe('Preview');
        expect(guestPacket.context.links.comment).toContain(`${origin}/pricing?plan=team&review=true&uier-comment=comment_packet`);
        expect(JSON.stringify(guestPacket)).not.toMatch(/Original Browser|Original OS|pixelRatio|capturedAt/);
        await store.createScreenshot({ ...comment.screenshot!, type: 'screenshot', id: screenshotDocumentId(comment.id),
            domain: comment.domain, commentId: comment.id, data: pngImage.split(',')[1]!, createdAt: new Date().toISOString() });
        await store.createScreenshot({ ...comment.screenshot!, type: 'screenshot', id: screenshotDocumentId(comment.id, 'item_reply'),
            domain: comment.domain, commentId: comment.id, data: pngImage.split(',')[1]!, createdAt: new Date().toISOString() });
        const publicId = 'V1StGXR8_Z5jdHi6B-myT';
        const withImage = await projectFeedbackExport({ ...project, publicId }, guest, comment.id, origin, base);
        expect(withImage.context.screenshot).toMatchObject({ state: 'protected',
            url: `${base}/api/review/${publicId}/comments/${comment.id}/screenshot` });
        expect(withImage.context.discussion[0]?.screenshot?.url).toBe(`${base}/api/review/${publicId}/comments/${comment.id}/replies/item_reply/screenshot`);
        const memberImage = await projectFeedbackExport(project, admin, comment.id, undefined, base);
        expect(memberImage.context.discussion[0]?.screenshot?.url).toBe(`${base}/app/projects/${project.id}/comments/${comment.id}/replies/item_reply/screenshot`);
        expect((await projectFeedbackExport(project, guest, comment.id, otherOrigin, base)).context.links).toEqual({ page: undefined, comment: undefined });
        const removed = await projectFeedbackExport({ ...project, urls: [otherOrigin] }, admin, comment.id, undefined, base);
        expect(removed.context.links.page).toBeUndefined();
        expect(removed.context.links.comment).toBeUndefined();
        expect(removed.context.source.origin).toBeUndefined();
        expect(removed.context.source.environment).toBe('Removed address');
        expect((await projectFeedbackExport(project, guest, comment.id, otherOrigin, base)).context.source.environment).toBeUndefined();
        await expect(projectFeedbackExport(project, admin, 'comment_missing', undefined, base)).rejects.toMatchObject({ code: 'not_found' });
        await expect(projectFeedbackExport({ ...project, id: 'another-project' }, admin, comment.id, undefined, base)).rejects.toMatchObject({ code: 'not_found' });
    } finally {
        if (previous === undefined) delete process.env.UIER_LOCAL;
        else process.env.UIER_LOCAL = previous;
    }
});

test('assignment export resolves a current project member name without exposing its account identity', async () => {
    const previous = process.env.UIER_LOCAL;
    process.env.UIER_LOCAL = '1';
    try {
        const id = randomUUID(); const workspaceId = `workspace-${id}`; const assigneeId = `u_${id}`;
        const app = getAppStore(); const comments = getMemoryCommentsStore();
        const project = { id, workspaceId, pk: workspacePk(workspaceId), urls: ['https://review.example'] } as DbProject;
        await persistProjectAccess(project, []);
        await app.create<DbUser>({ type: 'user', pk: userPk(assigneeId), id: assigneeId, email: `${id}@example.com`,
            name: 'Reviewer *name*', createdAt: '2026-10-28', updatedAt: '2026-10-28' });
        await app.create<DbMember>({ type: 'member', pk: project.pk, id: memberId(assigneeId), workspaceId,
            userId: assigneeId, email: `${id}@example.com`, role: 'commenter', projects: [id], createdAt: '2026-10-28' });
        const source: DbComment = { id: `comment_${id}`, domain: `project:${id}`, projectId: id, origin: project.urls[0], path: '/',
            assigneeId, authorId: 'guest', kind: 'feedback', position: { type: 'page' },
            thread: { items: [{ id: 'item_first', text: 'Feedback', authorId: 'guest', authorName: 'Guest' }] } };
        await comments.create(source);
        const actor = { kind: 'member', userId: 'admin', name: 'Admin', isAdmin: true } as const;
        const exported = await projectFeedbackExport(project, actor, source.id, undefined, 'https://uier.io');
        expect(exported.context.assignee).toEqual({ name: 'Reviewer *name*' });
        expect(exported.markdown).toContain('Assignee: ` Reviewer *name* `');
        expect(JSON.stringify(exported)).not.toContain(assigneeId);
        const guest = await projectFeedbackExport(project, { kind: 'guest', visitorId: 'guest' }, source.id, project.urls[0], 'https://uier.io');
        expect(guest.context).not.toHaveProperty('assignee');
        await updateDoc<DbMember>(project.pk, memberId(assigneeId), current => ({ ...current, projects: [] }));
        expect((await projectFeedbackExport(project, actor, source.id, undefined, 'https://uier.io')).context.assignee)
            .toEqual({ name: 'Former member' });
    } finally {
        if (previous === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = previous;
    }
});

test('titles, author names and all inline metadata remain literal for GitHub and GitLab', async () => {
    const previous = process.env.UIER_LOCAL;
    process.env.UIER_LOCAL = '1';
    try {
        const unsafe = 'https://x.test www.x.test @user @org/team';
        const authorName = `\`${unsafe}\``;
        const project = { id: `literal-${randomUUID()}`, urls: ['https://review.example'] } as DbProject;
        const comment: DbComment = { id: `comment_${randomUUID()}`, domain: `project:${project.id}`, origin: project.urls[0], path: '/',
            authorId: 'guest', kind: 'feedback', position: { type: 'page' },
            thread: { items: [{ id: 'item_literal', text: unsafe, authorId: 'guest', authorName }] } };
        await getMemoryCommentsStore().create(comment);
        const packet = await projectFeedbackExport(project, { kind: 'member', userId: 'admin', name: 'Admin', isAdmin: true }, comment.id, undefined, 'https://uier.io');
        expect(packet.context.title).toBe(unsafe);
        expect(packet.context.feedback).toMatchObject({ text: unsafe, authorName });
        expect(packet.markdown).toContain(`# \` ${unsafe} \`\n`);
        expect(packet.markdown).toContain(`\n\n\`\` ${authorName} \`\`\n\n`);
        expect(packet.markdown).toContain(`\n\n\`\`\`text\n${unsafe}\n\`\`\``);
        const context = { ...packet.context, assignees: undefined, assignee: { name: unsafe }, source: { path: '/', origin: unsafe, environment: unsafe },
            reproduction: { browser: unsafe, os: unsafe, capturedAt: unsafe }, notes: [unsafe] };
        const original = structuredClone(context);
        const markdown = feedbackMarkdown(context);
        for (const label of ['Assignee', 'Source', 'Environment', 'Browser', 'Operating system', 'Captured'])
            expect(markdown).toContain(`${label}: \` ${unsafe} \``);
        expect(context).toEqual(original);
        const nested = { ...context, assignees: [{ name: unsafe, agents: [
            { kind: 'claude' as const, label: unsafe, model: unsafe, reasoning: unsafe, sessionId: unsafe },
            { kind: 'codex' as const, label: unsafe }
        ] }, { name: unsafe }] };
        const nestedOriginal = structuredClone(nested);
        const multiple = feedbackMarkdown(nested);
        expect(multiple.match(/Assignee:/g)).toHaveLength(2);
        for (const label of ['Agent', 'Model', 'Reasoning', 'Session']) expect(multiple).toContain(`${label}: \` ${unsafe} \``);
        expect(nested).toEqual(nestedOriginal);
        expect(markdown).toContain(`\n\n\` ${unsafe} \`\n`);
        // A bare #12 would link to the repository's own issue #12, not to the uier comment.
        const identity = { ...packet.context.identity, number: 12 };
        const linked = feedbackMarkdown({ ...packet.context, identity });
        expect(packet.context.links.comment).toContain('https://uier.io/app/review/');
        expect(linked).toContain(`Feedback: \` ${comment.id} \` ([uier #12](<${packet.context.links.comment}>))`);
        expect(linked.match(/#12/g)).toHaveLength(1);
        expect(feedbackMarkdown({ ...packet.context, identity, links: {} })).toContain(`Feedback: \` ${comment.id} \` (\` uier #12 \`)`);
    } finally {
        if (previous === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = previous;
    }
});
