import { expect, test, type Locator, type Page } from '@playwright/test';
import { appNavigation, signIn, uniqueEmail } from './support/app';

// The sidebar's footer (uier #69): Give feedback and the account menu read as one group with the navigation
// above them, with the same height, icon column and label column.

async function box(locator: Locator) {
    const rect = await locator.boundingBox();
    expect(rect).not.toBeNull();
    return rect!;
}

const centre = (rect: { x: number; width: number }) => rect.x + rect.width / 2;

/** Projects (navigation), Give feedback and the account: each row with its icon (the avatar) and label */
async function footerRows(page: Page) {
    const navigation = await appNavigation(page);
    const projects = navigation.getByRole('link', { name: 'Projects', exact: true });
    const feedback = page.getByRole('button', { name: 'Give feedback' });
    const account = page.getByRole('button', { name: /^Account: / });
    return [
        { row: projects, icon: projects.locator('svg').first(), label: projects.getByText('Projects', { exact: true }) },
        { row: feedback, icon: feedback.locator('svg').first(), label: feedback.getByText('Give feedback') },
        { row: account, icon: account.locator('[data-slot=avatar]'), label: account.getByText(/^footer-/) }
    ];
}

test('the sidebar footer lines up with the navigation', async ({ page }, testInfo) => {
    await signIn(page, uniqueEmail('footer'));
    await page.goto('/app/projects');
    const [navigation, ...footer] = await footerRows(page);
    const reference = { row: await box(navigation!.row), icon: await box(navigation!.icon), label: await box(navigation!.label) };
    for (const { row, icon, label } of footer) {
        // Same height as a navigation row, the icon (or avatar) on the same centre line, the label from the same edge
        expect((await box(row)).height).toBeCloseTo(reference.row.height, 0);
        expect(centre(await box(icon))).toBeCloseTo(centre(reference.icon), 0);
        expect((await box(label)).x).toBeCloseTo(reference.label.x, 0);
    }

    if (testInfo.project.name.startsWith('Mobile'))
        return;
    // Collapsed to icons: every icon and the avatar sit centred in its row
    await page.getByRole('button', { name: 'Toggle sidebar' }).first().click();
    await expect(page.locator('[data-slot=sidebar][data-state=collapsed]')).toHaveCount(1);
    await expect(async () => {
        for (const { row, icon } of [navigation!, ...footer]) {
            const rowBox = await box(row);
            expect(rowBox.width).toBeCloseTo(rowBox.height, 0);
            expect(centre(await box(icon))).toBeCloseTo(centre(rowBox), 0);
        }
    }).toPass();
});
