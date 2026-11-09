import { VERIFICATION_HEADER } from '../src/lib/review/verification';
import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, hydrated, openComment, openProjectInvite, projectPublicId, signIn, uniqueEmail } from './support/app';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished, toolbar } from './support/toolbar';

test.use({ actionTimeout: 15_000 });
async function save(page: Page, section: Locator) {
    const submitted = page.waitForRequest(req => req.method() === 'POST' && Boolean(req.headers()['next-action']));
    await section.getByRole('button', { name: 'Save', exact: true }).click();
    const action = await submitted;
    await expect(section.getByRole('status')).toContainText(/saved/i);
    await expect(section.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    return action;
}
async function choose(page: Page, select: Locator, option: string) {
    await select.click();
    await page.getByRole('option', { name: option, exact: true }).click();
}
async function addType(page: Page, section: Locator) {
    await section.getByRole('button', { name: 'Add feedback type' }).click();
    await section.getByLabel('Type name', { exact: true }).fill('Feature request');
    await choose(page, section.getByRole('combobox', { name: 'Icon', exact: true }), 'Rocket');
    await section.getByLabel('Placeholder text').fill('What would help your work?');
}

test('admins configure inherited defaults and project overrides; invalid drafts survive and other roles cannot write settings', async ({ page, browser }) => {
    test.setTimeout(90_000);
    await signIn(page, uniqueEmail('feedback-settings'));
    const origin = new URL(page.url()).origin;
    const project = await createProject(page, { urls: [origin], name: 'Feedback settings' });
    const workspace = page.getByRole('region', { name: 'Feedback types', exact: true });
    const review = page.getByRole('region', { name: 'Review', exact: true });
    await page.goto('/app/workspace/settings');
    await hydrated(workspace.locator('form'));
    await addType(page, workspace);
    await workspace.getByRole('switch', { name: 'Enable Bug report', exact: true }).click();
    const workspaceAction = await save(page, workspace);
    await expectNoAxeViolations(page, { include: ['#feedback-types'] });
    await page.goto(`/app/projects/${project}/settings/review`);
    await hydrated(review.locator('form'));
    const mode = review.getByRole('combobox', { name: 'Feedback type defaults' });
    await expect(mode).toContainText('Workspace defaults');
    await expect(review.getByLabel('Type name')).toHaveValue('Feature request');
    await expect(review.getByLabel('Type name')).toBeDisabled();
    await choose(page, mode, 'Project override');
    await review.getByLabel('Type name').fill('Project idea');
    const projectAction = await save(page, review);
    await page.reload();
    await expect(review.getByLabel('Type name')).toHaveValue('Project idea');
    await hydrated(review.locator('form'));
    // Bypass the browser limit: the server rejects it and leaves the edited list in place.
    await review.getByLabel('Type name').evaluate(element => element.removeAttribute('maxlength'));
    await review.getByLabel('Type name').fill('x'.repeat(41));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await review.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(review.getByRole('alert')).toBeVisible();
    await expect(review.getByLabel('Type name')).toHaveValue('x'.repeat(41));
    await review.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(review.getByLabel('Type name')).toHaveValue('Project idea');
    await choose(page, mode, 'Workspace defaults');
    await save(page, review);
    await expect(review.getByLabel('Type name')).toHaveValue('Feature request');
    await expectNoAxeViolations(page, { include: ['#review'] });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.goto(`/app/projects/${project}`);
    const email = uniqueEmail('types-commenter');
    await openProjectInvite(page, 'Invited people');
    const invitationDialog = page.getByRole('dialog');
    await invitationDialog.getByLabel('Email').fill(email);
    await invitationDialog.getByRole('button', { name: 'Send invitation' }).click();
    const invitation = await invitationDialog.getByRole('link', { name: 'Open the invitation link' }).getAttribute('href');
    const other = await browser.newContext();
    try {
        const member = await other.newPage();
        await member.goto(invitation!);
        await member.getByRole('button', { name: 'Accept invitation' }).click();
        const publicId = await projectPublicId(page, project);
        await member.waitForURL(url => url.searchParams.get('toolbar-code') === publicId);
        const replay = (action: Request) => other.request.post(action.url(), { headers: {
            'Next-Action': action.headers()['next-action']!, 'Content-Type': action.headers()['content-type']!, Origin: origin
        }, data: action.postDataBuffer()!, maxRedirects: 0 });
        for (const action of [workspaceAction, projectAction]) expect(await (await replay(action)).text()).toContain('Only admins can do this.');
        await other.clearCookies();
        for (const action of [workspaceAction, projectAction]) expect((await replay(action)).status()).toBe(307);
    } finally { await other.close(); }
});

test('custom kinds keep their icon, placeholder and drafts across the feedback modal and remain readable after disabling', async ({ page, baseURL }, testInfo) => {
    test.setTimeout(90_000);
    const site = await startReviewedSite(new URL(baseURL!).origin);
    try {
        await signIn(page, uniqueEmail('feedback-toolbar'));
        const project = await createProject(page, { urls: [site.origin()], name: 'Custom feedback' });
        const review = page.getByRole('region', { name: 'Review', exact: true });
        await page.goto(`/app/projects/${project}/settings/review`);
        await hydrated(review.locator('form'));
        await choose(page, review.getByRole('combobox', { name: 'Feedback type defaults' }), 'Project override');
        await addType(page, review);
        await review.getByRole('switch', { name: 'Enable Bug report', exact: true }).click();
        await save(page, review);
        const destination = `${site.origin()}/${project}/pricing`;
        const visit = async () => {
            await page.goto(`/app/review/${project}?url=${encodeURIComponent(destination)}`);
            await expect(toolbar(page)).toBeVisible();
        };
        await visit();
        await toolbar(page).getByRole('button', { name: 'Send feedback', exact: true }).click();
        const form = page.getByRole('dialog', { name: 'Send feedback', exact: true });
        await expect(form.getByRole('button', { name: 'Bug report', exact: true })).toHaveCount(0);
        await form.getByRole('button', { name: 'Feature request', exact: true }).click();
        const text = form.getByRole('textbox', { name: 'Feature request', exact: true });
        await expect(text).toHaveAttribute('placeholder', 'What would help your work?');
        await text.fill('Keep my custom type draft');
        await form.getByRole('button', { name: 'Feedback', exact: true }).click();
        await form.getByRole('textbox', { name: 'Feedback', exact: true }).fill('A separate default draft');
        await form.getByRole('button', { name: 'Feature request', exact: true }).click();
        await expect(text).toHaveValue('Keep my custom type draft');
        await form.getByRole('button', { name: 'Expand' , exact: true }).click();
        await expect(text).toHaveValue('Keep my custom type draft');
        await animationsFinished(form);
        await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });
        expect(await form.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        const posted = page.waitForResponse(response => response.request().method() === 'POST' && /\/api\/review\/[^/]+\/comments$/.test(new URL(response.url()).pathname));
        await form.getByRole('button', { name: 'Send feedback', exact: true }).click();
        const response = await posted;
        expect(response.status()).toBe(201);
        const saved = await response.json();
        expect(saved.kind).toMatch(/^custom_/);
        expect(saved.feedbackType).toMatchObject({ label: 'Feature request', icon: 'rocket' });
        await expect(form).toBeHidden();
        await page.goto(`/app/projects/${project}/settings/review`);
        await hydrated(review.locator('form'));
        await review.getByRole('switch', { name: 'Enable Feature request', exact: true }).click();
        await save(page, review);
        await page.goto(`/app/projects/${project}`);
        await expect(page.getByRole('img', { name: 'Feature request', exact: true })).toBeVisible();
        await openComment(page, 'Keep my custom type draft');
        await expect(page.getByText('Feature request', { exact: true })).toBeVisible();
        const packet = await page.request.get(`/api/review/${project}/comments/${saved.id}/context`, { headers: { Authorization: response.request().headers().authorization!, Origin: site.origin() } });
        expect(packet.ok()).toBe(true);
        expect((await packet.json()).context).toMatchObject({ kind: saved.kind, feedbackType: saved.feedbackType });
        await visit();
        await toolbar(page).getByRole('button', { name: 'Send feedback', exact: true }).click();
        await expect(form.getByRole('button', { name: 'Feature request', exact: true })).toHaveCount(0);
        await expect(form.getByRole('textbox', { name: 'Feedback', exact: true })).toHaveValue('A separate default draft');
        await page.screenshot({ path: testInfo.outputPath('configured-feedback.png') });
        // The server rejects a stale form, and turning every page type off leaves point mode available.
        const disabled = await page.request.post(`/api/review/${project}/comments`, { headers: {
            Authorization: response.request().headers().authorization!, Origin: site.origin(), [VERIFICATION_HEADER]: response.request().headers()[VERIFICATION_HEADER.toLowerCase()]!
        }, data: { kind: saved.kind, path: '/types', position: { type: 'page' }, text: 'Stale custom form' } });
        expect(disabled.status()).toBe(400);
        expect((await disabled.json()).message).toContain('no longer available');
        await page.goto(`/app/projects/${project}/settings/review`);
        await hydrated(review.locator('form'));
        await review.getByRole('switch', { name: 'Enable Feedback', exact: true }).click();
        await save(page, review);
        await visit();
        await expect(toolbar(page).getByRole('button', { name: 'Send feedback', exact: true })).toHaveCount(0);
        await expect(toolbar(page).getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
    } finally { await site.close(); }
});
