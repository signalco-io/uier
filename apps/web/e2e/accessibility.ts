import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { animationsFinished, showcaseHint, toolbar } from './support/toolbar';

export async function expectNoAxeViolations(page: Page) {
    // App Router can stream metadata after the visible page. Scan the settled document title.
    await expect(page).toHaveTitle(/\S/);
    const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag21aaa'])
        .analyze();
    expect(accessibilityScanResults.violations).toEqual([]);
}

export async function assertAccessibility(page: Page, url: string) {
    await page.goto(url);
    // These public pages mount the showcase asynchronously. Scan the final hint colours,
    // rather than racing its entrance animation after an arbitrary one-second delay.
    await expect(toolbar(page)).toBeVisible();
    const hint = showcaseHint(page);
    if (await hint.count()) await animationsFinished(hint);
    await expectNoAxeViolations(page);
}
