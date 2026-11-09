import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, hydrated, signIn } from './support/app';

// Email domains (`workspaceDomains.ts`): an admin adds the domain of their own email in Workspace
// settings, and a colleague who signs in with an email at it joins with a click. The rules are in
// `workspace-domains.api.spec.ts`.

/** Waits for dialogs and menus to finish animating before an axe scan */
const settled = (page: Page) => page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));

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

    await page.goto('/app/workspace/settings');
    const domains = page.getByRole('region', { name: 'Email domains', exact: true });
    await expect(domains).toContainText('No domains yet.');
    await expect(domains).toContainText(`You can add ${domain}, the domain of your email.`);
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
