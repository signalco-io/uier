import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { animationsFinished, showcaseHint, toolbar } from './support/toolbar';

/** Scans the page, or only the parts `include` selects */
export async function expectNoAxeViolations(page: Page, { include = [] }: { include?: string[] } = {}) {
    // App Router can stream metadata after the visible page. Scan the settled document title.
    await expect(page).toHaveTitle(/\S/);
    const scan = () => {
        const builder = new AxeBuilder({ page });
        for (const selector of include) builder.include(selector);
        return builder
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag21aaa'])
            // The landing's animated scene is a picture (hidden from assistive technologies, text that
            // is part of a picture is exempt from contrast): mid-fade frames would fail at random.
            // So would its caption's (also hidden), which first fades in 700 ms after it comes into view.
            .exclude('[data-landing-scene]')
            .exclude('#how-it-works ~ p[aria-hidden="true"]')
            .analyze();
    };
    let accessibilityScanResults = await scan();
    // A refresh (after an action, or a realtime change) re-renders the streamed metadata, and React swaps the <title>
    // out and back in: a scan in that instant finds none. Scan again once the page has its title back; a page
    // without one still fails.
    if (accessibilityScanResults.violations.some(violation => violation.id === 'document-title')) {
        await expect(page).toHaveTitle(/\S/);
        accessibilityScanResults = await scan();
    }
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
