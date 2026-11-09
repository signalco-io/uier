import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, hydrated, signIn } from './support/app';
import { signToken, verifyToken } from '../src/lib/app/tokens';

// Email domains (`workspaceDomains.ts`): an admin adds the domain of their own email in Workspace
// settings, and a colleague who signs in with an email at it joins with a click. The rules are in
// `workspace-domains.api.spec.ts`.

/** Waits for dialogs and menus to finish animating before an axe scan */
const settled = (page: Page) => page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));

/** The page's session, signed again without an email proof: a passkey sign-in, or an email code over 10 minutes ago */
async function withoutEmailProof(page: Page) {
    // Local runs sign with the development key
    process.env.UIER_LOCAL ??= '1';
    const session = (await page.context().cookies()).find(cookie => cookie.name === 'uier_session')!;
    const { uid } = verifyToken<{ uid: string }>('session', session.value)!;
    return { ...session, value: signToken('session', { uid, iat: Math.floor(Date.now() / 1000) }, 3600) };
}

test('an admin adds their email domain and a colleague joins with a click after signing in', async ({ page, browser }) => {
    test.setTimeout(120_000);
    // A domain of this test only: the server's store is shared by every test of the run
    const domain = `d${randomUUID().slice(0, 8)}.example`;
    const workspaceName = `Acme ${domain}`;
    await signIn(page, `ada@${domain}`, { welcome: 'stay' });
    await page.getByLabel('Workspace name').fill(workspaceName);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForURL(url => url.pathname !== '/app' && url.pathname !== '/app/welcome');

    // A team with a project, which people who join through the domain get
    await createProject(page, { urls: ['https://domains.example'], name: 'Domain site' });
    await page.goto('/app/teams');
    await page.getByRole('button', { name: 'Create team', exact: true }).first().click();
    const teamDialog = page.getByRole('dialog');
    await teamDialog.getByLabel('Team name').fill('Design');
    await teamDialog.getByRole('button', { name: 'Save team' }).click();
    await teamDialog.getByRole('link', { name: 'Open team' }).click();
    const teamProjects = page.getByRole('region', { name: 'Projects', exact: true });
    await teamProjects.getByRole('checkbox', { name: /Domain site/ }).check();
    await teamProjects.getByRole('button', { name: 'Review project changes' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm changes' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // Without a sign-in that proved the email in the last 10 minutes, the domain is suggested but adding it
    // needs a new email sign-in, which comes back to the settings
    await page.context().addCookies([await withoutEmailProof(page)]);
    await page.goto('/app/workspace/settings');
    const domains = page.getByRole('region', { name: 'Email domains', exact: true });
    await expect(domains).toContainText('No domains yet.');
    await expect(domains).toContainText(`You can add ${domain}, the domain of your email.`);
    await expect(domains).toContainText(`To add ${domain}, sign in again with your email.`);
    await expect(domains.getByRole('button', { name: `Add ${domain}` })).toHaveCount(0);
    await hydrated(domains.getByRole('button', { name: 'Sign in again', exact: true }));
    await domains.getByRole('button', { name: 'Sign in again', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/app/sign-in' && url.searchParams.get('next') === '/app/workspace/settings');
    await signIn(page, `ada@${domain}`, { from: page.url() });
    await expect(page).toHaveURL(/\/app\/workspace\/settings$/);
    await expect(domains.getByRole('button', { name: 'Sign in again', exact: true })).toHaveCount(0);
    await hydrated(domains.getByRole('button', { name: `Add ${domain}` }));
    await domains.getByRole('button', { name: `Add ${domain}` }).click();
    const dialog = page.getByRole('dialog', { name: `Add ${domain}` });
    await dialog.getByRole('checkbox', { name: 'Design', exact: true }).check();
    await settled(page);
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Add domain', exact: true }).click();
    await expect(dialog).toBeHidden();
    const row = domains.getByRole('listitem').filter({ hasText: domain });
    await expect(row).toContainText('They join Design.');
    await expect(domains.getByRole('button', { name: `Add ${domain}` })).toHaveCount(0);
    await settled(page);
    await expectNoAxeViolations(page);

    // A colleague registers with an email at the domain: nobody is added until they choose to join
    const colleagueContext = await browser.newContext();
    const colleague = await colleagueContext.newPage();
    await signIn(colleague, `maya@${domain}`, { welcome: 'stay' });
    await expect(colleague).toHaveURL(/\/app\/join\?next=%2Fapp%2Fwelcome$/);
    await expect(colleague.getByRole('heading', { level: 1, name: `Join ${workspaceName}` })).toBeVisible();
    await expect(colleague.getByRole('listitem')).toContainText(workspaceName);
    await expectNoAxeViolations(colleague);
    // The proof runs out before the click: joining is checked again and refused, and Sign in again comes back here
    await colleagueContext.addCookies([await withoutEmailProof(colleague)]);
    await colleague.getByRole('button', { name: `Join ${workspaceName}`, exact: true }).click();
    await expect(colleague.getByText(/sign in again with your email\./).first()).toBeVisible();
    await expect(colleague.getByText(workspaceName)).toHaveCount(0);
    await expectNoAxeViolations(colleague);
    await colleague.getByRole('button', { name: 'Sign in again', exact: true }).click();
    await colleague.waitForURL(url => url.pathname === '/app/sign-in');
    await signIn(colleague, `maya@${domain}`, { from: colleague.url(), welcome: 'stay' });
    await expect(colleague).toHaveURL(/\/app\/join\?next=%2Fapp%2Fwelcome$/);
    await hydrated(colleague.getByRole('button', { name: `Join ${workspaceName}`, exact: true }));
    await colleague.getByRole('button', { name: `Join ${workspaceName}`, exact: true }).click();

    // The first-run step asks only for their name: they have no workspace of their own to name
    await colleague.waitForURL(url => url.pathname === '/app/welcome');
    await expect(colleague.getByLabel('Workspace name')).toHaveCount(0);
    await colleague.getByRole('button', { name: 'Skip', exact: true }).click();
    await colleague.waitForURL(url => url.pathname === '/app/projects');
    await expect(colleague.getByRole('link', { name: /Domain site/ }).first()).toBeVisible();
    await colleagueContext.close();

    // The admin sees who joined, and how, in Activity
    await page.goto('/app/workspace/activity');
    const changes = page.getByRole('list', { name: 'Access changes' });
    await expect(changes).toContainText(`added the email domain ${domain}.`);
    await expect(changes).toContainText(`joined through ${domain} as a commenter.`);

    // Removing the domain keeps the person who joined
    await page.goto('/app/workspace/settings');
    await hydrated(row.getByRole('button', { name: `Remove ${domain}` }));
    await row.getByRole('button', { name: `Remove ${domain}` }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(domains).toContainText('No domains yet.');
    await page.goto('/app/workspace/users');
    await expect(page.getByText(`maya@${domain}`).first()).toBeVisible();
});
