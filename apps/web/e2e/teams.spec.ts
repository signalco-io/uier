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
    const reviewer = await newVisitor(browser, testInfo);
    try {
        await reviewer.page.goto(invitation!);
        await reviewer.page.getByRole('button', { name: 'Accept invitation' }).click();
        await reviewer.page.waitForURL(/\/app\/projects/);
        await expect(reviewer.page.getByRole('main')).toContainText('Alpha team project');
        expect((await reviewer.page.goto(`/app/projects/${beta}`))?.status()).toBe(404);
        expect((await reviewer.page.goto('/app/teams'))?.status()).toBe(404);
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
