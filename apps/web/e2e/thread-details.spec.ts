import { expect, test, type Locator } from '@playwright/test';
import { backToComments, createProject, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished } from './support/toolbar';

// The open thread's details (On, Page, Priority, Assignee) read as a properties list: every row is the
// same height whether it holds text or a ghost control, and every value starts at the same left edge
// (a control's flag, avatar or text lines up with plain text). In the side panel, the sheet over the
// board and on phones; in both themes.

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

type Row = { label: string; labelTop: number; labelHeight: number; valueTop: number; valueHeight: number; valueStart: number };

/** Each row's label and value box, and where the value's first visible thing (text, icon or avatar) starts */
const measure = (details: Locator) => details.evaluate(list => {
    const firstStart = (value: Element) => {
        const walker = document.createTreeWalker(value, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (node instanceof Element) {
                if (!node.matches('svg, img, [data-slot="avatar"]')) continue;
                const box = node.getBoundingClientRect();
                if (box.width > 1) return box.left;
            } else if (node.textContent?.trim()) {
                const range = document.createRange();
                range.selectNodeContents(node);
                const box = range.getBoundingClientRect();
                if (box.width > 1) return box.left;
            }
        }
        return Number.NaN;
    };
    return [...list.querySelectorAll(':scope > dt')].map(label => {
        const value = label.nextElementSibling!;
        const labelBox = label.getBoundingClientRect();
        const valueBox = value.getBoundingClientRect();
        return { label: label.textContent!.trim(), labelTop: labelBox.top, labelHeight: labelBox.height,
            valueTop: valueBox.top, valueHeight: valueBox.height, valueStart: firstStart(value) };
    });
});

function expectEvenRows(rows: Row[], rowHeight: number) {
    expect(rows.map(row => row.label)).toEqual(['On', 'Page', 'Priority', 'Assignee']);
    for (const row of rows) {
        expect.soft(row.labelHeight, `${row.label} label height`).toBeCloseTo(rowHeight, 0);
        expect.soft(row.valueHeight, `${row.label} value height`).toBeCloseTo(rowHeight, 0);
        expect.soft(row.valueTop, `${row.label} value top`).toBeCloseTo(row.labelTop, 0);
        expect.soft(Math.abs(row.valueStart - rows[0]!.valueStart), `${row.label} value start`).toBeLessThanOrEqual(1);
    }
    // One rhythm: the same step from row to row
    const steps = rows.slice(1).map((row, index) => row.labelTop - rows[index]!.labelTop);
    for (const step of steps) expect.soft(step).toBeCloseTo(steps[0]!, 0);
}

test('the thread details are a properties list: even rows, values on one left edge', async ({ page, request }, testInfo) => {
    const email = uniqueEmail('details');
    const name = email.split('@')[0]!;
    await signIn(page, email);
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
        path: `/${project}/pricing`, text: 'Checkout button fails', authorName: 'Reviewer',
        position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 }
    } });
    expect(response.status()).toBe(201);
    await page.goto(`/app/projects/${project}`);
    const mobile = testInfo.project.name.startsWith('Mobile');
    // Touch screens get 44px targets, so 44px rows
    const rowHeight = mobile ? 44 : 32;

    // Text rows and control rows: the assignee with their agent is the busiest one
    let thread = await openComment(page, 'Checkout button fails');
    await thread.getByRole('button', { name: 'Unassigned. Change assignee', exact: true }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
    await thread.getByRole('button', { name: 'Add agent', exact: true }).click();
    const menu = page.getByRole('menu').filter({ has: page.getByRole('menuitemradio', { name: 'Claude', exact: true }) });
    await animationsFinished(menu);
    // By keyboard: a pointer release on the closing menu can land on the device button below it on a phone
    await menu.getByRole('menuitemradio', { name: 'Claude', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(thread.getByRole('button', { name: 'Agent: Claude. Change agent', exact: true })).toBeVisible();
    await expect(menu).toHaveCount(0);

    const details = thread.locator('dl[data-thread-details]');
    for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/);
        await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
        expectEvenRows(await measure(details), rowHeight);
        await page.screenshot({ path: testInfo.outputPath(`details-${colorScheme}.png`) });
    }
    await page.emulateMedia({ colorScheme: null });

    // The same in the sheet over the board
    if (mobile) await backToComments(page);
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    thread = await openComment(page, 'Checkout button fails');
    await animationsFinished(thread);
    expectEvenRows(await measure(thread.locator('dl[data-thread-details]')), rowHeight);
    await page.screenshot({ path: testInfo.outputPath('details-board.png') });
});
