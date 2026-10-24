import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
    addToolbarScript,
    commentBubble,
    isolatedOrigin,
    newVisitor,
    openLanding,
    openThread,
    toolbar
} from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

// Review links, the review session and the toolbar's own controls (collapse, profile, options).
// Other pages of uier.io don't embed the toolbar, so these tests add the script like a reviewed
// site would (review mode).

const options = (page: Page) => page.getByRole('dialog', { name: 'Options' });

async function openOptions(page: Page) {
    await page.getByRole('button', { name: 'Options' }).click();
    await expect(options(page)).toBeVisible();
    return options(page);
}

test('a review link starts a review for the tab; Exit review ends it', async ({ page, baseURL }) => {
    // Without a review link the toolbar stays away
    await page.goto('/brand');
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
    // Opens the project in a new tab (the app's project pages come with the app)
    const projectPage = page.waitForEvent('popup');
    await viewProject.click();
    expect(new URL((await projectPage).url()).pathname).toBe('/app/projects/demo-project_1');
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
    await page.goto('/brand?toolbar-code=%3Cscript%3E');
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

test('the profile shows the guest name; signing out forgets it', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });

    const profileButton = page.getByRole('button', { name: 'Profile' });
    const profile = page.getByRole('dialog', { name: 'Profile' });
    await profileButton.click();
    await expect(profile).toContainText('You have not commented yet.');
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(profile).toBeHidden();
    // Nothing to sign out of yet, and the landing page has no review to exit
    await expect(page.getByRole('button', { name: 'Options' })).toHaveCount(0);

    // The first comment gives the visitor a guest name
    await page.getByRole('link', { name: 'How it works' }).focus();
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
    await expect(page.getByRole('button', { name: 'Options' })).toHaveCount(0);
    await commentBubble(page, 1).click();
    await expect(openThread(page).getByText(name, { exact: true })).toBeVisible();
    await expect(openThread(page).getByRole('button', { name: 'Resolve' })).toHaveCount(0);

    await context.close();
});

/** Computed styles of a few of the page's elements */
async function pageStyles(page: Page) {
    return await page.evaluate(() => ['html', 'body', 'h1', 'p', 'a', 'button'].map(selector => {
        const element = document.querySelector(selector);
        if (!element) {
            return null;
        }
        const style = getComputedStyle(element);
        return [...style].map(property => `${property}: ${style.getPropertyValue(property)}`);
    }));
}

test('the toolbar mounts in its shadow root and leaves the page\'s styles alone', async ({ page }) => {
    await page.goto('/brand?review=true');
    const before = await pageStyles(page);
    const documentStyles = await page.evaluate(() => document.styleSheets.length + document.adoptedStyleSheets.length);

    await addToolbarScript(page);
    await expect(toolbar(page)).toBeVisible();
    await page.getByRole('button', { name: 'Profile' }).click();
    await expect(page.getByRole('dialog', { name: 'Profile' })).toBeVisible();

    expect(await pageStyles(page)).toEqual(before);
    const mounted = await page.evaluate(() => {
        const host = document.getElementById('uier-toolbar');
        return {
            styleSheets: document.styleSheets.length + document.adoptedStyleSheets.length,
            // Everything is in the shadow root: no children in the page, the CSS is inside
            hostChildren: host?.children.length,
            shadowStyles: host?.shadowRoot?.querySelectorAll('style').length,
            // The popover renders into the shadow root as well
            dialogsInPage: document.querySelectorAll('[role="dialog"]').length,
            dialogsInShadowRoot: host?.shadowRoot?.querySelectorAll('[role="dialog"]').length
        };
    });
    expect(mounted).toEqual({
        styleSheets: documentStyles,
        hostChildren: 0,
        shadowStyles: 1,
        dialogsInPage: 0,
        dialogsInShadowRoot: 1
    });
});
