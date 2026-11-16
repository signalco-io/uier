import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { projectPublicId, createProject, openProjectInvite, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { newVisitor } from './support/toolbar';

test('Azure DevOps sign-in, destination choices, sync controls, backfill and disconnect stay admin-only', async ({ page, browser, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    await signIn(page, uniqueEmail('ado-admin'));
    const projectId = await createProject(page, { urls: [baseURL!], name: 'Azure DevOps review' });
    const settingsUrl = `/app/projects/${projectId}/settings/integrations/azure-devops`;
    await page.goto(settingsUrl);
    const section = page.getByRole('region', { name: 'Azure DevOps', exact: true });
    await expect(section).toContainText('Not connected');
    const connect = section.getByRole('link', { name: 'Connect Azure DevOps', exact: true });
    await expect(connect).toHaveAttribute('href', `/app/azure-devops/connect?project=${projectId}`);
    // A prefetch never starts authorization or changes the connection.
    const prefetch = await page.request.get(`/app/azure-devops/connect?project=${projectId}`, { headers: { Purpose: 'prefetch' }, maxRedirects: 0 });
    expect(prefetch.status()).toBe(302);
    expect(new URL(prefetch.headers().location!).pathname).toBe(settingsUrl);
    await connect.click();
    await expect(page.getByRole('heading', { name: 'Sign in to the Azure DevOps test organization' })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('scope')).not.toContain('/vso.code');
    await page.getByRole('button', { name: 'Cancel Azure DevOps access' }).click();
    await expect(page).toHaveURL(new RegExp(`${settingsUrl}\\?azure-devops=denied$`));
    await expect(section).toContainText('The Azure DevOps connection was canceled.');
    await expect(page.getByText('Stub provider error')).toHaveCount(0);
    await section.getByRole('link', { name: 'Connect Azure DevOps', exact: true }).click();
    await page.getByRole('button', { name: 'Accept Azure DevOps access' }).click();
    await expect(page).toHaveURL(new RegExp(`${settingsUrl}\\?azure-devops=connected$`));
    await expect(section).toContainText('Choose a destination');
    const details = section.locator('[data-integration-details]');
    await expect(details.locator('dt')).toHaveText(['Connected as', 'Pull requests']);
    await expect(details.locator('dd')).toContainText(['Test Microsoft user', 'Plain links']);
    // Before a destination is chosen there is nothing to turn on, and the rare actions stay closed
    await expect(section.getByRole('switch')).toHaveCount(0);
    await expect(section.getByRole('button', { name: 'Disconnect Azure DevOps', exact: true })).toHaveCount(0);
    const organizationRequest = page.waitForRequest(request => request.method() === 'POST' && Boolean(request.headers()['next-action']));
    await section.getByRole('button', { name: 'Load organizations', exact: true }).click();
    const actionRequest = await organizationRequest;
    await section.getByRole('combobox', { name: 'Organization', exact: true }).click();
    await page.getByRole('option', { name: 'uier-test', exact: true }).click();
    await section.getByRole('button', { name: 'Load projects', exact: true }).click();
    await section.getByRole('combobox', { name: 'Project', exact: true }).click();
    await page.getByRole('option', { name: 'Website', exact: true }).click();
    await section.getByRole('button', { name: 'Load project options', exact: true }).click();
    await section.getByRole('combobox', { name: 'Work item type', exact: true }).click();
    await expect(page.getByRole('option', { name: 'Shared Steps', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: 'Bug', exact: true }).click();
    await section.getByRole('combobox', { name: 'State for open feedback', exact: true }).click();
    await expect(page.getByRole('option', { name: 'Closed', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: 'New', exact: true }).click();
    await section.getByRole('combobox', { name: 'State for done feedback', exact: true }).click();
    await expect(page.getByRole('option', { name: 'Active', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: 'Resolved', exact: true }).click();
    await section.getByRole('combobox', { name: 'Area path (optional)', exact: true }).click();
    await page.getByRole('option', { name: 'Website\\Marketing', exact: true }).click();
    await expectNoAxeViolations(page);
    await section.getByRole('button', { name: 'Save Azure DevOps destination', exact: true }).click();
    await expect(section).toContainText('Sync on');
    await page.reload();
    const destination = ['Test Microsoft user', 'uier-test / Website', 'Bug in Website\\Marketing', 'New / Resolved'];
    await expect(details.locator('dt')).toHaveText(['Connected as', 'Destination', 'Work items', 'States', 'Pull requests']);
    await expect(details.locator('dd')).toContainText([...destination, 'Plain links']);
    // The saved destination comes back in the form; Cancel changes nothing
    const change = section.getByRole('button', { name: 'Change destination', exact: true });
    await expect(section.getByRole('combobox')).toHaveCount(0);
    await change.click();
    await expect(change).toHaveAttribute('aria-expanded', 'true');
    await expect(section.getByRole('combobox', { name: 'Organization', exact: true })).toContainText('uier-test');
    await expect(section.getByRole('combobox', { name: 'Project', exact: true })).toContainText('Website');
    await expect(section.getByRole('combobox', { name: 'Work item type', exact: true })).toContainText('Bug');
    await expect(section.getByRole('combobox', { name: 'State for done feedback', exact: true })).toContainText('Resolved');
    await expect(section.getByRole('combobox', { name: 'Area path (optional)', exact: true })).toContainText('Website\\Marketing');
    await section.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(section.getByRole('combobox')).toHaveCount(0);
    await expect(change).toBeFocused();
    // Optional code consent is separate from the normal work-item connection.
    const showState = section.getByRole('link', { name: 'Show pull request state', exact: true });
    await expect(showState).toHaveAttribute('href', `/app/azure-devops/connect?project=${projectId}&pullRequests=1`);
    await showState.click();
    expect(new URL(page.url()).searchParams.get('scope')).toContain('/vso.code');
    await expect(page.getByRole('heading', { name: 'Sign in to the Azure DevOps test organization' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel Azure DevOps access' }).click();
    await expect(section).toContainText('Sync on');
    await expect(showState).toBeVisible();
    await showState.click();
    await page.getByRole('button', { name: 'Accept Azure DevOps access' }).click();
    await expect(showState).toHaveCount(0);
    const sync = section.getByRole('switch', { name: 'Sync', exact: true });
    await expect(sync).not.toBeChecked();
    await sync.click();
    await expect(section).toContainText('Sync on');
    await expect(details.locator('dd')).toContainText([...destination, 'Shown with their state']);
    const document = await page.content();
    expect(document).not.toMatch(/ado-test-(?:access|refresh|secret)|"(?:grantId|accessToken|refreshToken|userId)":/);

    // The controls are absent for a project member; a forged action still checks the current admin role.
    await page.goto(`/app/projects/${projectId}`);
    await openProjectInvite(page);
    const invitation = page.getByRole('dialog');
    await invitation.getByLabel('Email', { exact: true }).fill(uniqueEmail('ado-member'));
    await invitation.getByRole('button', { name: 'Send invitation' }).click();
    const invitationLink = await invitation.getByRole('link', { name: 'Open the invitation link' }).getAttribute('href');
    const member = await newVisitor(browser, testInfo);
    try {
        await member.page.goto(invitationLink!);
        await member.page.getByRole('button', { name: 'Accept invitation' }).click();
        const publicId = await projectPublicId(page, projectId);
        await member.page.waitForURL(url => url.searchParams.get('toolbar-code') === publicId);
        await member.page.goto(new URL(settingsUrl, baseURL).href);
        await expect(member.page.getByRole('region', { name: 'Azure DevOps', exact: true })).toHaveCount(0);
        const denied = await member.page.request.get(new URL(`/app/azure-devops/connect?project=${projectId}`, baseURL).href, { maxRedirects: 0 });
        expect(denied.status()).toBe(404);
        const forged = await member.page.request.post(actionRequest.url(), {
            headers: { 'Next-Action': actionRequest.headers()['next-action']!, 'Content-Type': actionRequest.headers()['content-type']!, Origin: new URL(actionRequest.url()).origin },
            data: actionRequest.postDataBuffer()!
        });
        expect(await forged.text()).toContain('Only admins can do this.');
    } finally { await member.context.close(); }

    await page.goto(settingsUrl);
    // The switch saves at once; a backfill needs sync on
    await expect(sync).toBeChecked();
    await sync.click();
    await expect(section).toContainText('Sync off');
    await expect(sync).not.toBeChecked();
    await section.getByRole('button', { name: 'More options', exact: true }).click();
    await expect(section.getByRole('button', { name: 'Backfill existing feedback' })).toHaveCount(0);
    await sync.click();
    await expect(section).toContainText('Sync on');
    await expect(section.getByRole('button', { name: 'Backfill existing feedback', exact: true })).toBeEnabled();
    await setProjectAccess(page, projectId, 'Anyone with the link');
    await page.goto(settingsUrl);
    const source = await page.request.post(`/api/review/${projectId}/comments`, { headers: {
        Origin: new URL(baseURL!).origin, 'X-Uier-Visitor': randomBytes(32).toString('base64url')
    }, data: { path: '/azure-devops-review', text: 'Feedback for an Azure DevOps backfill', authorName: 'Reviewer',
        position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 } } });
    expect(source.status()).toBe(201);
    await section.getByRole('button', { name: 'More options', exact: true }).click();
    await expectNoAxeViolations(page);
    await section.getByRole('button', { name: 'Backfill existing feedback', exact: true }).click();
    await expect(section).toContainText('A backfill of 1 selected threads is queued.');
    await expect(details).toContainText('0 of 1 selected threads queued for delivery.');
    await section.getByRole('button', { name: 'Disconnect Azure DevOps', exact: true }).click();
    const disconnect = page.getByRole('alertdialog');
    await expect(disconnect).toContainText('Existing work items remain in Azure DevOps.');
    await disconnect.getByRole('button', { name: 'Keep connected' }).click();
    await expect(section).toContainText('Sync on');
    await section.getByRole('button', { name: 'Disconnect Azure DevOps', exact: true }).click();
    await disconnect.getByRole('button', { name: 'Disconnect Azure DevOps', exact: true }).click();
    await expect(section.getByRole('link', { name: 'Reconnect Azure DevOps', exact: true })).toBeVisible();
    await page.reload();
    await expect(section.getByRole('switch')).toHaveCount(0);
    await expect(section.getByRole('button', { name: 'More options', exact: true })).toHaveCount(0);
    await expectNoAxeViolations(page);
});
