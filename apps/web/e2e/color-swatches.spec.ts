import { expect, test, type Locator } from '@playwright/test';
import { createProject, hydrated, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { expectNoAxeViolations } from './accessibility';

// A colour value someone wrote shows a small swatch before it: in a row's title, the thread's title and its
// messages in the app, and in the toolbar's thread. What counts as a colour is `color-values.api.spec.ts`.

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

const firstLine = 'Logo should be this color: #ED1C24';
const message = [
    firstLine,
    '',
    'Paper is `#FFFFFF` and links are rgb(10, 132, 255), not uier #389.',
    '',
    '```css',
    '.logo { color: #ED1C24; }',
    '```'
].join('\n');

const swatches = (scope: Locator) => scope.locator('[data-color-swatch]');
/** The colours of the swatches in `scope`, as the browser computed them */
const colors = (scope: Locator) => swatches(scope).evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundColor));

/** The message's swatches (`body`, the message text), the same in the app and the toolbar */
async function expectSwatches(body: Locator) {
    await expect(swatches(body)).toHaveCount(3);
    expect(await colors(body)).toEqual(['rgb(237, 28, 36)', 'rgb(255, 255, 255)', 'rgb(10, 132, 255)']);
    // The text is as it was written; a comment number and fenced code get no swatch
    await expect(body).toContainText('Paper is #FFFFFF and links are rgb(10, 132, 255), not uier #389.');
    await expect(body.locator('code').filter({ hasText: /^#FFFFFF$/ }).locator('[data-color-swatch]')).toHaveCount(1);
    await expect(body.locator('pre')).toHaveText('.logo { color: #ED1C24; }');
    await expect(swatches(body.locator('pre'))).toHaveCount(0);
    // A small square just before its value, on the value's line, with a border that shows on a surface of its own colour
    const white = swatches(body).nth(1);
    const box = await white.evaluate(element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const value = element.parentElement!.getBoundingClientRect();
        return { width: rect.width, height: rect.height, border: style.borderTopWidth, borderStyle: style.borderTopStyle, borderColor: style.borderTopColor,
            radius: style.borderTopLeftRadius, hidden: element.getAttribute('aria-hidden'), inside: rect.top >= value.top - 1 && rect.bottom <= value.bottom + 1 && rect.left <= value.left + 1 };
    });
    expect(box).toMatchObject({ width: 12, height: 12, border: '1px', borderStyle: 'solid', radius: '4px', hidden: 'true', inside: true });
    expect(box.borderColor).not.toBe('rgb(255, 255, 255)');
}

test('colour values show a swatch in rows, titles and messages, in the app and the toolbar', async ({ page, request }, testInfo) => {
    await signIn(page, uniqueEmail('swatches'));
    const project = await createProject(page, { name: 'Colour swatches', urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
        path: `/${project}/pricing`, text: message, authorName: 'Reviewer', position: { type: 'page' }, kind: 'feedback'
    } });
    expect(response.status()).toBe(201);
    const { id: commentId } = await response.json() as { id: string };

    // The row: its title is the first line, with the swatch before the value; its name is the words alone
    await page.goto(`/app/projects/${project}`);
    const row = page.getByRole('link', { name: /^Comment #1 Logo should be this color: #ED1C24/ });
    await expect(swatches(row)).toHaveCount(1);
    expect(await colors(row)).toEqual(['rgb(237, 28, 36)']);

    // The thread's messages
    const thread = await openComment(page, firstLine);
    await expectSwatches(thread.locator('[data-markdown]').first());

    // The thread's title, once a member gives it one: the swatch is in the heading, not in the field
    await hydrated(thread);
    await thread.getByRole('button', { name: 'Add a title', exact: true }).click();
    const field = thread.getByRole('textbox', { name: 'Thread title' });
    await field.fill('Brand red is hsl(358 85% 52%)');
    await expect(swatches(thread.locator('[data-markdown]').first())).toHaveCount(3);
    await field.press('Enter');
    const heading = thread.getByRole('heading', { name: 'Brand red is hsl(358 85% 52%)', exact: true });
    await expect(swatches(heading)).toHaveCount(1);
    expect(await colors(heading)).toEqual([await page.evaluate(() => {
        const probe = document.body.appendChild(document.createElement('span'));
        probe.style.backgroundColor = 'hsl(358 85% 52%)';
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
    })]);
    // The row has the title and its swatch too (a phone hides the list while a thread is open)
    await expect(page.getByRole('link', { name: /^Comment #1 Brand red is hsl\(358 85% 52%\)/, includeHidden: true }).locator('[data-color-swatch]')).toHaveCount(1);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath('swatches-app.png'), fullPage: true });

    // The toolbar's thread on the reviewed page shows the same swatches
    const review = await page.context().newPage();
    await review.goto(`/app/review/${project}?url=${encodeURIComponent(`${site.origin()}/${project}/pricing`)}&comment=${commentId}`);
    const toolbarThread = review.getByRole('complementary', { name: 'Comments' }).getByRole('article', { name: 'Comment #1', exact: true });
    await expectSwatches(toolbarThread.locator('[data-markdown]').first());
    await expectNoAxeViolations(review);
    await review.screenshot({ path: testInfo.outputPath('swatches-toolbar.png') });
    await review.close();
});
