import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { createProject, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

// The open thread's On row shows a long saved selector by its start and its end on one line, with a
// button that shows it whole and shortens it again. Its text stays the whole selector for assistive
// tech and copying; a short selector is shown whole, without the button.

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

/** The selector the toolbar saved for a code element in the app's own thread (alternatives joined by commas) */
const long = String.raw`#comments>div>div:nth-of-type(3)>div>div>div>dl>dd>code,body>div:nth-of-type(2)>main>div>div>div:nth-of-type(2)>#comments>div>div:nth-of-type(3)>div>div>div>dl>dd>code,#comments>div.\@container\/comments>div.grid>div.min-w-0>div.group\/card>div.flex>dl.m-0>dd.m-0>code.ml-2,body.font-sans>div.group\/sidebar-wrapper>main.relative>div.flex-1>div.mx-auto>div.flex:nth-of-type(2)>#comments>div.\@container\/comments>div.grid>div.min-w-0>div.group\/card>div.flex>dl.m-0>dd.m-0>code.ml-2`;
const short = 'main>section>h2';

async function threads(page: Page, request: APIRequestContext) {
    await signIn(page, uniqueEmail('selector'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const ids: string[] = [];
    for (const [text, selector] of [['On a long selector', long], ['On a short selector', short]]) {
        const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: `/${project}/pricing`, text, authorName: 'Reviewer', kind: 'comment',
            position: { type: 'point', selector, xNormal: 0.5, yNormal: 0.5 }
        } });
        expect(response.status()).toBe(201);
        ids.push((await response.json() as { id: string }).id);
    }
    return { project, longId: ids[0]!, shortId: ids[1]! };
}

/** The text in view: without the parts only assistive tech reads */
const shown = (code: Locator) => code.evaluate(element => {
    const copy = element.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('.sr-only').forEach(node => node.remove());
    return copy.textContent;
});
/** The text assistive tech reads: without the ellipsis, which is hidden from it */
const read = (code: Locator) => code.evaluate(element => {
    const copy = element.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[aria-hidden="true"]').forEach(node => node.remove());
    return copy.textContent;
});

test('a long selector shows its start and its end on one line, and all of it on request', async ({ page, request }, testInfo) => {
    const mobile = testInfo.project.name.startsWith('Mobile');
    if (!mobile)
        await page.setViewportSize({ width: 1280, height: 800 });
    const { project, longId, shortId } = await threads(page, request);
    await page.goto(`/app/projects/${project}?comment=${longId}`);
    const thread = page.getByRole('article');
    await expect(thread).toContainText('On a long selector');
    const code = thread.locator('dd code');
    const expand = thread.getByRole('button', { name: 'Show full selector', exact: true });
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expect(expand).toHaveAttribute('aria-controls', (await code.getAttribute('id'))!);
    expect(await shown(code)).toBe('#comments>…>dd.m-0>code.ml-2');
    expect(await read(code)).toBe(long);

    // One line with its button, inside the cell (a phone included)
    const [cell, line, button] = await Promise.all([thread.locator('dd').first().boundingBox(), code.boundingBox(), expand.boundingBox()]);
    expect(line!.height).toBeLessThanOrEqual(20);
    expect(Math.abs((button!.y + button!.height / 2) - (line!.y + line!.height / 2))).toBeLessThanOrEqual(4);
    expect(button!.x + button!.width).toBeLessThanOrEqual(cell!.x + cell!.width + 0.5);
    await animationsFinished(thread);
    await page.screenshot({ path: testInfo.outputPath('selector-short.png') });

    // On a touch screen the 24px button has a 44px target: a tap just above it still counts
    if (mobile)
        await page.touchscreen.tap(button!.x + button!.width / 2, button!.y - 8);
    else
        await expand.click();
    const shorten = thread.getByRole('button', { name: 'Shorten selector', exact: true });
    await expect(shorten).toHaveAttribute('aria-expanded', 'true');
    await expect(code).toHaveText(long);
    expect((await code.boundingBox())!.height).toBeGreaterThan(40);
    expect(await thread.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await animationsFinished(thread);
    await page.screenshot({ path: testInfo.outputPath('selector-whole.png') });
    await expectNoAxeViolations(page);

    await shorten.click();
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    expect(await shown(code)).toBe('#comments>…>dd.m-0>code.ml-2');
    await expect(expand).toBeFocused();

    // A short selector is shown whole, without the button
    await page.goto(`/app/projects/${project}?comment=${shortId}`);
    await expect(thread).toContainText('On a short selector');
    await expect(code).toHaveText(short);
    await expect(thread.getByRole('button', { name: /selector$/ })).toHaveCount(0);
});
