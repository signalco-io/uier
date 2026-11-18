import { expect, test } from '@playwright/test';
import { createProject, signIn, uniqueEmail } from '../support/app';
import { startReviewedSite } from '../support/reviewedSite';
import { Capture, hardLoad } from './capture';

// The account-switch page as a visit has it: a project's link opened by an account that cannot open it, in a browser
// where two other signed-in accounts can. Without such a link (`next`) the page is a 404, which is what the audit's
// first capture of it held. Its own test: it signs three accounts into one browser.
test('account switch for a project link', async ({ page, baseURL }, info) => {
    const capture = new Capture(info, 'app-switch');
    // Accepting an invitation opens the project's site: a local one
    const site = await startReviewedSite(new URL(baseURL!).origin);
    try {
        const owner = uniqueEmail('switch-owner');
        await signIn(page, owner);
        const project = await createProject(page, { urls: [site.origin()], name: 'Shared project' });
        await page.goto('/app/workspace/users');
        await page.getByRole('button', { name: 'Invite', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Email', { exact: true }).fill(uniqueEmail('switch-reviewer'));
        await dialog.getByRole('button', { name: 'Send invitation' }).click();
        const link = dialog.getByRole('link', { name: 'Open the invitation link' });
        await expect(link).toBeVisible();
        await page.goto((await link.getAttribute('href'))!);
        await page.getByRole('button', { name: 'Accept invitation' }).click();
        await page.waitForURL(url => url.pathname !== '/app/invitation' && url.pathname !== '/app');
        await signIn(page, uniqueEmail('switch-unrelated'), { from: '/app/sign-in?add=1' });
        // Where the project's link sends this account
        const next = `/app/projects/${project}`;
        await page.goto(next);
        await expect(page.getByRole('heading', { name: 'Switch account or workspace' })).toBeVisible();
        const route = `${new URL(page.url()).pathname}${new URL(page.url()).search}`;
        await hardLoad(capture, page, baseURL!, { id: 'hard-switch-project-account', surface: 'app', group: 'Full load: static shell', title: 'Switch account for a project',
            route, note: 'Reached from a project\'s link, as a visit has it: the sign-in card\'s frame, then the accounts that can open the link.' }, { loaded: true });
    } finally {
        capture.save();
        await site.close();
    }
});
