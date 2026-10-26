import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { brand } from '@uier/brand';
import {
    addToolbarScript,
    animationsFinished,
    commentBubble,
    commentBubbles,
    isolatedOrigin,
    newVisitor,
    openLanding,
    openThread,
    selectText,
    selectionToolbar,
    toolbar
} from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

// Review links, the review session and the toolbar's own controls (collapse, profile, options).
// Public pages also run the showcase. Unknown routes stand in for a reviewed site without it.

const options = (page: Page) => page.getByRole('dialog', { name: 'Options' });

async function openOptions(page: Page) {
    await page.getByRole('button', { name: 'Options', exact: true }).click();
    await expect(options(page)).toBeVisible();
    // Faded in (dark over the page): measured colours are only final after that
    await animationsFinished(options(page));
    return options(page);
}

test('a review link starts a review for the tab; Exit review ends it', async ({ page, baseURL }) => {
    // Without a review link the toolbar stays away
    await page.goto('/e2e-another-page');
    await addToolbarScript(page);
    await expect(page.locator('#uier-toolbar')).toHaveCount(0);

    // ?toolbar-code=<project code>: the project's review link
    await page.goto('/brand?toolbar-code=demo-project_1');
    await addToolbarScript(page);
    await expect(toolbar(page)).toBeVisible();
    const viewProject = (await openOptions(page)).getByRole('link', { name: 'View project' });
    await expect(viewProject).toHaveAttribute('href', `${new URL(baseURL!).origin}/app/projects/demo-project_1`);
    await expect(viewProject).toHaveAttribute('target', '_blank');
    await expectNoAxeViolations(page);
    // Opens the project in a new tab: the app, which asks a signed-out reviewer to sign in first
    const projectPage = page.waitForEvent('popup');
    await viewProject.click();
    const projectUrl = new URL((await projectPage).url());
    expect(projectUrl.pathname).toBe('/app/sign-in');
    expect(projectUrl.searchParams.get('next')).toBe('/app/projects/demo-project_1');
    await expect(options(page)).toBeHidden();

    // The review goes on on other pages of the site, in this tab
    await page.goto('/e2e-another-page');
    await addToolbarScript(page);
    await expect(toolbar(page)).toBeVisible();

    // Exit review: the toolbar leaves the page and the review ends
    await (await openOptions(page)).getByRole('button', { name: 'Exit review' }).click();
    await expect(page.locator('#uier-toolbar')).toHaveCount(0);
    await page.reload();
    await addToolbarScript(page);
    await expect(page.locator('#uier-toolbar')).toHaveCount(0);

    // ?review=true starts a review without a project; Exit review takes it out of the address
    await page.goto('/brand?review=true&tab=tokens');
    await addToolbarScript(page);
    await expect(toolbar(page)).toBeVisible();
    const reviewOptions = await openOptions(page);
    await expect(reviewOptions.getByRole('link', { name: 'View project' })).toHaveCount(0);
    await reviewOptions.getByRole('button', { name: 'Exit review' }).click();
    await expect(page.locator('#uier-toolbar')).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('?tab=tokens');

    // A code that can't be a project code starts nothing
    await page.goto('/e2e-another-page?toolbar-code=%3Cscript%3E');
    await addToolbarScript(page);
    await expect(page.locator('#uier-toolbar')).toHaveCount(0);
});

test('the toolbar collapses and expands', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });

    const add = page.getByRole('button', { name: 'Add comment' });
    await add.click();
    await page.getByRole('button', { name: 'Collapse toolbar' }).click();
    const expand = page.getByRole('button', { name: 'Expand toolbar' });
    await expect(expand).toBeFocused();
    await expect(add).toHaveCount(0);
    // Point mode ends with it
    await expect(page.getByRole('status').filter({ hasText: 'anywhere to pin a comment' })).toHaveCount(0);
    await expectNoAxeViolations(page);

    // Remembered in this tab
    await page.reload();
    await expect(expand).toBeVisible();
    await expect(add).toHaveCount(0);

    await expand.click();
    await expect(page.getByRole('button', { name: 'Collapse toolbar' })).toBeFocused();
    await expect(add).toBeVisible();
    await page.reload();
    await expect(add).toBeVisible();

    await context.close();
});

test('collapse hides page annotations, preserves reply text and restores current anchors', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    const created = await page.evaluate(async (text) => {
        const positions = [
            { type: 'point', selector: 'h1', xNormal: 0.25, yNormal: 0.25 },
            { type: 'text', text, startSelector: 'h1', startOffset: 0, startType: 'text', endOffset: text.length, endType: 'text' }
        ];
        const comments = [];
        for (const [index, position] of positions.entries()) {
            const response = await fetch('/api/comments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: '/', position, text: index === 0 ? 'Heading placement' : 'Wording clarity' })
            });
            comments.push({ status: response.status, id: (await response.json() as { id: string }).id });
        }
        return comments;
    }, brand.tagline);
    expect(created.map(comment => comment.status)).toEqual([201, 201]);
    await page.reload();

    const pointPin = page.locator(`[data-uier-comment="${created[0]!.id}"]`);
    await expect(commentBubbles(page)).toHaveCount(2);
    await expect(page.locator('[data-uier-highlight]').first()).toBeVisible();
    await pointPin.click();
    await openThread(page).getByRole('textbox', { name: 'Reply' }).fill('Keep this unsent reply');
    const collapse = page.getByRole('button', { name: 'Collapse toolbar' });
    if (testInfo.project.use.hasTouch) await collapse.tap();
    else await collapse.click();

    const expand = page.getByRole('button', { name: 'Expand toolbar' });
    await expect(expand).toBeFocused();
    await expect(page.locator('[data-uier-comment]')).toHaveCount(0);
    await expect(page.locator('[data-uier-highlight]')).toHaveCount(0);
    await expect(openThread(page)).toHaveCount(0);
    await selectText(page, brand.description);
    await expect(selectionToolbar(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(brand.description);

    // The page can move underneath the hidden layer; expanding must measure it again.
    await page.getByRole('heading', { level: 1 }).evaluate(element => { element.style.marginTop = '120px'; });
    await page.evaluate(() => { window.getSelection()?.removeAllRanges(); window.scrollTo(0, 0); });
    if (testInfo.project.use.hasTouch) await expand.tap();
    else await expand.click();
    await expect(commentBubbles(page)).toHaveCount(2);
    await expect(page.locator('[data-uier-highlight]').first()).toBeVisible();
    await expect(openThread(page)).toHaveCount(0);
    await expect.poll(async () => {
        const [pin, heading] = await Promise.all([pointPin.boundingBox(), page.getByRole('heading', { level: 1 }).boundingBox()]);
        return pin && heading ? Math.abs(pin.y + pin.height / 2 - (heading.y + heading.height * 0.25 + 17)) : Infinity;
    }).toBeLessThan(2);
    await pointPin.click();
    await expect(openThread(page).getByRole('textbox', { name: 'Reply' })).toHaveValue('Keep this unsent reply');
    await page.keyboard.press('Escape');

    // The remembered collapsed state hides saved annotations from the first render after reload.
    await collapse.click();
    await page.reload();
    await expect(expand).toBeVisible();
    await expect(page.locator('[data-uier-comment]')).toHaveCount(0);
    await expect(page.locator('[data-uier-highlight]')).toHaveCount(0);
    await expect(openThread(page)).toHaveCount(0);
    const saved = await page.evaluate(async () => await (await fetch('/api/comments?path=/')).json() as { resolved: boolean; thread: { items: unknown[] } }[]);
    expect(saved).toHaveLength(2);
    expect(saved.every(comment => !comment.resolved && comment.thread.items.length === 1)).toBe(true);
    await expand.click();
    await expect(commentBubbles(page)).toHaveCount(2);
    await selectText(page, brand.description);
    await expect(selectionToolbar(page)).toBeVisible();
    await collapse.click();
    await expect(selectionToolbar(page)).toHaveCount(0);
    await expect(page.locator('[data-uier-highlight]')).toHaveCount(0);

    // Collapsing leaves inbox state intact; explicitly showing a pin expands the review layer.
    await expand.click();
    await page.getByRole('button', { name: /^Inbox(?:,|$)/ }).click();
    const inbox = page.getByRole('complementary', { name: 'Comments' });
    await inbox.getByRole('searchbox', { name: 'Search comments' }).fill('Heading placement');
    await collapse.click();
    await expect(inbox.getByRole('searchbox', { name: 'Search comments' })).toHaveValue('Heading placement');
    await expect(inbox.getByRole('article')).toHaveCount(1);
    await inbox.getByRole('button', { name: 'Show on page' }).click();
    await expect(collapse).toBeVisible();
    await expect(inbox).toBeHidden();
    await expect(openThread(page).getByText('Heading placement', { exact: true })).toBeVisible();
    await context.close();
});

test('collapse preserves a new comment draft without posting it', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    await page.getByRole('main').getByRole('link', { name: 'How it works' }).focus();
    await page.getByRole('button', { name: 'Add comment' }).focus();
    await page.keyboard.press('Enter');
    await openThread(page).getByRole('textbox', { name: 'Comment', exact: true }).fill('Keep this unsent comment');
    await page.getByRole('button', { name: 'Collapse toolbar' }).click();
    await expect(page.locator('[data-uier-comment]')).toHaveCount(0);
    await expect(openThread(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'Expand toolbar' }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'New comment', exact: true }).click();
    await expect(openThread(page).getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('Keep this unsent comment');
    const saved = await page.evaluate(async () => await (await fetch('/api/comments?path=/')).json() as unknown[]);
    expect(saved).toHaveLength(0);
    await context.close();
});

test('the profile shows the guest name; signing out forgets it', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });

    const profileButton = page.getByRole('button', { name: 'Profile' });
    const profile = page.getByRole('dialog', { name: 'Profile' });
    await profileButton.click();
    await expect(profile).toContainText('You have not commented yet.');
    await animationsFinished(profile);
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(profile).toBeHidden();
    // Nothing to sign out of yet, and the landing page has no review to exit: Options only links to uier.io
    await page.getByRole('button', { name: 'Options', exact: true }).click();
    await expect(options(page).getByRole('link', { name: 'Powered by uier' })).toHaveAttribute('href', 'https://uier.io');
    await expect(options(page).getByRole('button')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(options(page)).toBeHidden();

    // The first comment gives the visitor a guest name
    await page.getByRole('main').getByRole('link', { name: 'How it works' }).focus();
    await page.getByRole('button', { name: 'Add comment' }).focus();
    await page.keyboard.press('Enter');
    const composer = page.getByRole('textbox', { name: 'Comment', exact: true });
    await composer.fill('Signed in by commenting');
    await composer.press('Enter');
    await expect(commentBubble(page, 1)).toBeVisible();

    const { name } = await page.evaluate(async () => await (await fetch('/api/visitor')).json() as { name: string });
    expect(name).toMatch(/^Guest [0-9A-F]{4}$/);
    await profileButton.click();
    await expect(profile.getByText(name, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    // Sign out asks first
    const signOutOptions = await openOptions(page);
    await signOutOptions.getByRole('button', { name: 'Sign out...' }).click();
    await expect(signOutOptions).toContainText(`can no longer resolve or delete the comments you left as ${name}.`);
    await expect(signOutOptions.getByRole('button', { name: 'Sign out', exact: true })).toBeFocused();
    await signOutOptions.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(signOutOptions).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Signed out' })).toBeAttached();

    // The comment stays, but this browser can no longer resolve it
    expect((await context.cookies()).map(cookie => cookie.name)).not.toContain('uier_visitor');
    const signedOutOptions = await openOptions(page);
    await expect(signedOutOptions.getByRole('button', { name: 'Sign out...' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(signedOutOptions).toBeHidden();
    await commentBubble(page, 1).click();
    await expect(openThread(page).getByText(name, { exact: true })).toBeVisible();
    await expect(openThread(page).getByRole('button', { name: 'Mark as done' })).toHaveCount(0);

    await context.close();
});

test('a comment link in a review carries the review link', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await page.goto(`${origin}/brand?toolbar-code=demo-project_1`);
    await addToolbarScript(page);
    await expect(toolbar(page)).toBeVisible();
    const id = await page.evaluate(async () => {
        const response = await fetch('/api/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: '/brand', position: { type: 'point', selector: 'main', xNormal: 0.5, yNormal: 0 }, text: 'Show the tokens first.' })
        });
        return (await response.json() as { id: string }).id;
    });

    await page.reload();
    await addToolbarScript(page);
    await commentBubble(page, 1).click();
    await openThread(page).getByRole('button', { name: 'Copy link' }).click();
    const link = await page.evaluate(async () => await navigator.clipboard.readText());
    expect(link).toBe(`${origin}/brand?toolbar-code=demo-project_1&uier-comment=${id}`);

    // Followed in a new tab (no review yet): the toolbar starts and opens the thread
    const other = await context.newPage();
    await other.goto(link);
    await addToolbarScript(other);
    await expect(openThread(other).getByText('Show the tokens first.')).toBeVisible();
    expect(new URL(other.url()).search).toBe('?toolbar-code=demo-project_1');

    await context.close();
});
