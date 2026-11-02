import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { KnownPages } from '../src/knownPages';

test('reviewer demo has readable content and keyboard-accessible project setup', async ({ page }) => {
    await page.goto(KnownPages.ExtensionDemo);
    await expect(page.getByRole('heading', { level: 1, name: 'Review this sample page' })).toBeVisible();
    await expect(page.locator('#uier-toolbar')).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Create a test project' })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expectNoAxeViolations(page);
});
