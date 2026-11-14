import { expect, test, type Request } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, hydrated, openProjectInvite, projectPublicId, signIn, uniqueEmail } from './support/app';
import { newVisitor } from './support/toolbar';

test.use({ actionTimeout: 15_000 });

/** The links a project starts with here: address as typed, label, what the header shows, its saved address and icon */
const added = [
    { url: 'github.com/acme/site', label: '', name: 'GitHub', href: 'https://github.com/acme/site', icon: 'github' },
    { url: 'https://dev.azure.com/acme/Site/_boards/board/t/Team/Stories', label: 'Sprint board', name: 'Sprint board', href: 'https://dev.azure.com/acme/Site/_boards/board/t/Team/Stories', icon: 'azure-boards' },
    { url: 'https://dev.azure.com/acme/Site/_git/web', label: '', name: 'Azure Repos', href: 'https://dev.azure.com/acme/Site/_git/web', icon: 'azure-repos' },
    { url: 'figma.com/design/abc/Home', label: 'Designs', name: 'Designs', href: 'https://figma.com/design/abc/Home', icon: 'figma' },
    { url: 'https://www.example.com/handbook', label: '', name: 'example.com', href: 'https://www.example.com/handbook', icon: 'link' }
];

test('admins add, check and remove project links in General; the header shows them with their service icons to everyone in the project', async ({ page, browser, baseURL }, testInfo) => {
    test.setTimeout(90_000);
    await signIn(page, uniqueEmail('project-links'));
    const origin = new URL(page.url()).origin;
    const projectId = await createProject(page, { urls: [origin], name: 'Links site' });
    const settingsUrl = `/app/projects/${projectId}/settings`;
    await page.goto(settingsUrl);
    const general = page.getByRole('region', { name: 'General', exact: true });
    const links = general.getByRole('group', { name: 'Links', exact: true });
    const save = general.getByRole('button', { name: 'Save', exact: true });
    const headerLinks = page.locator('[data-project-link]');
    await expect(headerLinks).toHaveCount(0);
    await hydrated(general.locator('form'));

    // Add link moves the focus into the new row's address; an empty label shows what the header will
    const add = links.getByRole('button', { name: 'Add link', exact: true });
    for (const [index, link] of added.entries()) {
        await add.click();
        const address = links.getByLabel(`Link ${index + 1} address`, { exact: true });
        await expect(address).toBeFocused();
        await address.fill(link.url);
        if (link.label)
            await links.getByLabel(`Link ${index + 1} label`, { exact: true }).fill(link.label);
        else
            await expect(links.getByLabel(`Link ${index + 1} label`, { exact: true })).toHaveAttribute('placeholder', link.name);
        await expect(links.locator('[data-project-link-row]').nth(index).locator('[data-project-link-icon]')).toHaveAttribute('data-project-link-icon', link.icon);
    }
    await expect(general).toContainText('Unsaved changes');

    // An address that is not a web address is refused and the draft stays; removing its row keeps the focus in the list
    await add.click();
    await links.getByLabel('Link 6 address', { exact: true }).fill('javascript:alert(1)');
    await save.click();
    await expect(general.getByRole('alert')).toHaveText('"javascript:alert(1)" is not a website address.');
    await expect(links.getByLabel('Link 6 address', { exact: true })).toHaveValue('javascript:alert(1)');
    await expect(headerLinks).toHaveCount(0);
    await links.getByRole('button', { name: 'Remove link 6', exact: true }).click();
    await expect(links.getByRole('button', { name: 'Remove link example.com', exact: true })).toBeFocused();
    // A row with nothing typed is not saved
    await add.click();
    const submitted = page.waitForRequest(request => request.method() === 'POST' && Boolean(request.headers()['next-action']));
    await save.click();
    const action: Request = await submitted;
    await expect(general.getByRole('status')).toHaveText('Saved.');
    await expect(save).toBeDisabled();

    // The header: each link with its service's icon, its label (else the service, else the host), in a new tab
    await expect(headerLinks).toHaveCount(added.length);
    for (const [index, link] of added.entries()) {
        const item = headerLinks.nth(index);
        await expect(item).toHaveAccessibleName(link.name);
        await expect(item).toHaveAttribute('href', link.href);
        await expect(item).toHaveAttribute('target', '_blank');
        await expect(item).toHaveAttribute('rel', 'noopener noreferrer');
        await expect(item.locator('[data-project-link-icon]')).toHaveAttribute('data-project-link-icon', link.icon);
    }
    await page.reload();
    await expect(links.locator('[data-project-link-row]')).toHaveCount(added.length);
    for (const [index, link] of added.entries()) {
        await expect(links.getByLabel(`Link ${index + 1} address`, { exact: true })).toHaveValue(link.href);
        await expect(links.getByLabel(`Link ${index + 1} label`, { exact: true })).toHaveValue(link.label);
    }
    await expectNoAxeViolations(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload(); // Scan settled dark colors, outside the theme's color transition.
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expect(links.locator('[data-project-link-row]')).toHaveCount(added.length);
    await expect(headerLinks).toHaveCount(added.length);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath('project-links-dark.png'), fullPage: true });
    await links.screenshot({ path: testInfo.outputPath('project-links-settings-dark.png') });
    await page.emulateMedia({ colorScheme: 'light' });

    // A commenter sees the links but not their settings, and a replayed save still checks the admin role
    await page.goto(`/app/projects/${projectId}`);
    await expect(headerLinks).toHaveCount(added.length);
    await openProjectInvite(page);
    const invitation = page.getByRole('dialog');
    await invitation.getByLabel('Email', { exact: true }).fill(uniqueEmail('project-links-member'));
    await invitation.getByRole('button', { name: 'Send invitation' }).click();
    const invitationLink = await invitation.getByRole('link', { name: 'Open the invitation link' }).getAttribute('href');
    const member = await newVisitor(browser, testInfo);
    try {
        await member.page.goto(invitationLink!);
        await member.page.getByRole('button', { name: 'Accept invitation' }).click();
        const publicId = await projectPublicId(page, projectId);
        await member.page.waitForURL(url => url.searchParams.get('toolbar-code') === publicId);
        await member.page.goto(new URL(`/app/projects/${projectId}`, baseURL).href);
        const memberLinks = member.page.locator('[data-project-link]');
        await expect(memberLinks).toHaveCount(added.length);
        await expect(memberLinks.first()).toHaveAccessibleName('GitHub');
        await member.page.goto(new URL(settingsUrl, baseURL).href);
        await expect(member.page.getByRole('region', { name: 'General', exact: true })).toHaveCount(0);
        const forged = await member.page.request.post(action.url(), {
            headers: { 'Next-Action': action.headers()['next-action']!, 'Content-Type': action.headers()['content-type']!, Origin: new URL(action.url()).origin },
            data: action.postDataBuffer()!
        });
        expect(await forged.text()).toContain('Only admins can do this.');
    } finally { await member.context.close(); }

    // Removing every link clears the header
    await page.goto(settingsUrl);
    await hydrated(general.locator('form'));
    for (const link of added)
        await links.getByRole('button', { name: `Remove link ${link.name}`, exact: true }).click();
    await expect(add).toBeFocused();
    await save.click();
    await expect(general.getByRole('status')).toHaveText('Saved.');
    await expect(headerLinks).toHaveCount(0);
    await page.reload();
    await expect(links.locator('[data-project-link-row]')).toHaveCount(0);
});
