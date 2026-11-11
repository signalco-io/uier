import { expect, test } from '@playwright/test';
import { appNavigation, createProject, hydrated, signIn, uniqueEmail } from './support/app';
import { toolbar } from './support/toolbar';

test('app navigation preserves the document and feedback toolbar', async ({ page, isMobile }) => {
    test.setTimeout(60_000);
    const openFeedback = async () => {
        await appNavigation(page);
        const button = page.getByRole('button', { name: 'Give feedback', exact: true });
        // With the toolbar mounted, use the mobile sheet's keyboard path; desktop retains its click.
        if (isMobile) await button.press('Enter');
        else await button.click();
    };
    await signIn(page, uniqueEmail('client-navigation'));
    const first = await createProject(page, { urls: ['https://first.example.com'], name: 'First navigation site' });
    const second = await createProject(page, { urls: ['https://second.example.com'], name: 'Second navigation site' });
    await page.goto('/app/account/coding-agents');
    await openFeedback();
    await expect(toolbar(page)).toBeVisible();
    await page.getByRole('textbox', { name: 'Feedback', exact: true }).fill('Draft for coding agents');
    await page.keyboard.press('Escape');
    const host = await page.locator('#uier-toolbar').elementHandle();
    const pill = await page.locator('#uier-feedback-toolbar').elementHandle();
    await page.evaluate(() => Reflect.set(window, '__navigationMarker', 'same document'));
    const documents: string[] = [];
    page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url());
    });
    const preserved = async () => {
        await expect.poll(() => page.evaluate(() => Reflect.get(window, '__navigationMarker'))).toBe('same document');
        expect(await host!.evaluate(element => element.isConnected && element === document.querySelector('#uier-toolbar'))).toBe(true);
        expect(await pill!.evaluate(element => element.isConnected)).toBe(true);
        await expect(toolbar(page)).toBeVisible();
        expect(documents).toEqual([]);
    };
    for (const section of ['General', 'Sign-in', 'Notifications', 'Usage', 'Coding agents']) {
        const link = page.getByRole('navigation', { name: 'Account', exact: true }).getByRole('link', { name: section, exact: true });
        await hydrated(link);
        await link.click();
        await expect(link).toHaveAttribute('aria-current', 'page');
        await preserved();
        if (section === 'General' || section === 'Coding agents') {
            await openFeedback();
            await expect(page.getByRole('textbox', { name: 'Feedback', exact: true }))
                .toHaveValue(section === 'General' ? '' : 'Draft for coding agents');
            await page.keyboard.press('Escape');
        }
    }
    for (const [name, id] of [['First navigation site', first], ['Second navigation site', second]]) {
        const navigation = await appNavigation(page);
        await navigation.getByRole('link', { name, exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/app/projects/${id}$`));
        await preserved();
        await page.getByRole('link', { name: 'Settings', exact: true, disabled: false }).click();
        const sections = page.getByRole('navigation', { name: 'Project settings', exact: true });
        await sections.getByRole('link', { name: 'Installation', exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/app/projects/${id}/settings/installation$`));
        await preserved();
        await sections.getByRole('link', { name: 'General', exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/app/projects/${id}/settings$`));
        await page.getByRole('button', { name: 'Open review', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Review setup', exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/app/projects/${id}/settings/installation$`));
        await preserved();
    }
    await (await appNavigation(page)).getByRole('link', { name: 'Projects', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/projects$/);
    await preserved();
    await (await appNavigation(page)).getByRole('link', { name: 'Workspace', exact: true }).click();
    for (const section of ['Teams', 'Clients', 'Usage', 'Activity', 'Settings', 'Users']) {
        const link = page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('link', { name: section, exact: true });
        await link.click();
        await expect(link).toHaveAttribute('aria-current', 'page');
        await preserved();
    }
    await page.goBack();
    await preserved();
    await page.goForward();
    await preserved();
});
