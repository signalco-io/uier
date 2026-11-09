import { expect, test, type Locator, type Page } from '@playwright/test';
import { commentRows, createProject, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

// Each status has its own dot colour, always beside its name: Open ink, In progress sky, Ready to verify
// violet, Done green (BRAND.md, "Status"). The same dot shows on list rows, board column headers, the
// thread's status menu and the Status filter, in both themes.

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

const statuses = [['open', 'Open'], ['in-progress', 'In progress'], ['ready', 'Ready to verify'], ['done', 'Done']] as const;
type Status = typeof statuses[number][0];
/** Each status's brand token */
const tokens: Record<Status, string> = { open: '--foreground', 'in-progress': '--brand-in-progress', ready: '--brand-ready', done: '--brand-success' };
const threads: Record<Status, string> = { open: 'Open thread', 'in-progress': 'Thread in progress', ready: 'Thread to verify', done: 'Finished thread' };

/** A token's colour in the current theme, as the browser computes it ("rgb(2, 132, 197)") */
const tokenColor = (page: Page, token: string) => page.evaluate(name => {
    const probe = document.createElement('span');
    probe.style.color = `hsl(var(${name}))`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
}, token);

/** The status's dot in a scope: hidden from assistive tech (its name is beside it), in its status's colour */
async function expectDot(scope: Locator, status: Status) {
    const dot = scope.locator(`[data-status-dot="${status}"]`);
    await expect(dot).toBeVisible();
    await expect(dot).toHaveAttribute('aria-hidden', 'true');
    await expect(dot).toHaveCSS('background-color', await tokenColor(scope.page(), tokens[status]));
}

test('each status shows its own colour in the board, the list, the status menu and the filter, light and dark', async ({ page, request }) => {
    await signIn(page, uniqueEmail('status-colors'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const numbers = {} as Record<Status, number>;
    for (const [status] of statuses) {
        const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: `/${project}/pricing`, text: threads[status], authorName: 'Reviewer', position: { type: 'page' }, kind: 'feedback'
        } });
        expect(response.status()).toBe(201);
        numbers[status] = (await response.json() as { number: number }).number;
    }

    // One thread in each column
    await page.goto(`/app/projects/${project}?view=board`);
    const column = (name: string) => page.getByRole('region', { name: `${name} comments`, exact: true });
    await expect(column('Open').getByRole('listitem')).toHaveCount(4);
    const move = async (status: Status, to: string) => {
        await column('Open').getByRole('button', { name: `Move comment #${numbers[status]}`, exact: true }).click();
        await page.getByRole('menuitem', { name: to, exact: true }).click();
    };
    await move('in-progress', 'In progress');
    await expect(column('In progress').getByRole('listitem')).toHaveCount(1);
    await move('done', 'Done');
    await expect(column('Done').getByRole('listitem')).toHaveCount(1);
    await move('ready', 'Ready to verify');
    const form = page.getByRole('article').getByRole('form', { name: 'Request verification' });
    await form.getByRole('textbox', { name: 'Fix summary', exact: true }).fill('Fixed the colours');
    await form.getByRole('button', { name: 'Request verification', exact: true }).click();
    await expect(page.getByRole('article').getByRole('button', { name: 'Status: Ready to verify. Change status', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(column('Ready to verify').getByRole('listitem')).toHaveCount(1);

    for (const colorScheme of ['light', 'dark'] as const) {
        await page.goto(`/app/projects/${project}?view=board`);
        await page.emulateMedia({ colorScheme });
        await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/);
        // Four different colours
        const colors = await Promise.all(statuses.map(([status]) => tokenColor(page, tokens[status])));
        expect(new Set(colors).size).toBe(4);

        // The board's column headers
        for (const [status, name] of statuses)
            await expectDot(column(name).getByRole('heading', { name: new RegExp(`^${name}`) }), status);
        await animationsFinished(page.locator('body'));
        await expectNoAxeViolations(page);

        // The list's rows (Open too)
        await page.goto(`/app/projects/${project}?status=all`);
        await expect(commentRows(page)).toHaveCount(4);
        for (const [status] of statuses)
            await expectDot(commentRows(page).filter({ hasText: threads[status] }), status);
        // The Status filter: the tabs have no dots (none reads as a notification); the statuses under Active have theirs
        const tabs = page.getByRole('group', { name: 'Status', exact: true });
        await expect(tabs.locator('[data-status-dot]')).toHaveCount(0);
        await tabs.getByRole('button', { name: 'Active statuses', exact: true }).click();
        const activeMenu = page.getByRole('menu');
        for (const [status, name] of statuses.slice(0, 3))
            await expectDot(activeMenu.getByRole('menuitemradio', { name: new RegExp(`^${name} \\d`) }), status);
        await activeMenu.getByRole('menuitemradio', { name: /^In progress \d/ }).click();
        // The Active tab then says which status it shows, still without a dot
        await expect(tabs.getByRole('button', { name: /^Active: In progress \d/ })).toBeVisible();
        await expect(tabs.locator('[data-status-dot]')).toHaveCount(0);
        await expect(commentRows(page)).toHaveCount(1);

        // The thread's status control and its menu
        const thread = await openComment(page, numbers['in-progress']);
        const control = thread.getByRole('button', { name: 'Status: In progress. Change status', exact: true });
        await expectDot(control, 'in-progress');
        await control.click();
        const menu = page.getByRole('menu');
        for (const [status, name] of statuses)
            await expectDot(menu.getByRole('menuitem', { name, exact: true }), status);
        await animationsFinished(page.locator('body'));
        await expectNoAxeViolations(page);
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
    }
});
