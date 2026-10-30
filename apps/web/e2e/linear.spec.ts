import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { projectPublicId, createProject, openProjectInvite, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { newVisitor } from './support/toolbar';

test('Linear OAuth, explicit destination choices, sync controls, backfill and disconnect stay admin-only', async ({ page, browser, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    await signIn(page, uniqueEmail('linear-admin'));
    const projectId = await createProject(page, { urls: [baseURL!], name: 'Linear review' });
    const settingsUrl = `/app/projects/${projectId}/settings`;
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
    await expect(page).toHaveURL(new RegExp(`${settingsUrl}\\?linear=denied#linear$`));
    await expect(linear).toContainText('The Linear connection was canceled.');
    await linear.getByRole('link', { name: 'Connect Linear', exact: true }).click();
    await page.getByRole('button', { name: 'Allow Linear connection' }).click();
    await expect(page).toHaveURL(new RegExp(`${settingsUrl}\\?linear=connected#linear$`));
    await expect(linear).toContainText('Choose a destination');
    await expect(linear.getByRole('combobox')).toHaveCount(0);
    await expect(linear.getByRole('button', { name: 'Backfill existing feedback' })).toHaveCount(0);
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
    await expect(linear).toContainText('Destination: Engineering / Website. Screenshots are on.');
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
    await linear.getByRole('button', { name: 'Turn sync off', exact: true }).click();
    await expect(linear).toContainText('Sync off');
    await expect(linear.getByRole('button', { name: 'Backfill existing feedback' })).toHaveCount(0);
    await linear.getByRole('button', { name: 'Turn sync on', exact: true }).click();
    await expect(linear).toContainText('Sync on');
    await setProjectAccess(page, projectId, 'Anyone with the link');
    const source = await page.request.post(`/api/review/${projectId}/comments`, { headers: {
        Origin: new URL(baseURL!).origin, 'X-Uier-Visitor': randomBytes(32).toString('base64url')
    }, data: { path: '/linear-review', text: 'Feedback for Linear backfill', authorName: 'Reviewer',
        position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 } } });
    expect(source.status()).toBe(201);
    await linear.getByRole('button', { name: 'Backfill existing feedback', exact: true }).click();
    await expect(linear).toContainText('A backfill of 1 selected threads is queued.');
    await expect(linear).toContainText('Backfill: 0 of 1 selected threads queued for delivery.');
    await linear.getByRole('button', { name: 'Disconnect Linear', exact: true }).click();
    const disconnect = page.getByRole('alertdialog');
    await expect(disconnect).toContainText('Existing issues, comments and files remain in Linear.');
    await disconnect.getByRole('button', { name: 'Keep connected' }).click();
    await expect(linear).toContainText('Sync on');
    await linear.getByRole('button', { name: 'Disconnect Linear', exact: true }).click();
    await disconnect.getByRole('button', { name: 'Disconnect Linear', exact: true }).click();
    await expect(linear.getByRole('link', { name: 'Reconnect Linear', exact: true })).toBeVisible();
    await page.reload();
    await expect(linear.getByRole('button', { name: 'Turn sync on' })).toHaveCount(0);
    await expectNoAxeViolations(page);
});
