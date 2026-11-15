import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import { guides } from '../src/lib/guides';
import { embedScript, cspSnippet } from '../src/lib/app/integration';
import { installationGuides, type InstallationGuideKey } from '../src/lib/guides/installations';
import { assertAccessibility } from './accessibility';
import { createProject, openComment, openOnboardingStep, projectPublicId, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { expectInstallationSuccess } from './support/installation';
import { commentBubble, newVisitor, openThread, toolbar } from './support/toolbar';
import { startGuideInstallationSite } from './support/guideInstallationSite';

for (const platform of Object.keys(installationGuides) as InstallationGuideKey[]) {
    const guide = guides[platform];
    test(`${platform} guide exposes maintained examples, real outline targets and platform limits`, async ({ page }) => {
        await page.goto('/guides');
        await page.getByRole('main').getByRole('link', { name: guide.title, exact: true }).click();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(guide.title);
        await expect(page.getByRole('region', { name: installationGuides[platform].placementTitle }).locator('pre code')).toHaveText(embedScript(brand.url, 'YOUR_PROJECT_CODE'));
        await expect(page.getByRole('region', { name: 'Pin a toolbar version' }).locator('pre code')).toHaveText(embedScript(brand.url, 'YOUR_PROJECT_CODE', 'pinned'));
        await expect(page.getByRole('region', { name: 'Content Security Policy' }).locator('pre code')).toHaveText(cspSnippet(brand.url));
        await expect(page.getByRole('region', { name: 'Remove the installation' })).toContainText('open a fresh page');
        await expect(page.getByRole('region', { name: 'Check the installation' })).toContainText('automatically');
        const outline = await page.getByRole('navigation', { name: 'In this guide' }).getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('href')!));
        for (const target of outline) await expect(page.locator(`main section${target}`)).toHaveCount(1);
        for (const source of installationGuides[platform].sources)
            await expect(page.getByRole('main').getByRole('link', { name: source.title, exact: true })).toHaveAttribute('href', source.href);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (platform === 'wordpress') await expect(page.getByRole('main')).toContainText('plugin-enabled plan');
        if (platform === 'webflow') await expect(page.getByRole('main')).toContainText('Saving custom code alone');
        if (platform === 'shopify') await expect(page.getByRole('main')).toContainText('checkout');
        if (platform === 'react') await expect(page.getByRole('main')).toContainText('no uier npm package');
    });

    test(`${platform} installation guide is accessible in light and dark`, async ({ page }) => {
        for (const colorScheme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
            await assertAccessibility(page, guide.path);
        }
    });
}

for (const platform of ['html', 'react'] as const) {
    test(`${platform} guide installation saves feedback, survives navigation and stops after source removal`, async ({ page, browser, baseURL }, testInfo) => {
        test.setTimeout(60_000);
        const site = await startGuideInstallationSite(new URL(baseURL!).origin, platform);
        const guest = await newVisitor(browser, testInfo);
        try {
            await signIn(page, uniqueEmail(`guide-${platform}`));
            const projectId = await createProject(page, { urls: [site.origin], name: `${platform} installation` });
            const code = await projectPublicId(page, projectId);
            site.install(code, platform === 'html' ? 'pinned' : 'latest');
            await setProjectAccess(page, projectId, 'Anyone with the link');
            await openOnboardingStep(page, projectId, 'check');
            const check = page.getByRole('region', { name: 'Check installation' });
            const opened = page.waitForEvent('popup');
            await check.getByRole('button', { name: 'Check installation', exact: true }).click();
            const popup = await opened;
            await expectInstallationSuccess(check);
            await popup.close();

            const violations: string[] = [];
            guest.page.on('console', message => { if (/Content Security Policy/i.test(message.text())) violations.push(message.text()); });
            await guest.page.goto(`${site.origin}/?toolbar-code=${code}`);
            await expect(toolbar(guest.page)).toBeVisible();
            await guest.page.getByRole('button', { name: 'Add comment', exact: true }).click();
            const heading = (await guest.page.getByRole('heading', { level: 1 }).boundingBox())!;
            await guest.page.mouse.click(heading.x + 20, heading.y + heading.height / 2);
            await guest.page.getByRole('textbox', { name: 'Your name', exact: true }).fill('Guide reviewer');
            const write = guest.page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/review/${code}/comments`);
            const text = `${platform}: show the menu hours`;
            await guest.page.getByRole('textbox', { name: 'Comment', exact: true }).fill(text);
            await guest.page.getByRole('textbox', { name: 'Comment', exact: true }).press('Enter');
            expect((await write).status()).toBe(201);
            await expect(commentBubble(guest.page, 1)).toBeVisible();
            await guest.page.reload();
            await commentBubble(guest.page, 1).click();
            await expect(openThread(guest.page)).toContainText(text);
            await guest.page.keyboard.press('Escape');

            const documentMarker = await guest.page.evaluate(() => { (window as Window & { guideDocument?: string }).guideDocument = 'original'; return 'original'; });
            if (platform === 'react') await guest.page.getByRole('button', { name: 'Next page', exact: true }).click();
            else await guest.page.getByRole('link', { name: 'Next page', exact: true }).click();
            await expect(guest.page.getByRole('heading', { level: 1 })).toHaveText('About');
            await expect(commentBubble(guest.page, 1)).toHaveCount(0);
            await expect(toolbar(guest.page)).toBeVisible();
            expect(await guest.page.evaluate(() => (window as Window & { guideDocument?: string }).guideDocument)).toBe(platform === 'react' ? documentMarker : undefined);
            await guest.page.goBack();
            await expect(guest.page.getByRole('heading', { level: 1 })).toHaveText('Menu');
            await expect(commentBubble(guest.page, 1)).toBeVisible();
            expect(violations).toEqual([]);

            site.remove();
            const fresh = await guest.context.newPage();
            const requestedScripts: string[] = [];
            fresh.on('request', request => { if (/\/toolbar(?:\/|\.js)/.test(new URL(request.url()).pathname)) requestedScripts.push(request.url()); });
            await fresh.goto(`${site.origin}/?toolbar-code=${code}`);
            await expect(fresh.getByRole('heading', { level: 1 })).toHaveText('Menu');
            await expect(fresh.locator('script[data-uier-project]')).toHaveCount(0);
            await expect(fresh.locator('#uier-toolbar')).toHaveCount(0);
            expect(requestedScripts).toEqual([]);
            await fresh.close();

            await page.goto(`/app/projects/${projectId}`);
            await expect(await openComment(page, /^Comment/)).toContainText(text);
        } finally {
            await guest.context.close();
            await site.close();
        }
    });
}
