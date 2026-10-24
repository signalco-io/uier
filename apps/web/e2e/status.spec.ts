import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import { assertAccessibility } from './accessibility';

test('status page shows the live checks', async ({ page }) => {
    const response = await page.goto('/status');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`Status · ${brand.name}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Status' })).toBeVisible();

    // The e2e server's in-memory comments store answers, so everything is operational
    await expect(page.getByRole('status').filter({ hasText: 'All services are operational.' })).toBeVisible();
    const services = page.getByRole('region', { name: 'Services' }).getByRole('listitem');
    await expect(services).toHaveCount(2);
    await expect(services.filter({ hasText: 'Comments' }).locator('[data-state]')).toHaveAttribute('data-state', 'operational');
    await expect(page.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
});

test('status API reports the same checks for monitors', async ({ request }) => {
    const response = await request.get('/api/status');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
    const report = await response.json() as { state: string; checkedAt: string; services: { id: string; state: string }[] };
    expect(report.state).toBe('operational');
    expect(Date.parse(report.checkedAt)).not.toBeNaN();
    expect(report.services.map(service => [service.id, service.state])).toEqual([['website', 'operational'], ['comments', 'operational']]);
});

test('status page is linked from the footer', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Status' })).toHaveAttribute('href', '/status');
});

test('status page is accessible', ({ page }) => assertAccessibility(page, '/status'));
