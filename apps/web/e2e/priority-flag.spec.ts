import { expect, test, type Locator, type Page } from '@playwright/test';
import { backToComments, commentRows, createProject, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

// Priority shows as a flag in the priority's colour: beside its name in the open thread's priority
// control and its menu, and alone (named "Urgent priority") on list rows and board cards for a
// priority other than Normal.

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

const priorities = [['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['urgent', 'Urgent']] as const;
type Priority = typeof priorities[number][0];
/** Each priority's brand token (BRAND.md, "Colour") */
const tokens: Record<Priority, string> = { low: '--muted-foreground', normal: '--foreground', high: '--brand-warning', urgent: '--destructive' };

/** A token's colour in the current theme, as the browser computes it ("rgb(220, 38, 38)") */
const tokenColor = (page: Page, token: string) => page.evaluate(name => {
    const probe = document.createElement('span');
    probe.style.color = `hsl(var(${name}))`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
}, token);

/** The flag in a scope: hidden from assistive tech (the name beside it says the priority), in its priority's colour */
async function expectFlag(scope: Locator, priority: Priority) {
    const flag = scope.locator(`svg[data-priority="${priority}"]`);
    await expect(flag).toBeVisible();
    await expect(flag).toHaveAttribute('aria-hidden', 'true');
    await expect(flag).toHaveCSS('stroke', await tokenColor(scope.page(), tokens[priority]));
}

/** A row's or card's priority: the flag alone, its name only for assistive tech */
async function expectFlagOnly(scope: Locator, name: string) {
    await expect(scope.getByRole('img', { name: `${name} priority`, exact: true })).toBeVisible();
    await expect(scope).not.toContainText(name);
}

test('priority shows a flag in its colour in the thread, its menu, list rows and board cards', async ({ page, request }) => {
    await signIn(page, uniqueEmail('priority-flag'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const numbers: number[] = [];
    for (const text of ['Checkout button fails', 'Footer link is grey']) {
        const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: `/${project}/pricing`, text, authorName: 'Reviewer', position: { type: 'page' }, kind: 'feedback'
        } });
        expect(response.status()).toBe(201);
        numbers.push((await response.json() as { number: number }).number);
    }
    await page.goto(`/app/projects/${project}`);
    await expect(commentRows(page)).toHaveCount(2);
    // Normal is the default: rows show no flag for it
    await expect(commentRows(page).locator('svg[data-priority]')).toHaveCount(0);

    // The thread's control: the flag and the name; its menu has every priority's flag and checks the current one
    const thread = await openComment(page, numbers[0]!);
    const control = thread.getByRole('button', { name: 'Priority: Normal. Change priority', exact: true });
    await expect(control).toHaveText('Normal');
    await expectFlag(control, 'normal');
    await control.click();
    const menu = page.getByRole('menu');
    for (const [priority, name] of priorities)
        await expectFlag(menu.getByRole('menuitem', { name, exact: true }), priority);
    await expect(menu.getByRole('menuitem', { name: 'Normal', exact: true }).locator('svg')).toHaveCount(2);
    await expect(menu.getByRole('menuitem', { name: 'Urgent', exact: true }).locator('svg')).toHaveCount(1);
    await menu.getByRole('menuitem', { name: 'Urgent', exact: true }).click();
    const saved = page.getByText('Priority set to Urgent.', { exact: true });
    await expect(saved).toBeVisible();
    await expect(menu).toHaveCount(0);
    await expectFlag(thread.getByRole('button', { name: 'Priority: Urgent. Change priority', exact: true }), 'urgent');

    // The list row: the flag without its name, read as "Urgent priority"; the Normal row stays without one
    await backToComments(page);
    const urgentRow = commentRows(page).filter({ hasText: 'Checkout button fails' });
    await expectFlag(urgentRow, 'urgent');
    await expectFlagOnly(urgentRow, 'Urgent');
    await expect(commentRows(page).filter({ hasText: 'Footer link is grey' }).locator('svg[data-priority]')).toHaveCount(0);
    // Scan once the toast has gone: mid-fade frames would fail the contrast check at random
    await expect(saved).toBeHidden({ timeout: 10_000 });
    await expectNoAxeViolations(page);

    // The board card, the same way
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    const cards = page.getByRole('region', { name: 'Open comments', exact: true }).getByRole('listitem');
    const urgentCard = cards.filter({ hasText: 'Checkout button fails' });
    await expectFlag(urgentCard, 'urgent');
    await expectFlagOnly(urgentCard, 'Urgent');
    await expect(cards.filter({ hasText: 'Footer link is grey' }).locator('svg[data-priority]')).toHaveCount(0);

    // Dark theme: the flags take the dark theme's colours (amber is lighter there)
    const lightAmber = await tokenColor(page, tokens.high);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    expect(await tokenColor(page, tokens.high)).not.toBe(lightAmber);
    await expectFlag(urgentCard, 'urgent');
    // Colours fade to the dark theme: scan the settled page
    await animationsFinished(page.locator('body'));
    await expectNoAxeViolations(page);
    await urgentCard.getByRole('link').click();
    const sheet = page.getByRole('article');
    await sheet.getByRole('button', { name: 'Priority: Urgent. Change priority', exact: true }).click();
    for (const [priority, name] of priorities)
        await expectFlag(page.getByRole('menu').getByRole('menuitem', { name, exact: true }), priority);
});
