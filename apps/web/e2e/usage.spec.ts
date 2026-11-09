import { expect, test } from '@playwright/test';
import { appNavigation, signIn, uniqueEmail } from './support/app';
import { expectNoAxeViolations } from './accessibility';

test('a member who reached a limit opens its usage from the toast, then the project\'s workspace usage', async ({ page, context, baseURL }, testInfo) => {
    await signIn(page, uniqueEmail('usage'));
    // A signed-in account in uier's user feedback project has three times a visitor's new comments: 30 an hour
    const origin = new URL(baseURL!).origin;
    for (let i = 0; i < 30; i++) {
        const response = await page.request.post('/api/comments', {
            headers: { Origin: origin },
            data: { path: '/app/projects', position: { type: 'page' }, kind: 'feedback', text: `Usage ${i}` }
        });
        expect(response.status(), await response.text()).toBe(201);
    }

    await page.goto('/app/projects');
    await appNavigation(page);
    await page.getByRole('button', { name: 'Give feedback' }).click();
    const dialog = page.getByRole('dialog', { name: 'Send feedback' });
    await dialog.getByRole('textbox', { name: 'Feedback' }).fill('One more than the hour allows');
    await dialog.getByRole('button', { name: 'Send feedback' }).click();

    // The failed send's toast links to the account's usage, at this project
    const notice = page.getByRole('alert').filter({ hasText: 'Your feedback wasn\'t sent' });
    await expect(notice).toContainText('You\'re sending feedback too quickly');
    const link = notice.getByRole('link', { name: 'View usage' });
    await expect(link).toHaveAttribute('href', new RegExp(`^${origin}/app/account/usage#project-[A-Za-z0-9_-]+$`));
    await page.screenshot({ path: testInfo.outputPath('usage-toast.png') });
    const [usage] = await Promise.all([context.waitForEvent('page'), link.click()]);
    await expect(usage).toHaveURL(/\/app\/account\/usage#project-/);
    const code = new URL(usage.url()).hash.replace('#project-', '');
    const project = usage.locator(`[id="project-${code}"]`);
    await expect(project.getByRole('heading', { name: 'uier.io user feedback' })).toBeVisible();
    await expect(project.getByRole('progressbar', { name: 'New comments' })).toHaveAttribute('aria-valuetext', '30 of 30, limit reached');
    await expect(project).toContainText('Limit reached · 30 of 30');
    await expect(project.getByRole('progressbar', { name: 'Replies' })).toHaveAttribute('aria-valuetext', '0 of 30');
    await expect(usage.getByRole('navigation', { name: 'Account' }).getByRole('link', { name: 'Usage' })).toHaveAttribute('aria-current', 'page');
    await expectNoAxeViolations(usage);
    await usage.screenshot({ path: testInfo.outputPath('account-usage.png'), fullPage: true });

    // The project is in uier's workspace, not the person's own (the open one): the page offers to open it
    await usage.goto(`/app/workspace/usage?project=${code}`);
    const elsewhere = usage.getByRole('alert').filter({ hasText: 'uier.io user feedback is in uier' });
    await expect(elsewhere).toBeVisible();
    await expectNoAxeViolations(usage);
    await usage.screenshot({ path: testInfo.outputPath('workspace-usage-elsewhere.png') });
    await elsewhere.getByRole('button', { name: 'Open workspace' }).click();
    await expect(usage).toHaveURL(new RegExp(`/app/workspace/usage\\?project=${code}`));
    await expect(elsewhere).toHaveCount(0);
    const shared = usage.locator(`[id="project-${code}"]`);
    await expect(shared.getByRole('progressbar', { name: 'Screenshots' })).toBeVisible();
    await expect(shared.getByRole('progressbar', { name: 'Rewrite suggestions' })).toBeVisible();
    await expect(shared).toContainText('Each page takes up to 100 new comments a day.');
    await expect(usage.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: 'Usage' })).toBeVisible();
    await expectNoAxeViolations(usage);
    await usage.emulateMedia({ colorScheme: 'dark' });
    await usage.reload();
    await expect(shared.getByRole('progressbar', { name: 'Screenshots' })).toBeVisible();
    await usage.evaluate(async () => {
        // Flush the new theme before waiting for its finite color transitions.
        getComputedStyle(document.body).color;
        await Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
    });
    await expectNoAxeViolations(usage);
    await usage.screenshot({ path: testInfo.outputPath('workspace-usage-dark.png'), fullPage: true });
});
