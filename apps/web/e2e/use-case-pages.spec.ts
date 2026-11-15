import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import { useCases } from '../src/lib/useCases';
import { assertAccessibility } from './accessibility';

const pages = [
    {
        ...useCases.clientFeedback,
        heading: 'Collect client feedback on the live site',
        sections: ['A comment everyone can find', 'One round, from brief to handoff', 'Choose who takes part', 'Send the context the review needs', 'Check the result, then close the round']
    },
    {
        ...useCases.bugReporting,
        heading: 'Report website bugs with the context to reproduce them',
        sections: ['A booking bug, ready to hand off', 'Add evidence you chose to send', 'Give the fix a next owner', 'Keep private details out of the report', 'Check the result with the reporter']
    },
    {
        ...useCases.userAcceptanceTesting,
        heading: 'Run a manual acceptance review on the live site',
        sections: ['Agree what this round should prove', 'Review one environment at a time', 'Record findings and gaps', 'Keep the fix and its review distinct', 'Hand off what remains']
    }
];

for (const useCase of pages) {
    test(`${useCase.path} explains a distinct review with useful next steps`, async ({ page }) => {
        expect((await page.goto(useCase.path))?.status()).toBe(200);
        await expect(page).toHaveTitle(`${useCase.title} · ${brand.name}`);
        const main = page.getByRole('main');
        await expect(main.getByRole('heading', { level: 1 })).toHaveText(useCase.heading);
        for (const name of useCase.sections)
            await expect(main.getByRole('region', { name, exact: true })).toBeVisible();
        await expect(main.getByRole('link', { name: 'Create a project', exact: true })).toHaveAttribute('href', '/app');
        await expect(main.getByRole('link', { name: 'privacy policy', exact: true })).toHaveAttribute('href', '/legal/privacy-policy');
        await expect(main).toContainText('off by default');
        await expect(main).toContainText('override');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });

    test(`${useCase.path} is accessible in light and dark`, async ({ page }) => {
        await assertAccessibility(page, useCase.path);
        await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
        await assertAccessibility(page, useCase.path);
        await expect(page.locator('html')).toHaveClass(/dark/);
    });
}

test('a client review distinguishes guest access and a checked fix from release approval', async ({ page }) => {
    await page.goto(useCases.clientFeedback.path);
    await expect(page.getByRole('region', { name: 'Choose who takes part' })).toContainText('a client label does not grant access');
    const handoff = page.getByRole('region', { name: 'Check the result, then close the round' });
    await expect(handoff).toContainText('same visitor identity');
    await expect(handoff).toContainText('Confirming one fix does not approve a release');
    await handoff.getByRole('link', { name: 'manual acceptance-review workflow' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(useCases.userAcceptanceTesting.path);
    await expect(page.getByRole('table')).toContainText('Not checked: the reviewer ran out of time');
});

test('bug reporting distinguishes chosen clips from automatic diagnostics', async ({ page }) => {
    await page.goto(useCases.bugReporting.path);
    const report = page.getByRole('region', { name: 'A booking bug, ready to hand off' });
    for (const label of ['Expected', 'Actual', 'Steps', 'Environment', 'Evidence'])
        await expect(report.getByText(label, { exact: true })).toBeVisible();
    const evidence = page.getByRole('region', { name: 'Add evidence you chose to send' });
    await expect(evidence).toContainText('60 seconds and 25 MiB');
    await expect(evidence).toContainText('no automatic session replay, console-log capture or network-traffic recording');
    await expect(page.getByRole('region', { name: 'Keep private details out of the report' })).toContainText('Video redaction is not available');
});

test('the canonical annotation page connects the bug and manual acceptance journeys', async ({ page }) => {
    await page.goto('/features/pinned-comments');
    const workflows = page.getByRole('region', { name: 'Put the annotation to work' });
    await workflows.getByRole('link', { name: 'Website bug reporting' }).click();
    await expect(page).toHaveURL(useCases.bugReporting.path);
    await page.getByRole('region', { name: 'Check the result with the reporter' }).getByRole('link', { name: 'manual acceptance review' }).click();
    await expect(page).toHaveURL(useCases.userAcceptanceTesting.path);
    await expect(page.getByRole('region', { name: 'Keep the fix and its review distinct' })).toContainText('Fix verification is off by default');
    await expect(page.getByRole('region', { name: 'Hand off what remains' })).toContainText('Confirming one fix does not approve the whole release');
});
