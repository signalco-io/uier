import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { projectPublicId, createProject, openProjectInvite, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { newVisitor } from './support/toolbar';

test('Slack consent, explicit channel choice, optional summaries, test send, backfill and disconnect are admin-only', async ({ page, browser, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    await signIn(page, uniqueEmail('slack-admin'));
    const projectId = await createProject(page, { urls: [baseURL!], name: 'Slack review' });
    const settingsUrl = `/app/projects/${projectId}/settings`;
    await page.goto(settingsUrl);
    const slack = page.getByRole('region', { name: 'Slack', exact: true });
    await expect(slack).toContainText('Not connected');
    await slack.getByRole('link', { name: 'Connect Slack', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Connect Slack test workspace' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel Slack connection' }).click();
    await expect(slack).toContainText('The Slack connection was canceled.');
    await slack.getByRole('link', { name: 'Connect Slack', exact: true }).click();
    await page.getByRole('button', { name: 'Allow Slack connection' }).click();
    await expect(page).toHaveURL(new RegExp(`${settingsUrl}\\?slack=connected#slack$`));
    await expect(slack).toContainText('Choose a channel');
    await expect(slack.getByRole('combobox')).toHaveCount(0);
    const captured = page.waitForRequest(request => request.method() === 'POST' && Boolean(request.headers()['next-action']));
    await slack.getByRole('button', { name: 'Load channels', exact: true }).click();
    const actionRequest = await captured;
    await slack.getByRole('combobox', { name: 'Channel', exact: true }).click();
    await expect(page.getByRole('option', { name: '#uninvited', exact: true })).toHaveCount(0);
    await expect(page.getByRole('option', { name: '#shared', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: '#private-feedback (private)', exact: true }).click();
    await expect(slack.getByRole('checkbox', { name: 'Notify about new replies', exact: true })).not.toBeChecked();
    await expect(slack.getByRole('checkbox', { name: 'Notify about status changes', exact: true })).not.toBeChecked();
    await slack.getByRole('checkbox', { name: 'Notify about status changes', exact: true }).check();
    await slack.getByRole('checkbox', { name: 'Allow shared feedback in this channel', exact: true }).check();
    await expectNoAxeViolations(page);
    await slack.getByRole('button', { name: 'Save Slack channel', exact: true }).click();
    await expect(slack).toContainText('Notifications on');
    await page.reload();
    await expect(slack).toContainText('Channel: #private-feedback.');
    expect(await page.content()).not.toMatch(/xoxb-test-|xoxe-test-|slack-test-secret|"(?:grantId|accessToken|refreshToken)":/);
    await slack.getByRole('button', { name: 'Send a test notification', exact: true }).click();
    await expect(slack).toContainText('The test notification was sent to Slack.');
    await slack.getByRole('button', { name: 'Turn Slack notifications off', exact: true }).click();
    await expect(slack).toContainText('Notifications off');
    await expect(slack.getByRole('button', { name: 'Send a test notification', exact: true })).toHaveCount(0);
    await slack.getByRole('button', { name: 'Turn Slack notifications on', exact: true }).click();
    await expect(slack).toContainText('Notifications on');

    await page.goto(`/app/projects/${projectId}`);
    await openProjectInvite(page);
    const invitation = page.getByRole('dialog');
    await invitation.getByLabel('Email', { exact: true }).fill(uniqueEmail('slack-member'));
    await invitation.getByRole('button', { name: 'Send invitation' }).click();
    const link = await invitation.getByRole('link', { name: 'Open the invitation link' }).getAttribute('href');
    const member = await newVisitor(browser, testInfo);
    try {
        await member.page.goto(link!);
        await member.page.getByRole('button', { name: 'Accept invitation' }).click();
        const publicId = await projectPublicId(page, projectId);
        await member.page.waitForURL(url => url.searchParams.get('toolbar-code') === publicId);
        await member.page.goto(new URL(settingsUrl, baseURL).href);
        await expect(member.page.getByRole('region', { name: 'Slack', exact: true })).toHaveCount(0);
        const denied = await member.page.request.get(new URL(`/app/slack/connect?project=${projectId}`, baseURL).href, { maxRedirects: 0 });
        expect(denied.status()).toBe(404);
        const response = await member.page.request.post(actionRequest.url(), { headers: {
            'Next-Action': actionRequest.headers()['next-action']!, 'Content-Type': actionRequest.headers()['content-type']!, Origin: new URL(actionRequest.url()).origin
        }, data: actionRequest.postDataBuffer()! });
        expect(await response.text()).toContain('Only admins can do this.');
    } finally { await member.context.close(); }

    await page.goto(settingsUrl);
    await setProjectAccess(page, projectId, 'Anyone with the link');
    const created = await page.request.post(`/api/review/${projectId}/comments`, { headers: {
        Origin: new URL(baseURL!).origin, 'X-Uier-Visitor': randomBytes(32).toString('base64url')
    }, data: { path: '/slack-review', text: 'Feedback for an explicit historical Slack send', authorName: 'Reviewer',
        position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 } } });
    expect(created.status()).toBe(201);
    await slack.getByRole('button', { name: 'Send existing feedback to Slack', exact: true }).click();
    const historical = page.getByRole('alertdialog', { name: 'Send existing feedback to Slack?' });
    await expect(historical).toContainText('This can create many Slack notifications.');
    await historical.getByRole('button', { name: 'Send existing feedback', exact: true }).click();
    await expect(slack).toContainText('A backfill of 1 selected threads is queued.');
    await slack.getByRole('button', { name: 'Disconnect Slack', exact: true }).click();
    const disconnect = page.getByRole('alertdialog', { name: 'Disconnect Slack from this project?' });
    await expect(disconnect).toContainText('Existing Slack messages remain.');
    await disconnect.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(slack).toContainText('Notifications on');
    await slack.getByRole('button', { name: 'Disconnect Slack', exact: true }).click();
    await disconnect.getByRole('button', { name: 'Disconnect Slack', exact: true }).click();
    await expect(slack).toContainText('Reconnect needed');
    await page.reload();
    await expect(slack.getByRole('button', { name: 'Turn Slack notifications on', exact: true })).toHaveCount(0);
    await expectNoAxeViolations(page);
});

test('a signed-out Slack callback returns to sign-in without copying OAuth credentials into the URL', async ({ page }) => {
    await page.goto('/app/slack/callback?state=private-oauth-state&code=private-oauth-code');
    await expect(page).toHaveURL(/\/app\/sign-in\?next=\/app$/);
    expect(page.url()).not.toContain('private-oauth-');
    expect(await page.content()).not.toContain('private-oauth-');
});
