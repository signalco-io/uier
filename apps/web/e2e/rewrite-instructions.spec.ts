import { expect, test, type Locator, type Request } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, hydrated, openProjectInvite, projectPublicId, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { animationsFinished } from './support/toolbar';

test.use({ actionTimeout: 15_000 });

test('admins set workspace guidance and inherit, append, replace or clear it per project; guests and commenters cannot read or write it', async ({ page, browser, request }) => {
    test.setTimeout(60_000);
    await signIn(page, uniqueEmail('rewrite-instructions'));
    const origin = new URL(page.url()).origin;
    const project = await createProject(page, { urls: [origin], name: 'Rewrite style' });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, origin);
    const workspace = page.getByRole('region', { name: 'Rewrite suggestions', exact: true });
    const general = page.getByRole('region', { name: 'General', exact: true });
    const workspaceText = 'Use calm sentences. Prefer member.';
    const projectText = 'Use British spelling.';

    async function save(section: Locator) {
        const submitted = page.waitForRequest(req => req.method() === 'POST' && Boolean(req.headers()['next-action']));
        await section.getByRole('button', { name: 'Save', exact: true }).click();
        const action = await submitted;
        await expect(section.getByRole('status')).toContainText(/saved/i);
        await expect(section.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
        return action;
    }
    async function expectGuidance(value: string) {
        const response = await request.post(`/api/review/${project}/rewrite`, { headers, data: {
            text: `Selected text. [stub:style:${Buffer.from(value).toString('base64')}]`, instruction: 'Shorter',
            rewriteInstructions: 'CLIENT_OVERRIDE', styleGuidance: 'CLIENT_OVERRIDE'
        } });
        expect(response.status()).toBe(200);
        expect(await response.json()).toEqual({ suggestions: ['First suggestion (Shorter).', 'Second suggestion (Shorter).', 'Third suggestion (Shorter).'] });
    }
    await expectGuidance('');
    await page.goto('/app/workspace/settings');
    await hydrated(workspace.locator('form'));
    const workspaceInput = workspace.getByLabel('Workspace rewrite instructions');
    await workspaceInput.fill('Discard this.');
    await workspace.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(workspaceInput).toHaveValue('');
    await workspaceInput.fill(`  ${workspaceText}  `);
    const workspaceAction = await save(workspace);
    await expect(workspaceInput).toHaveValue(workspaceText);
    await expectNoAxeViolations(page, { include: ['#rewrite-suggestions'] });
    await expectGuidance(workspaceText);
    // The server enforces the limit when browser validation is bypassed. Failed drafts survive.
    await workspaceInput.evaluate((element: HTMLTextAreaElement) => element.removeAttribute('maxlength'));
    await workspaceInput.fill('x'.repeat(2001));
    await workspace.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(workspace.getByRole('alert')).toContainText('2000 characters');
    await expect(workspaceInput).toHaveValue('x'.repeat(2001));
    await page.reload();
    await expect(workspaceInput).toHaveValue(workspaceText);

    await page.goto(`/app/projects/${project}/settings`);
    await hydrated(general.locator('form'));
    const mode = general.getByRole('combobox', { name: 'Rewrite instructions', exact: true });
    await expect(mode).toContainText('Workspace default');
    await expect(general).toContainText(workspaceText);
    await mode.click();
    await page.getByRole('option', { name: 'Add to workspace instructions', exact: true }).click();
    const input = general.getByLabel('Project rewrite instructions', { exact: true });
    await input.fill(projectText);
    await expect(general.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    await animationsFinished(general);
    await expectNoAxeViolations(page, { include: ['#general'] });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const projectAction = await save(general);
    await expectGuidance(`${workspaceText}\n\n${projectText}`);
    await page.reload();
    await expect(input).toHaveValue(projectText);
    await hydrated(general.locator('form'));
    await mode.click();
    await page.getByRole('option', { name: 'Replace workspace instructions', exact: true }).click();
    await save(general);
    await expectGuidance(projectText);
    await input.clear();
    await save(general);
    await expectGuidance('');
    await input.fill('Discard project edit.');
    await general.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(input).toHaveValue('');
    await input.evaluate((element: HTMLTextAreaElement) => element.removeAttribute('maxlength'));
    await input.fill('x'.repeat(2001));
    await general.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(general.getByRole('alert')).toContainText('2000 characters');
    await general.getByRole('button', { name: 'Discard', exact: true }).click();
    await mode.click();
    await page.getByRole('option', { name: 'Workspace default', exact: true }).click();
    await save(general);
    await expectGuidance(workspaceText);
    await page.goto('/app/workspace/settings');
    await hydrated(workspace.locator('form'));
    await workspaceInput.fill('New workspace style.');
    await save(workspace);
    await expectGuidance('New workspace style.');

    const info = await request.get(`/api/review/${project}`, { headers });
    expect(info.status()).toBe(200);
    expect(await info.text()).not.toMatch(/rewriteInstructions|workspace style|British spelling/);

    // Replay real action payloads as a commenter, then signed out, without relying on hidden controls.
    await page.goto(`/app/projects/${project}`);
    const email = uniqueEmail('rewrite-commenter');
    await openProjectInvite(page, 'Anyone with the link');
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Email').fill(email);
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    const invitation = await dialog.getByRole('link', { name: 'Open the invitation link' }).getAttribute('href');
    const other = await browser.newContext();
    try {
        const member = await other.newPage();
        await member.goto(invitation!);
        await member.getByRole('button', { name: 'Accept invitation' }).click();
        const publicId = await projectPublicId(page, project);
        await member.waitForURL(url => url.searchParams.get('toolbar-code') === publicId);
        await member.goto(`/app/projects/${project}/settings`);
        await expect(member.getByRole('region', { name: 'General', exact: true })).toHaveCount(0);
        expect(await member.content()).not.toContain('New workspace style.');
        const replay = async (action: Request) => other.request.post(action.url(), { headers: {
            'Next-Action': action.headers()['next-action']!, 'Content-Type': action.headers()['content-type']!, Origin: origin
        }, data: action.postDataBuffer()!, maxRedirects: 0 });
        for (const action of [workspaceAction, projectAction])
            expect(await (await replay(action)).text()).toContain('Only admins can do this.');
        await other.clearCookies();
        for (const action of [workspaceAction, projectAction]) {
            const response = await replay(action);
            expect(response.status()).toBe(307);
            expect(response.headers().location).toContain('/app/sign-in?next=');
        }
    } finally { await other.close(); }
    await expectGuidance('New workspace style.');
    await page.goto(`/app/projects/${project}/settings`);
    await expect(mode).toContainText('Workspace default');
});
