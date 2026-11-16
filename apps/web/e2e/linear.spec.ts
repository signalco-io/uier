import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { projectPublicId, createProject, openProjectInvite, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { newVisitor } from './support/toolbar';

test('Linear OAuth, explicit destination choices, sync controls, backfill and disconnect stay admin-only', async ({ page, browser, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    await signIn(page, uniqueEmail('linear-admin'));
    const projectId = await createProject(page, { urls: [baseURL!], name: 'Linear review' });
    const settingsUrl = `/app/projects/${projectId}/settings/integrations/linear`;
    await page.goto(settingsUrl);
    const linear = page.getByRole('region', { name: 'Linear', exact: true });
    await expect(linear).toContainText('Not connected');
    const connect = linear.getByRole('link', { name: 'Connect Linear', exact: true });
    await expect(connect).toHaveAttribute('href', `/app/linear/connect?project=${projectId}`);
    // A prefetch never starts authorization or changes the connection.
    const prefetch = await page.request.get(`/app/linear/connect?project=${projectId}`, { headers: { Purpose: 'prefetch' }, maxRedirects: 0 });
    expect(prefetch.status()).toBe(302);
    expect(new URL(prefetch.headers().location!).pathname).toBe(settingsUrl);
    await connect.click();
    await expect(page.getByRole('heading', { name: 'Connect Linear test workspace' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel Linear connection' }).click();
    await expect(page).toHaveURL(new RegExp(`${settingsUrl}\\?linear=denied$`));
    await expect(linear).toContainText('The Linear connection was canceled.');
    await linear.getByRole('link', { name: 'Connect Linear', exact: true }).click();
    await page.getByRole('button', { name: 'Allow Linear connection' }).click();
    await expect(page).toHaveURL(new RegExp(`${settingsUrl}\\?linear=connected$`));
    await expect(linear).toContainText('Choose a destination');
    await expect(linear.getByRole('combobox')).toHaveCount(0);
    // Before a destination is chosen there is nothing to turn on, and the rare actions stay closed
    await expect(linear.getByRole('switch')).toHaveCount(0);
    await expect(linear.getByRole('button', { name: 'Disconnect Linear', exact: true })).toHaveCount(0);
    const teamRequest = page.waitForRequest(request => request.method() === 'POST' && Boolean(request.headers()['next-action']));
    await linear.getByRole('button', { name: 'Load teams', exact: true }).click();
    const actionRequest = await teamRequest;
    await linear.getByRole('combobox', { name: 'Team', exact: true }).click();
    await page.getByRole('option', { name: 'Engineering', exact: true }).click();
    await linear.getByRole('button', { name: 'Load team options', exact: true }).click();
    await linear.getByRole('combobox', { name: 'Linear project (optional)', exact: true }).click();
    await page.getByRole('option', { name: 'Website', exact: true }).click();
    await linear.getByRole('combobox', { name: 'State for open feedback', exact: true }).click();
    await expect(page.getByRole('option', { name: 'Done', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: 'Todo', exact: true }).click();
    await linear.getByRole('combobox', { name: 'State for done feedback', exact: true }).click();
    await expect(page.getByRole('option', { name: 'Todo', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: 'Done', exact: true }).click();
    await linear.getByRole('checkbox', { name: 'Website feedback', exact: true }).check();
    await linear.getByRole('checkbox', { name: 'Include screenshots', exact: true }).check();
    await expectNoAxeViolations(page);
    await linear.getByRole('button', { name: 'Save Linear destination', exact: true }).click();
    await expect(linear).toContainText('Sync on');
    await page.reload();
    const details = linear.locator('[data-integration-details]');
    await expect(details.locator('dt')).toHaveText(['Organization', 'Destination', 'Screenshots']);
    await expect(details.locator('dd')).toContainText(['Test organization', 'Engineering / Website', 'On']);
    // The saved destination comes back in the form; Cancel changes nothing
    const change = linear.getByRole('button', { name: 'Change destination', exact: true });
    await expect(linear.getByRole('combobox')).toHaveCount(0);
    await change.click();
    await expect(change).toHaveAttribute('aria-expanded', 'true');
    await expect(linear.getByRole('combobox', { name: 'Team', exact: true })).toContainText('Engineering');
    await expect(linear.getByRole('combobox', { name: 'Linear project (optional)', exact: true })).toContainText('Website');
    await expect(linear.getByRole('combobox', { name: 'State for open feedback', exact: true })).toContainText('Todo');
    await expect(linear.getByRole('checkbox', { name: 'Website feedback', exact: true })).toBeChecked();
    await expect(linear.getByRole('checkbox', { name: 'Include screenshots', exact: true })).toBeChecked();
    await linear.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(linear.getByRole('combobox')).toHaveCount(0);
    await expect(change).toBeFocused();
    await change.click();
    await linear.getByRole('checkbox', { name: 'Include screenshots', exact: true }).uncheck();
    await linear.getByRole('button', { name: 'Save Linear destination', exact: true }).click();
    await expect(details.locator('dd')).toContainText(['Test organization', 'Engineering / Website', 'Off']);
    await expect(linear.getByRole('combobox')).toHaveCount(0);
    await expect(change).toBeFocused();
    const document = await page.content();
    expect(document).not.toMatch(/linear-test-(?:access|refresh|secret)|"(?:grantId|accessToken|refreshToken)":/);

    // The controls are absent for a project member; a forged action still checks the current admin role.
    await page.goto(`/app/projects/${projectId}`);
    await openProjectInvite(page);
    const invitation = page.getByRole('dialog');
    await invitation.getByLabel('Email', { exact: true }).fill(uniqueEmail('linear-member'));
    await invitation.getByRole('button', { name: 'Send invitation' }).click();
    const invitationLink = await invitation.getByRole('link', { name: 'Open the invitation link' }).getAttribute('href');
    const member = await newVisitor(browser, testInfo);
    try {
        await member.page.goto(invitationLink!);
        await member.page.getByRole('button', { name: 'Accept invitation' }).click();
        const publicId = await projectPublicId(page, projectId);
        await member.page.waitForURL(url => url.searchParams.get('toolbar-code') === publicId);
        await member.page.goto(new URL(settingsUrl, baseURL).href);
        await expect(member.page.getByRole('region', { name: 'Linear', exact: true })).toHaveCount(0);
        const denied = await member.page.request.get(new URL(`/app/linear/connect?project=${projectId}`, baseURL).href, { maxRedirects: 0 });
        expect(denied.status()).toBe(404);
        const forged = await member.page.request.post(actionRequest.url(), {
            headers: { 'Next-Action': actionRequest.headers()['next-action']!, 'Content-Type': actionRequest.headers()['content-type']!, Origin: new URL(actionRequest.url()).origin },
            data: actionRequest.postDataBuffer()!
        });
        expect(await forged.text()).toContain('Only admins can do this.');
    } finally { await member.context.close(); }

    await page.goto(settingsUrl);
    // The switch saves at once; a backfill needs sync on
    const sync = linear.getByRole('switch', { name: 'Sync', exact: true });
    await expect(sync).toBeChecked();
    await sync.click();
    await expect(linear).toContainText('Sync off');
    await expect(sync).not.toBeChecked();
    await linear.getByRole('button', { name: 'More options', exact: true }).click();
    await expect(linear.getByRole('button', { name: 'Backfill existing feedback' })).toHaveCount(0);
    await sync.click();
    await expect(linear).toContainText('Sync on');
    await expect(linear.getByRole('button', { name: 'Backfill existing feedback', exact: true })).toBeEnabled();
    await setProjectAccess(page, projectId, 'Anyone with the link');
    await page.goto(settingsUrl);
    const source = await page.request.post(`/api/review/${projectId}/comments`, { headers: {
        Origin: new URL(baseURL!).origin, 'X-Uier-Visitor': randomBytes(32).toString('base64url')
    }, data: { path: '/linear-review', text: 'Feedback for Linear backfill', authorName: 'Reviewer',
        position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 } } });
    expect(source.status()).toBe(201);
    await linear.getByRole('button', { name: 'More options', exact: true }).click();
    await expectNoAxeViolations(page);
    await linear.getByRole('button', { name: 'Backfill existing feedback', exact: true }).click();
    await expect(linear).toContainText('A backfill of 1 selected threads is queued.');
    await expect(details).toContainText('0 of 1 selected threads queued for delivery.');
    await linear.getByRole('button', { name: 'Disconnect Linear', exact: true }).click();
    const disconnect = page.getByRole('alertdialog');
    await expect(disconnect).toContainText('Existing issues, comments and files remain in Linear.');
    await disconnect.getByRole('button', { name: 'Keep connected' }).click();
    await expect(linear).toContainText('Sync on');
    await linear.getByRole('button', { name: 'Disconnect Linear', exact: true }).click();
    await disconnect.getByRole('button', { name: 'Disconnect Linear', exact: true }).click();
    await expect(linear.getByRole('link', { name: 'Reconnect Linear', exact: true })).toBeVisible();
    await page.reload();
    await expect(linear.getByRole('switch')).toHaveCount(0);
    await expect(linear.getByRole('button', { name: 'More options', exact: true })).toHaveCount(0);
    await expectNoAxeViolations(page);
});
