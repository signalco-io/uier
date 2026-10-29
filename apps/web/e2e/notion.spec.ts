import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { projectPublicId, createProject, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { newVisitor } from './support/toolbar';

test('Notion OAuth, explicit field mapping, destination confirmation and sync controls stay admin-only', async ({ page, browser, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    await signIn(page, uniqueEmail('notion-admin'));
    const projectId = await createProject(page, { urls: [baseURL!], name: 'Notion review' });
    const settingsUrl = `/app/projects/${projectId}/settings`;
    await page.goto(settingsUrl);
    const notion = page.getByRole('region', { name: 'Notion', exact: true });
    await expect(notion).toContainText('Not connected');
    const connect = notion.getByRole('link', { name: 'Connect Notion', exact: true });
    await expect(connect).toHaveAttribute('href', `/app/notion/connect?project=${projectId}`);
    const prefetch = await page.request.get(`/app/notion/connect?project=${projectId}`, { headers: { Purpose: 'prefetch' }, maxRedirects: 0 });
    expect(prefetch.status()).toBe(302); expect(new URL(prefetch.headers().location!).pathname).toBe(settingsUrl);
    await connect.click();
    await expect(page.getByRole('heading', { name: 'Connect Notion test workspace' })).toBeVisible();
    const deniedCallback = page.waitForRequest(request => new URL(request.url()).pathname === '/app/notion/callback');
    await page.getByRole('button', { name: 'Cancel Notion connection' }).click();
    const deniedUrl = (await deniedCallback).url();
    await expect(page).toHaveURL(new RegExp(`${settingsUrl}\\?notion=denied#notion$`));
    await expect(notion).toContainText('The Notion connection was canceled.');
    const replay = await page.request.get(deniedUrl, { maxRedirects: 0 });
    expect(replay.status()).toBe(400); expect(await replay.text()).toContain('This connection link is not valid.');
    await notion.getByRole('link', { name: 'Connect Notion', exact: true }).click();
    await page.getByRole('button', { name: 'Allow Notion connection' }).click();
    await expect(page).toHaveURL(new RegExp(`${settingsUrl}\\?notion=connected#notion$`));
    await expect(notion).toContainText('Connected workspace: Test workspace.');
    await expect(notion.getByRole('combobox')).toHaveCount(0);
    const action = page.waitForRequest(request => request.method() === 'POST' && Boolean(request.headers()['next-action']));
    await notion.getByRole('button', { name: 'Load databases', exact: true }).click(); const actionRequest = await action;
    await notion.getByRole('combobox', { name: 'Database', exact: true }).click();
    await page.getByRole('option', { name: 'Website feedback', exact: true }).click();
    const fieldsRequest = page.waitForRequest(request => request.method() === 'POST' && Boolean(request.headers()['next-action']));
    await notion.getByRole('button', { name: 'Load fields', exact: true }).click();
    const fieldAction = await fieldsRequest;
    await expect(notion.getByRole('combobox', { name: 'Title (required)', exact: true })).toContainText('Name');
    // Inspect the read action through APIRequestContext: a mobile navigation can evict Chromium's
    // streamed response body before Network.getResponseBody reads it.
    const fieldResult = await page.request.post(fieldAction.url(), { headers: {
        'Next-Action': fieldAction.headers()['next-action']!, 'Content-Type': fieldAction.headers()['content-type']!, Origin: new URL(fieldAction.url()).origin
    }, data: fieldAction.postDataBuffer()! });
    expect(fieldResult.ok()).toBe(true);
    expect(await fieldResult.text()).not.toMatch(/notion-test-secret|access-[a-f0-9-]{36}|refresh-[a-f0-9-]{36}|v1\.k1\./);
    await expect(notion.getByRole('combobox', { name: 'uier id (required)', exact: true })).toContainText('uier id');
    await notion.getByRole('combobox', { name: 'uier id (required)', exact: true }).click();
    await page.getByRole('option', { name: 'Choose a field', exact: true }).click();
    await expect(notion).toContainText('Required fields are missing');
    await expect(notion.getByRole('button', { name: 'Save Notion mapping' })).toBeDisabled();
    await notion.getByRole('combobox', { name: 'uier id (required)', exact: true }).click();
    await page.getByRole('option', { name: 'uier id', exact: true }).click();
    await notion.getByRole('combobox', { name: 'Assignee name', exact: true }).click();
    await page.getByRole('option', { name: 'uier id', exact: true }).click();
    await expect(notion).toContainText('A Notion field can only be mapped once.');
    await expect(notion.getByRole('button', { name: 'Save Notion mapping' })).toBeDisabled();
    await notion.getByRole('combobox', { name: 'Assignee name', exact: true }).click();
    await page.getByRole('option', { name: 'Not mapped', exact: true }).click();
    await expectNoAxeViolations(page);
    await notion.getByRole('button', { name: 'Save Notion mapping', exact: true }).click();
    await expect(notion).toContainText('Sync on');
    await page.reload(); await expect(notion).toContainText('Destination: Website feedback.');
    expect(await page.content()).not.toMatch(/notion-test-secret|access-[a-f0-9-]{36}|refresh-[a-f0-9-]{36}|v1\.k1\.|"(?:tokens|grantId|botId|connectedBy)":/);
    await notion.getByRole('button', { name: 'Load fields', exact: true }).click();
    await expect(notion.getByRole('combobox', { name: 'Assignee name', exact: true })).toContainText('Not mapped');
    await notion.getByRole('button', { name: 'Load databases', exact: true }).click();
    await notion.getByRole('combobox', { name: 'Database', exact: true }).click();
    await page.getByRole('option', { name: 'Other feedback', exact: true }).click();
    await notion.getByRole('button', { name: 'Load fields', exact: true }).click();
    await notion.getByRole('button', { name: 'Save Notion mapping', exact: true }).click();
    const destination = page.getByRole('alertdialog', { name: 'Switch Notion database?' });
    await expect(destination).toContainText('Existing pages stay in the previous database.');
    await destination.getByRole('button', { name: 'Keep current database' }).click();
    await expect(notion).toContainText('Destination: Website feedback.');
    await notion.getByRole('button', { name: 'Save Notion mapping', exact: true }).click();
    await destination.getByRole('button', { name: 'Switch database', exact: true }).click();
    await expect(notion).toContainText('Destination: Other feedback.');

    await page.goto(`/app/projects/${projectId}`);
    await page.getByRole('button', { name: 'Invite', exact: true }).first().click();
    const invitation = page.getByRole('dialog');
    await invitation.getByLabel('Email', { exact: true }).fill(uniqueEmail('notion-member'));
    await invitation.getByRole('button', { name: 'Send invitation' }).click();
    const invitationLink = await invitation.getByRole('link', { name: 'Open the invitation link' }).getAttribute('href');
    const member = await newVisitor(browser, testInfo);
    try {
        await member.page.goto(invitationLink!); await member.page.getByRole('button', { name: 'Accept invitation' }).click();
        const publicId = await projectPublicId(page, projectId);
        await member.page.waitForURL(url => url.searchParams.get('toolbar-code') === publicId);
        await member.page.goto(new URL(settingsUrl, baseURL).href);
        await expect(member.page.getByRole('region', { name: 'Notion', exact: true })).toHaveCount(0);
        expect((await member.page.request.get(new URL(`/app/notion/connect?project=${projectId}`, baseURL).href, { maxRedirects: 0 })).status()).toBe(404);
        const forged = await member.page.request.post(actionRequest.url(), { headers: { 'Next-Action': actionRequest.headers()['next-action']!,
            'Content-Type': actionRequest.headers()['content-type']!, Origin: new URL(actionRequest.url()).origin }, data: actionRequest.postDataBuffer()! });
        expect(await forged.text()).toContain('Only admins can do this.');
    } finally { await member.context.close(); }

    await page.goto(settingsUrl);
    await notion.getByRole('button', { name: 'Turn sync off', exact: true }).click(); await expect(notion).toContainText('Sync off');
    await expect(notion.getByRole('button', { name: 'Backfill existing feedback' })).toHaveCount(0);
    await notion.getByRole('button', { name: 'Turn sync on', exact: true }).click(); await expect(notion).toContainText('Sync on');
    await setProjectAccess(page, projectId, 'Anyone with the link');
    const source = await page.request.post(`/api/review/${projectId}/comments`, { headers: { Origin: new URL(baseURL!).origin,
        'X-Uier-Visitor': randomBytes(32).toString('base64url') }, data: { path: '/notion-review', text: 'Feedback for Notion backfill', authorName: 'Reviewer',
        position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 } } });
    expect(source.status()).toBe(201);
    await notion.getByRole('button', { name: 'Backfill existing feedback', exact: true }).click();
    await expect(notion).toContainText('A backfill of 1 selected threads is queued.');
    await expect(notion).toContainText('Backfill: 0 of 1 selected threads queued for delivery.');
    await notion.getByRole('button', { name: 'Disconnect Notion', exact: true }).click();
    const disconnect = page.getByRole('alertdialog', { name: 'Disconnect Notion from this project?' });
    await expect(disconnect).toContainText('Existing pages and files remain in Notion.');
    await disconnect.getByRole('button', { name: 'Keep connected' }).click(); await expect(notion).toContainText('Sync on');
    await notion.getByRole('button', { name: 'Disconnect Notion', exact: true }).click();
    await disconnect.getByRole('button', { name: 'Disconnect Notion', exact: true }).click();
    await expect(notion.getByRole('link', { name: 'Connect Notion', exact: true })).toBeVisible();
    await page.reload(); await expect(notion.getByRole('button', { name: 'Turn sync on' })).toHaveCount(0);
    await expectNoAxeViolations(page);
});
