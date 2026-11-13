import { expect, test, type Locator, type Route } from '@playwright/test';
import { backToComments, commentRowLink, createProject, inBackground, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';

// While an opened thread's detail loads, the thread pane shows a shell shaped like it (uier #385): the header, the
// detail labels, the first message, skeletons for each reply, Reply and Activity. When the detail arrives, nothing moves.

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

/** Where the thread's parts sit, from the top of the card */
const layout = (card: Locator) => card.evaluate(root => {
    const top = root.getBoundingClientRect().top;
    const at = (element: Element | null | undefined) => element ? Math.round(element.getBoundingClientRect().top - top) : undefined;
    const reply = [...root.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Reply');
    return {
        details: at(root.querySelector('dl')),
        labels: [...root.querySelectorAll('dl > dt')].map(label => label.textContent?.trim()),
        messages: at(root.querySelector('ol')),
        reply: at(reply),
        footer: at(root.querySelector('[data-slot="card-footer"]')),
        height: Math.round(root.getBoundingClientRect().height)
    };
});

test('an opened thread shows a shell shaped like it until its detail arrives', async ({ page, request }, testInfo) => {
    test.setTimeout(60_000);
    await signIn(page, uniqueEmail('thread-shell'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const post = async (text: string) => {
        const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: `/${project}/pricing`, text, authorName: 'Reviewer', position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 }
        } });
        expect(response.status(), await response.text()).toBe(201);
        return await response.json() as { id: string; number: number };
    };
    const held = await post('Checkout button fails');
    for (const text of ['First reply', 'Second reply'])
        expect((await request.post(`/api/review/${project}/comments/${held.id}/replies`, { headers, data: { text, authorName: 'Reviewer' } })).ok()).toBe(true);
    const other = await post('Header logo is blurry');

    await inBackground(page);
    await page.goto(`/app/projects/${project}`);
    // An activity entry, so the thread has its Activity footer
    await commentRowLink(page, held.number).first().click();
    let thread = page.getByRole('article');
    await expect(thread).toContainText('Second reply');
    await thread.getByRole('button', { name: 'Priority: Normal. Change priority' }).click();
    await page.getByRole('menuitem', { name: 'Low' }).click();
    await expect(thread.getByRole('button', { name: 'Activity (1)' })).toBeVisible();
    // On a phone the thread takes the list's place
    const phone = testInfo.project.name.startsWith('Mobile');
    if (phone) await backToComments(page);
    await commentRowLink(page, other.number).first().click();
    await expect(page.getByRole('article')).toContainText('Header logo is blurry');
    if (phone) await backToComments(page);

    let release!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    await page.route(url => url.pathname.endsWith(`/comments/${held.id}`), async (route: Route) => {
        await released;
        await route.continue();
    });
    await commentRowLink(page, held.number).first().click();
    const shell = page.locator('[data-thread-shell="loading"]');
    await expect(shell).toBeVisible();
    await expect(shell).toHaveAttribute('aria-busy', 'true');
    await expect(shell.getByText('Loading comments')).toBeAttached();
    await expect(page.getByRole('article')).toHaveCount(0);
    // What the summary knows is drawn as the thread draws it; the controls wait for the detail
    await expect(shell).toContainText(`#${held.number}`);
    await expect(shell).toContainText('Checkout button fails');
    await expect(shell.getByRole('button', { name: 'Reply', includeHidden: true })).toBeAttached();
    await expect(shell.locator('ol > li')).toHaveCount(3);
    await expect(shell).toContainText('Activity (1)');
    // Back to comments needs no data: it works at once
    if (phone) await expect(shell.getByRole('button', { name: 'Back to comments' })).toBeEnabled();
    const before = await layout(shell);
    expect(before.labels).toEqual(['Page', 'On', 'Assignees', 'Priority', 'Labels', 'Pull requests']);

    release();
    thread = page.getByRole('article');
    await expect(thread).toContainText('Second reply');
    await expect(shell).toHaveCount(0);
    const after = await layout(thread);
    expect(after).toEqual(before);
});
