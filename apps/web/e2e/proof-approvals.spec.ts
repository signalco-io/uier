import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import sharp from 'sharp';
import type { ProofAsset, ProofCollection, ProofUploadGrant } from '../src/lib/proofs/model';
import { proofCollectionPath, proofViewerPath } from '../src/lib/proofs/model';
import { hydrated, signIn, uniqueEmail } from './support/app';
import { expectNoAxeViolations } from './accessibility';

async function select(group: Locator, label: string, option: string | RegExp) {
    await group.getByRole('combobox', { name: label, exact: true }).click();
    await group.page().getByRole('option', { name: option }).click();
}

async function openApprovals(page: Page) {
    const region = page.getByRole('region', { name: 'Approvals', exact: true });
    const button = region.getByRole('button', { name: 'Approvals', exact: true });
    await expect(button).toBeVisible();
    if (await button.getAttribute('aria-expanded') === 'false') await button.click();
    await expect(region.getByRole('heading', { name: /Approval for version/ })).toBeVisible();
    return region;
}

test('owner and reviewer sign off on an exact version through the viewer and see current collection progress', async ({ page, browser, baseURL, isMobile }) => {
    test.setTimeout(90_000);
    const ownerEmail = uniqueEmail('approvals-owner');
    const reviewerEmail = uniqueEmail('approvals-reviewer');
    await signIn(page, ownerEmail);
    await page.goto('/app/projects/new');
    const mode = page.getByRole('radio', { name: 'Files only' });
    await hydrated(mode);
    await mode.click();
    await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Brochure approvals');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.waitForURL(/\/projects\/[\w-]{21}\/files$/);
    const files = new URL(page.url()).pathname;
    const projectId = files.split('/')[3]!;
    const headers = { Origin: baseURL! };
    const endpoint = `/api/proofs/${projectId}`;
    const post = (path: string, data: object) => page.request.post(endpoint + path, { headers, data });
    const collectionResponse = await post('/collections', { name: 'Launch assets' });
    expect(collectionResponse.status()).toBe(201);
    const { collection } = await collectionResponse.json() as { collection: ProofCollection };
    const assetResponse = await post('/assets', { name: 'Cover', collectionId: collection.id });
    expect(assetResponse.status()).toBe(201);
    const { asset } = await assetResponse.json() as { asset: ProofAsset };

    async function publish(expectedVersionId: string | null, color: string) {
        const data = await sharp({ create: { width: 80, height: 60, channels: 3, background: color } }).png().toBuffer();
        const response = await post(`/assets/${asset.id}/uploads`, { requestId: randomUUID(), expectedVersionId,
            filename: 'Cover.png', contentType: 'image/png', size: data.length });
        expect(response.ok(), await response.text()).toBe(true);
        const grant = await response.json() as ProofUploadGrant;
        const staged = await page.request.put(grant.uploadUrl!, { data, headers: { ...grant.headers, ...headers } });
        expect(staged.ok(), await staged.text()).toBe(true);
        expect((await page.request.post(endpoint + `/assets/${asset.id}/uploads/${grant.version.id}/finalize`, { headers })).ok()).toBe(true);
        return grant.version.id;
    }

    const v1 = await publish(null, 'green');
    await page.goto('/app/users');
    await page.getByRole('button', { name: 'Invite', exact: true }).click();
    const invite = page.getByRole('dialog');
    await invite.getByLabel('Email').fill(reviewerEmail);
    await invite.getByRole('radio', { name: 'All projects, now and later' }).click();
    await invite.getByRole('button', { name: 'Send invitation' }).click();
    const invitation = invite.getByRole('link', { name: 'Open the invitation link' });
    await expect(invitation).toBeVisible();
    const inviteUrl = await invitation.getAttribute('href');
    const reviewerContext = await browser.newContext({ baseURL, isMobile, hasTouch: isMobile,
        viewport: isMobile ? { width: 390, height: 844 } : { width: 1200, height: 880 } });
    try {
        const reviewer = await reviewerContext.newPage();
        await reviewer.goto(inviteUrl!);
        await hydrated(reviewer.getByRole('button', { name: 'Accept invitation' }));
        await reviewer.getByRole('button', { name: 'Accept invitation' }).click();
        await reviewer.waitForURL(url => !url.pathname.startsWith('/app/invitation'));

        const viewer = proofViewerPath(projectId, asset.id, v1);
        await page.goto(viewer);
        const panel = await openApprovals(page);
        await panel.getByRole('button', { name: 'Start approval round' }).click();
        const dialog = page.getByRole('dialog', { name: 'Start approval round' });
        await select(dialog.getByRole('group', { name: 'Reviewer 1' }), 'Project member', new RegExp(ownerEmail.split('@')[0]!));
        await dialog.getByRole('button', { name: 'Add reviewer' }).click();
        await select(dialog.getByRole('group', { name: 'Reviewer 2' }), 'Project member', new RegExp(reviewerEmail.split('@')[0]!));
        await dialog.getByLabel('Approval deadline').fill('2030-04-02T10:00');
        await dialog.getByRole('button', { name: 'Start round', exact: true }).click();
        await expect(dialog).toBeHidden();
        const approve = panel.getByRole('button', { name: 'Approve version' });
        if (isMobile) await approve.tap();
        else { await approve.focus(); await approve.press('Enter'); }
        await expect(panel.getByText('Approval decision saved.')).toBeFocused();

        await reviewer.goto(viewer + '&approval=1');
        const other = await openApprovals(reviewer);
        await other.getByRole('button', { name: 'Request changes' }).click();
        await other.getByLabel('What needs to change?').fill('Update the first heading.');
        await other.getByRole('button', { name: 'Submit change request' }).click();
        await expect(other.locator('ul').getByText('Update the first heading.', { exact: true })).toBeVisible();
        await other.getByRole('button', { name: 'Approve version' }).click();
        await expect(other.getByText('Approval decision saved.')).toBeFocused();
        await other.getByText('Decision history', { exact: true }).click();
        await expect(other.locator('ol').getByText('Update the first heading.', { exact: true })).toBeVisible();
        expect(await reviewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expectNoAxeViolations(reviewer);

        const download = reviewer.waitForEvent('download');
        await other.getByRole('link', { name: 'Download review record' }).click();
        const payload = JSON.parse(await readFile((await (await download).path())!, 'utf8')) as {
            version: { id: string }; approval: { outcome: string };
        };
        expect(payload.version.id).toBe(v1);
        expect(payload.approval.outcome).toBe('approved');

        await page.goto(proofCollectionPath(projectId, collection.id));
        const cover = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: /^Cover\b/ }) });
        await expect(cover).toContainText('Approved');
        const v2 = await publish(v1, 'blue');
        await page.reload();
        await expect(cover).toContainText('Pending approval');
        await expect(cover).toContainText('Awaiting required reviewers');
        await page.goto(files);
        await expect(page.getByText('Awaiting required reviewers', { exact: false })).toBeVisible();
        await reviewer.goto(proofViewerPath(projectId, asset.id, v2) + '&approval=1');
        await expect((await openApprovals(reviewer)).getByRole('button', { name: 'Approve version' })).toBeVisible();
    } finally {
        await reviewerContext.close();
    }
});
