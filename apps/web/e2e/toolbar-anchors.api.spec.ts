import { expect, test } from '@playwright/test';
import { anchorLabel, feedbackMarkdown, toolbarPartLabel, type FeedbackContext } from '@uier/toolbar/feedback-context';
import { reattachReviewAnchor } from '../src/lib/review/anchorRoutes';
import { isToolbarPosition, positionSchema } from '../src/lib/comments/validation';
import { commentAnchor } from '../src/lib/app/commentAnchor';
import type { ReviewApiContext } from '../src/lib/review/http';

// Anchors on uier's own toolbar (docs: packages/toolbar/docs/toolbar-review.md)
const inThread = '#uier-toolbar>>>div.uier-thread>div:nth-of-type(1)>div:nth-of-type(1)>button:nth-of-type(2)';
const pinOpener = { opener: '#uier-toolbar>>>#uier-pin-comment_abc', label: 'Comment #5' };
const toolbarPoint = { type: 'point' as const, selector: inThread, xNormal: 0.5, yNormal: 0.5, layer: pinOpener };
const pagePoint = { type: 'point' as const, selector: 'main>h1', xNormal: 0.5, yNormal: 0.5 };

test('toolbar anchors are told apart from page anchors, in every selector of a position', () => {
    for (const position of [
        toolbarPoint,
        { ...pagePoint, layer: { opener: '#uier-toolbar>>>#uier-feedback-toolbar>div:nth-of-type(1)' } },
        { type: 'text' as const, text: 'Copy', startSelector: 'main>p', startOffset: 0, startType: 'text' as const, endSelector: '#uier-toolbar>>>#uier-panel-inbox>p', endOffset: 4, endType: 'text' as const }
    ]) {
        expect(positionSchema.parse(position)).toBeTruthy();
        expect(isToolbarPosition(positionSchema.parse(position))).toBe(true);
    }
    // A toolbar layer inside another (Copy in a thread) saves the toolbar buttons that open the inner ones
    const inCopyMenu = { ...toolbarPoint, selector: '#uier-toolbar>>>div.uier-copy-menu>div:nth-of-type(1)>button:nth-of-type(1)', layer: { ...pinOpener, nested: [inThread] } };
    expect(positionSchema.parse(inCopyMenu)).toMatchObject({ layer: { nested: [inThread] } });
    expect(isToolbarPosition({ ...pagePoint, layer: { opener: 'header>button', nested: [inThread] } })).toBe(true);
    expect(positionSchema.safeParse({ ...inCopyMenu, layer: { ...pinOpener, nested: ['main>button'] } }).success).toBe(false);
    expect(positionSchema.safeParse({ ...pagePoint, layer: { opener: 'header>button', nested: [inThread] } }).success).toBe(false);
    expect(positionSchema.safeParse({ ...inCopyMenu, layer: { ...pinOpener, nested: [] } }).success).toBe(false);
    expect(positionSchema.safeParse({ ...inCopyMenu, layer: { ...pinOpener, nested: Array(8).fill(inThread) } }).success).toBe(false);
    expect(isToolbarPosition(pagePoint)).toBe(false);
    expect(isToolbarPosition({ ...pagePoint, layer: { opener: 'header>button', label: 'Account' } })).toBe(false);
    expect(isToolbarPosition({ type: 'page' })).toBe(false);
});

test('the review API refuses to move a comment onto the toolbar from a project\'s site', async () => {
    const project = { id: 'abcdefghijkl', urls: ['https://reviewed.example'] } as ReviewApiContext['project'];
    const context = (siteOrigin: string | undefined): ReviewApiContext => ({
        request: new Request(`https://uier.io/api/review/${project.id}/comments/comment_abc/anchor`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: '/pricing', position: toolbarPoint, expectedRevision: null })
        }),
        project, actor: { kind: 'guest', visitorId: 'visitor-hash' }, siteOrigin
    });
    await expect(reattachReviewAnchor(context(project.urls[0]), { id: 'comment_abc' }))
        .rejects.toMatchObject({ code: 'invalid_request', message: 'Comments on this site cannot be pinned to the uier toolbar.' });
    // uier's own pages (no cross-origin site) pass this check and meet the next: the reviewed address
    await expect(reattachReviewAnchor(context(undefined), { id: 'comment_abc' })).rejects.toMatchObject({ code: 'forbidden' });
});

test('the app and feedback packets name the toolbar part a comment is on, and how to open it', () => {
    expect(toolbarPartLabel(inThread)).toBe('comment thread');
    expect(toolbarPartLabel('#uier-toolbar>>>#uier-panel-inbox>div:nth-of-type(1)>input:nth-of-type(1)')).toBe('inbox');
    expect(toolbarPartLabel('#uier-toolbar>>>#uier-panel-accessibility>div:nth-of-type(1)>button:nth-of-type(1)')).toBe('accessibility panel');
    expect(toolbarPartLabel('#uier-toolbar>>>#uier-panel-seo>div:nth-of-type(1)')).toBe('SEO panel');
    expect(toolbarPartLabel('#uier-toolbar>>>div.uier-options>a:nth-of-type(1)')).toBe('options');
    expect(toolbarPartLabel('#uier-toolbar>>>div.unknown>a')).toBe('toolbar');
    expect(toolbarPartLabel('main>h1')).toBeUndefined();

    expect(commentAnchor(toolbarPoint, 'comment')).toEqual({ type: 'element', label: 'Button in uier comment thread, after opening “Comment #5”', selector: inThread });
    expect(commentAnchor({ ...pagePoint, selector: '#uier-toolbar>>>#uier-feedback-toolbar>div:nth-of-type(1)>div:nth-of-type(1)' }, 'comment').label).toBe('Element in uier toolbar');
    expect(commentAnchor(pagePoint, 'comment').label).toBe('Heading');

    const anchor: FeedbackContext['anchor'] = { type: 'point', selector: inThread, opener: { selector: pinOpener.opener, label: pinOpener.label } };
    expect(anchorLabel(anchor)).toBe('Element in uier comment thread');
    expect(anchorLabel({ ...anchor, area: { x: 0, y: 0, width: 0.5, height: 0.5 } })).toBe('Area of an element in uier comment thread');
    expect(anchorLabel({ type: 'point', selector: 'main>h1' })).toBe('Element');
    const markdown = feedbackMarkdown({
        schemaVersion: 1, contentTrust: 'untrusted', identity: { commentId: 'comment_def', number: 6 }, title: 'Name what Copy copies',
        kind: 'comment', status: 'open', feedback: null, anchor, source: { path: '/' }, links: {}, reproduction: {},
        screenshot: { state: 'unavailable' }, discussion: [], notes: []
    });
    expect(markdown).toContain('Anchor: Element in uier comment thread');
    expect(markdown).toContain('This is a part of uier\'s own review toolbar, on uier\'s own pages: the selector after #uier-toolbar>>> is inside the toolbar\'s shadow root.');
    expect(markdown).toContain('open it first with ` Comment #5 `');
});
