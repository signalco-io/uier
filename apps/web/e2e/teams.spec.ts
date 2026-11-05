import { expect, test, type Page } from '@playwright/test';
import { signIn, createProject, uniqueEmail } from './support/app';
import { expectNoAxeViolations } from './accessibility';
import { newVisitor } from './support/toolbar';

async function createTeam(page: Page, name: string) {
    await page.goto('/app/teams');
    await page.getByRole('button', { name: 'Create team', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Team name').fill(name);
    await dialog.getByLabel('Description').fill('People who review the product.');
    await dialog.getByRole('button', { name: 'Save team' }).click();
    await dialog.getByRole('link', { name: 'Open team' }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    return page.url();
}

test('admins manage team-only external access, preview overlapping grants and archive/restore safely', async ({
    page,
    browser
}, testInfo) => {
    test.setTimeout(120_000);
    await signIn(page, uniqueEmail('team-admin'));
    const alpha = await createProject(page, { name: 'Alpha team project', urls: ['https://alpha.example'] });
    const beta = await createProject(page, { name: 'Other client project', urls: ['https://beta.example'] });
    const teamUrl = await createTeam(page, 'Product review');
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    await expectNoAxeViolations(page);
    const projects = page.getByRole('region', { name: 'Projects', exact: true });
    await projects.getByRole('checkbox', { name: /Alpha team project/ }).check();
    await projects.getByRole('button', { name: 'Review project changes' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('0 accepted people');
    await dialog.getByRole('button', { name: 'Confirm changes' }).click();
    await expect(dialog).not.toBeVisible();

    const email = uniqueEmail('external-team-reviewer');
    await page
        .getByRole('region', { name: 'People', exact: true })
        .getByRole('button', { name: 'Invite', exact: true })
        .click();
    await dialog.getByLabel('Email', { exact: true }).fill(email);
    await expect(dialog.getByRole('checkbox', { name: 'Product review', exact: true })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Alpha team project', exact: true })).not.toBeChecked();
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    const invitation = await dialog.getByRole('link', { name: 'Open the invitation link' }).getAttribute('href');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();

    // The workspace's Activity tab says what happened in sentences, never raw events or ids
    await page.goto('/app/workspace/activity');
    const changes = page.getByRole('list', { name: 'Access changes' });
    await expect(changes).toContainText('created the team Product review.');
    await expect(changes).toContainText('changed the projects of Product review.');
    await expect(changes).toContainText('Added Alpha team project.');
    await expect(changes).toContainText(`invited ${email} to the Product review team.`);
    await expect(changes).not.toContainText('invitation.created');
    await expect(changes).not.toContainText('invitation_');
    await expect(page.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: 'Activity' })).toHaveAttribute('aria-current', 'page');
    await expectNoAxeViolations(page);
    const reviewer = await newVisitor(browser, testInfo);
    try {
        await reviewer.page.goto(invitation!);
        await reviewer.page.getByRole('button', { name: 'Accept invitation' }).click();
        await reviewer.page.waitForURL(/\/app\/projects/);
        await expect(reviewer.page.getByRole('main')).toContainText('Alpha team project');
        expect((await reviewer.page.goto(`/app/projects/${beta}`))?.status()).toBe(404);
        expect((await reviewer.page.goto('/app/teams'))?.status()).toBe(404);
        expect((await reviewer.page.goto('/app/workspace/activity'))?.status()).toBe(404);
        await reviewer.page.goto('/app/account');
        await expect(reviewer.page.getByRole('region', { name: 'Your workspace access' })).toContainText(
            'Product review'
        );
        await expect(reviewer.page.getByRole('region', { name: 'Your workspace access' })).not.toContainText(
            'Other client'
        );

        await page.goto(teamUrl);
        await page.getByRole('button', { name: 'Archive team', exact: true }).click();
        await expect(dialog).toContainText('Alpha team project: Loses access');
        await dialog.getByRole('button', { name: 'Confirm changes' }).click();
        await expect(page.getByRole('button', { name: 'Restore team' })).toBeVisible();
        expect((await reviewer.page.goto(`/app/projects/${alpha}`))?.status()).toBe(404);
        await page.getByRole('button', { name: 'Restore team' }).click();
        await dialog.getByRole('button', { name: 'Confirm changes' }).click();
        await expect(page.getByRole('button', { name: 'Archive team', exact: true })).toBeVisible();
        await expect(projects.getByRole('checkbox', { name: /Alpha team project/ })).not.toBeChecked();
        expect((await reviewer.page.goto(`/app/projects/${alpha}`))?.status()).toBe(404);
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.reload();
        await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    await expectNoAxeViolations(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath('team-detail-dark.png'), fullPage: true });
        await page.getByRole('button', { name: 'Delete team', exact: true }).focus();
        await page.keyboard.press('Enter');
        await expect(dialog).toHaveAccessibleName('Permanently delete this team?');
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Delete team', exact: true })).toBeFocused();
    } finally {
        await reviewer.context.close();
    }
});

test('project people and teams show access as badges, with unavailable removals explained', async ({ page }) => {
    await signIn(page, uniqueEmail('project-access-admin'));
    const project = await createProject(page, { name: 'Badge access project', urls: ['https://badges.example'] });
    await page.goto('/app/teams');
    // A team of people already in the workspace is its own, clearly named flow
    await expect(page.getByRole('button', { name: 'Group existing people' })).toBeVisible();
    await page.getByRole('button', { name: 'Create team', exact: true }).first().click();
    await page.getByRole('dialog').getByLabel('Team name').fill('Design review');
    await page.getByRole('dialog').getByRole('button', { name: 'Save team' }).click();
    // The dialog stays open with Open team; closing it shows the new team in the list
    await expect(page.getByRole('dialog').getByRole('link', { name: 'Open team' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('list', { name: 'Active teams' })).toContainText('Design review');
    await page.goto(`/app/projects/${project}/settings/people`);
    const section = page.getByRole('region', { name: 'People and teams' });

    const teams = section.getByRole('list', { name: /Teams/ });
    await expect(teams.getByRole('listitem')).toHaveCount(1);
    await expect(teams).not.toContainText('Shared');
    await teams.getByRole('button', { name: 'Share with Design review' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Confirm changes' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(teams).toContainText('Shared');
    await expect(teams.getByRole('button', { name: 'Remove Design review' })).toBeVisible();

    // The admin has workspace-wide access: Remove stays in place, disabled, and says why
    const people = section.getByRole('list', { name: /People with access/ });
    await expect(people.getByRole('listitem')).toHaveCount(1);
    // Icons in the chips, not letters that read as part of their labels
    await expect(people.locator('[data-slot="badge"]')).toHaveText(['Admin', 'All projects']);
    const remove = people.getByRole('button', { name: /Remove .*'s access/ });
    await expect(remove).toHaveAttribute('aria-disabled', 'true');
    // Base UI tooltips are visual only: the reason is also the button's description
    await expect(remove).toHaveAccessibleDescription('Workspace admins can review every project.');
    await remove.hover();
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('Workspace admins can review every project.');

    // Invite from here starts with this project chosen
    await section.getByRole('button', { name: 'Invite', exact: true }).click();
    await expect(dialog.getByRole('checkbox', { name: 'Badge access project', exact: true })).toBeChecked();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).not.toBeVisible();

    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    await expectNoAxeViolations(page);
});
