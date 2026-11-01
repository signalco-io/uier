import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, signIn, uniqueEmail } from './support/app';

test('Integrations lists services to connect, then connected ones that open their own page', async ({ page, baseURL }) => {
    await signIn(page, uniqueEmail('integrations-overview'));
    const projectId = await createProject(page, { urls: [baseURL!], name: 'Integrations overview' });
    const overviewUrl = `/app/projects/${projectId}/settings/integrations`;
    await page.goto(overviewUrl);
    const available = page.getByRole('list', { name: 'Available integrations' });
    await expect(available.getByRole('heading', { level: 3 })).toHaveText(['Notion', 'GitHub', 'Linear', 'Azure DevOps', 'Slack']);
    await expect(available.getByRole('link', { name: 'Connect Notion', exact: true })).toHaveAttribute('href', `/app/notion/connect?project=${projectId}`);
    await expect(page.getByRole('list', { name: 'Connected integrations' })).toHaveCount(0);
    await expectNoAxeViolations(page);

    await available.getByRole('link', { name: 'Details about Slack', exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}${overviewUrl}/slack`);
    await expect(page.getByRole('region', { name: 'Slack', exact: true })).toContainText('Not connected');
    await expect(page.getByRole('region', { name: 'Two-way status sync', exact: true })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Project settings' }).getByRole('link', { name: 'Integrations' })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('link', { name: 'All integrations', exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}${overviewUrl}`);

    await available.getByRole('link', { name: 'Connect Notion', exact: true }).click();
    await page.getByRole('button', { name: 'Allow Notion connection' }).click();
    await expect(page).toHaveURL(`${baseURL}${overviewUrl}/notion?notion=connected`);
    await page.goto(overviewUrl);
    await expect(available.getByRole('heading', { level: 3 })).toHaveText(['GitHub', 'Linear', 'Azure DevOps', 'Slack']);
    const connected = page.getByRole('list', { name: 'Connected integrations' }).getByRole('link');
    await expect(connected).toHaveCount(1);
    await expect(connected).toContainText('Notion');
    await expect(connected).toContainText('Test workspace');
    await expect(connected).toContainText('Choose a destination');
    await expectNoAxeViolations(page);
    await connected.click();
    await expect(page).toHaveURL(`${baseURL}${overviewUrl}/notion`);
    await expect(page.getByRole('region', { name: 'Notion', exact: true })).toContainText('Connected workspace: Test workspace.');
    expect((await page.request.get(`${overviewUrl}/unknown`)).status()).toBe(404);
});
