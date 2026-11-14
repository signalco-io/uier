import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, hydrated, openProjectInvite, signIn, uniqueEmail } from './support/app';
import { newVisitor } from './support/toolbar';

test('workspace Notion project mapping, drafts and sync controls are accessible and admin-only', async ({ page, browser, baseURL }, testInfo) => {
    test.setTimeout(90_000);
    await signIn(page, uniqueEmail('notion-project-admin'));
    await page.goto('/app/workspace/settings#notion-projects');
    const section = page.getByRole('region', { name: 'Projects from Notion', exact: true });
    await expect(section).toContainText('Not connected');
    const prefetch = await page.request.get('/app/notion/projects/connect', { headers: { Purpose: 'prefetch' }, maxRedirects: 0 });
    expect(prefetch.status()).toBe(302); expect(new URL(prefetch.headers().location!).pathname).toBe('/app/workspace/settings');
    await section.getByRole('link', { name: 'Connect Notion', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel Notion connection' }).click();
    await expect(section).toContainText('The Notion connection was canceled.');
    await section.getByRole('link', { name: 'Connect Notion', exact: true }).click();
    await page.getByRole('button', { name: 'Allow Notion connection' }).click();
    await expect(section).toContainText('Sync off');
    await expect(section).toContainText('Test workspace');
    await hydrated(section.getByRole('button', { name: 'Load databases', exact: true }));
    const read = page.waitForRequest(request => request.method() === 'POST' && Boolean(request.headers()['next-action']));
    await section.getByRole('button', { name: 'Load databases', exact: true }).click();
    const readAction = await read;
    await section.getByRole('combobox', { name: 'Database', exact: true }).click();
    await page.getByRole('option', { name: 'Website feedback', exact: true }).click();
    await section.getByRole('button', { name: 'Load fields', exact: true }).click();
    await expect(section.getByRole('combobox', { name: 'Project name column (optional)', exact: true })).toContainText('Name');
    await expect(section.getByRole('checkbox', { name: 'Done', exact: true })).toBeChecked();
    await expect(section.getByRole('checkbox', { name: 'Link', exact: true })).toBeChecked();
    await expectNoAxeViolations(page, { include: ['#notion-projects'] });
    await section.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(section).toContainText('Sync on');
    await page.reload(); await expect(section).toContainText('Sync on');
    await section.getByRole('checkbox', { name: 'Page', exact: true }).uncheck();
    await section.getByRole('checkbox', { name: 'Link', exact: true }).focus();
    await page.keyboard.press('Space');
    await expect(section.getByRole('checkbox', { name: 'Link', exact: true })).not.toBeChecked();
    await expect(section).toContainText('Unsaved changes');
    await expect(section.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await section.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(section.getByRole('checkbox', { name: 'Page', exact: true })).toBeChecked();
    await section.getByRole('button', { name: 'Pause project sync', exact: true }).click();
    await expect(section).toContainText('Sync off');
    await section.getByRole('button', { name: 'Save', exact: true }).click(); await expect(section).toContainText('Sync on');
    expect(await page.content()).not.toMatch(/notion-test-secret|access-[a-f0-9-]{36}|refresh-[a-f0-9-]{36}|v1\.k1\.|"(?:tokens|grantId|botId|connectedBy)":/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // A workspace commenter cannot replay the admin's discovery action.
    const projectId = await createProject(page, { urls: [baseURL!], name: 'Notion permissions' });
    await page.goto(`/app/projects/${projectId}`); await openProjectInvite(page);
    const invite = page.getByRole('dialog');
    await invite.getByLabel('Email', { exact: true }).fill(uniqueEmail('notion-project-member'));
    await invite.getByRole('button', { name: 'Send invitation' }).click();
    const invitationLink = await invite.getByRole('link', { name: 'Open the invitation link' }).getAttribute('href');
    const member = await newVisitor(browser, testInfo);
    try {
        await member.page.goto(invitationLink!); await member.page.getByRole('button', { name: 'Accept invitation' }).click();
        await member.page.waitForURL(url => url.searchParams.has('toolbar-code'));
        expect((await member.page.request.get(new URL('/app/notion/projects/connect', baseURL).href, { maxRedirects: 0 })).status()).toBe(404);
        const forged = await member.page.request.post(readAction.url(), { headers: { 'Next-Action': readAction.headers()['next-action']!,
            'Content-Type': readAction.headers()['content-type']!, Origin: new URL(readAction.url()).origin }, data: readAction.postDataBuffer()! });
        expect(await forged.text()).toContain('Only admins can do this.');
        await member.page.goto(new URL('/app/workspace/settings', baseURL).href);
        await expect(member.page.getByRole('region', { name: 'Projects from Notion', exact: true })).toHaveCount(0);
    } finally { await member.context.close(); }
    await page.goto('/app/workspace/settings#notion-projects');
    await section.getByRole('button', { name: 'Disconnect Notion', exact: true }).click();
    await expect(section).toContainText('Not connected');
    await page.reload(); await expect(section.getByRole('link', { name: 'Connect Notion', exact: true })).toBeVisible();
    await expectNoAxeViolations(page, { include: ['#notion-projects'] });
});

test('workspace Notion setup uses the app language', async ({ page }) => {
    await signIn(page, uniqueEmail('notion-project-language'));
    await page.goto('/app/account');
    const language = page.locator('#app-language');
    await language.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Hrvatski', exact: true }).click();
    await language.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'hr');
    await page.goto('/app/workspace/settings#notion-projects');
    const section = page.getByRole('region', { name: 'Projekti iz Notiona', exact: true });
    await expect(section).toBeVisible();
    await expect(section).toContainText('Izradite jedan projekt po retku baze podataka.');
});
