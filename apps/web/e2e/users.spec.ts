import { expect, test } from '@playwright/test';
import type { Browser, Page, TestInfo } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { appNavigation, createProject, signIn, uniqueEmail } from './support/app';
import { startReviewedSite } from './support/reviewedSite';
import { commentBubble, newVisitor, toolbar } from './support/toolbar';

// Users and invitations (issues #14 and #15): admins invite people by email as admins or as
// commenters of selected projects; accepting signs them in and opens the project's review link.
// Locally no email is sent, so the invite dialog shows the link it would have emailed.

let site: Awaited<ReturnType<typeof startReviewedSite>>;

test.beforeAll(async ({ baseURL }) => {
    site = await startReviewedSite(new URL(baseURL!).origin);
});

test.afterAll(async () => {
    await site.close();
});

/** An admin with two projects (each on its own reviewed site) */
async function adminWithProjects(page: Page) {
    const adminEmail = uniqueEmail('admin');
    await signIn(page, adminEmail);
    const alpha = await createProject(page, { urls: [site.origin('alpha')], name: 'Alpha', clientName: 'Alpha client' });
    const beta = await createProject(page, { urls: [site.origin('beta')], name: 'Beta', clientName: 'Private beta client' });
    return { adminEmail, alpha, beta };
}

/** Opens the invite dialog from the users page, or from a project's empty comments list */
async function openInvite(page: Page, from?: string) {
    await page.goto(from ? `/app/projects/${from}` : '/app/users');
    const source = from ? page.locator('[data-slot="empty"]') : page;
    await source.getByRole('button', { name: 'Invite', exact: true }).click();
    // Not by name: once sent, its title is "Invitation sent"
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAccessibleName('Invite someone');
    return dialog;
}

/** Sends an invitation from the invite dialog; returns the invitation link (shown locally) */
async function invite(page: Page, { email, role = 'Commenter', projects, from }: {
    email: string;
    role?: 'Commenter' | 'Admin';
    /** Commenters: project names to tick, or every project */
    projects?: string[] | 'all';
    /** The project the invitation starts from (its empty list's Invite button) */
    from?: string;
}) {
    const dialog = await openInvite(page, from);
    if (from) {
        await expect(dialog.getByRole('checkbox', { name: 'Alpha', exact: true })).toBeChecked();
        await expect(dialog.getByRole('checkbox', { name: 'Beta', exact: true })).not.toBeChecked();
    }
    await dialog.getByLabel('Email').fill(email);
    if (role === 'Admin')
        await dialog.getByRole('radio', { name: /^Admin/ }).click();
    if (projects === 'all') {
        await dialog.getByRole('radio', { name: 'All projects, now and later' }).click();
    } else {
        for (const name of projects ?? [])
            await dialog.getByRole('checkbox', { name }).click();
    }
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(dialog.getByRole('status')).toContainText(`We emailed an invitation to ${email}`);
    const link = await dialog.getByRole('link', { name: 'Open the invitation link' }).getAttribute('href');
    expect(link).toMatch(/^\/app\/invitation\?token=/);
    return link!;
}

async function newPerson(browser: Browser, testInfo: TestInfo) {
    return await newVisitor(browser, testInfo);
}

test('a commenter invited to one project reviews only that project', async ({ page, browser }, testInfo) => {
    const { alpha, beta } = await adminWithProjects(page);
    const commenterEmail = uniqueEmail('commenter');

    // Invited from the project: the project is ticked already
    const link = await invite(page, { email: commenterEmail, from: alpha });

    // Pending on the users page
    await page.goto('/app/users');
    const invitations = page.getByRole('list', { name: 'Invitations' });
    await expect(invitations).toContainText(commenterEmail);
    await expect(invitations).toContainText('Commenter');
    await expect(invitations).toContainText('Alpha');
    await expect(page).toHaveTitle('Users · uier');
    await expectNoAxeViolations(page);

    // Accepting signs the commenter in and opens Alpha's review link, signed in on the site
    const commenter = await newPerson(browser, testInfo);
    await commenter.page.goto(link);
    await expect(commenter.page.getByRole('heading', { level: 1, name: 'Review Alpha' })).toBeVisible();
    await expect(commenter.page.getByText(`as ${commenterEmail}`)).toBeVisible();
    await expect(commenter.page).toHaveTitle('Invitation · uier');
    await expectNoAxeViolations(commenter.page);
    await commenter.page.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(commenter.page).toHaveURL(`${site.origin('alpha')}/?toolbar-code=${alpha}`);
    await expect(commenter.page.getByRole('button', { name: 'Add comment' })).toBeVisible();

    // An empty invited-only project offers the existing install action to commenters, never Invite.
    await commenter.page.goto(`/app/projects/${alpha}`);
    const empty = commenter.page.locator('[data-slot="empty"]');
    await expect(empty).toContainText('No comments yet');
    await expect(empty.getByRole('link', { name: 'Install the script' })).toBeVisible();
    await expect(commenter.page.getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0);
    await expect(commenter.page.getByRole('list', { name: 'Guest links' })).toHaveCount(0);
    await expect(empty).not.toContainText('Only people you invite');
    await commenter.page.goto(`/app/projects/${alpha}/install?onboarding=1`);
    await expect(commenter.page.getByRole('region', { name: 'Invite a reviewer' }).getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0);

    // The link works once
    const again = await browser.newPage();
    await again.goto(link);
    await expect(again.getByRole('heading', { name: 'This invitation has expired' })).toBeVisible();
    await again.close();

    // The commenter comments on Alpha (pages of the reviewed site are /<project code>/<page>)
    await commenter.page.goto(`${site.origin('alpha')}/${alpha}/?toolbar-code=${alpha}`);
    await commenter.page.getByRole('button', { name: 'Add comment' }).click();
    const heading = await commenter.page.getByRole('heading', { level: 1 }).boundingBox();
    await commenter.page.mouse.click(heading!.x + 20, heading!.y + heading!.height / 2);
    await commenter.page.getByRole('textbox', { name: 'Comment', exact: true }).fill('Typo in the second plan.');
    await commenter.page.getByRole('textbox', { name: 'Comment', exact: true }).press('Enter');
    await expect(commentBubble(commenter.page, 1)).toBeVisible();

    // In the app: only Alpha, no users, no new projects; settings only for their own emails
    await commenter.page.goto('/app/projects');
    await expect(commenter.page.getByRole('list', { name: 'Active projects' }).getByRole('link', { name: 'Alpha' })).toBeVisible();
    await expect(commenter.page.getByRole('link', { name: 'Beta' })).toHaveCount(0);
    await commenter.page.getByRole('combobox', { name: 'Client', exact: true }).click();
    await expect(commenter.page.getByRole('option', { name: 'Alpha client', exact: true })).toBeVisible();
    await expect(commenter.page.getByRole('option', { name: 'Private beta client', exact: true })).toHaveCount(0);
    await commenter.page.keyboard.press('Escape');
    await expect(commenter.page.getByRole('link', { name: 'Create project' })).toHaveCount(0);
    await expect(commenter.page.getByRole('navigation', { name: 'App' }).getByRole('link', { name: 'Users' })).toHaveCount(0);
    await commenter.page.goto(`/app/projects/${alpha}/settings`);
    await expect(commenter.page.getByRole('region', { name: 'Email notifications' }).getByRole('button', { name: 'Mute project emails' })).toBeVisible();
    await expect(commenter.page.getByRole('region', { name: 'General' })).toHaveCount(0);
    await expect(commenter.page.getByRole('region', { name: 'Status' })).toHaveCount(0);
    expect((await commenter.page.request.get(`/app/review/${beta}`, { maxRedirects: 0 })).status()).toBe(404);

    // Their own comment: edit and delete, but only admins make comments private
    await commenter.page.goto(`/app/projects/${alpha}`);
    const card = commenter.page.getByRole('article', { name: 'Comment by you' });
    await card.getByRole('button', { name: /More actions/ }).click();
    await expect(commenter.page.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
    await expect(commenter.page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
    await expect(commenter.page.getByRole('menuitem', { name: 'Make private' })).toHaveCount(0);
    await commenter.page.keyboard.press('Escape');

    // The admin's users list: the commenter with Alpha, filtered by project
    await page.goto('/app/users');
    const people = page.getByRole('list', { name: 'People' });
    const commenterRow = people.getByRole('listitem').filter({ hasText: commenterEmail });
    await expect(commenterRow).toContainText('Commenter');
    await expect(commenterRow).toContainText('Alpha');
    await expect(page.getByRole('list', { name: 'Invitations' })).toHaveCount(0);

    await page.getByRole('combobox', { name: 'Project' }).click();
    await page.getByRole('option', { name: 'Beta' }).click();
    await expect(page).toHaveURL(new RegExp(`project=${beta}`));
    await expect(people.getByRole('listitem')).toHaveCount(1);
    await expect(commenterRow).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Project' }).click();
    await page.getByRole('option', { name: 'Alpha' }).click();
    await expect(people.getByRole('listitem')).toHaveCount(2);
    await expect(commenterRow).toBeVisible();

    // Delete: gone from the list, and the toolbar asks them to sign in again
    await commenterRow.getByRole('button', { name: /^Remove / }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
    await expect(commenterRow).toHaveCount(0);
    await page.reload();
    await expect(people.getByRole('listitem')).toHaveCount(1);
    await expect(people).not.toContainText(commenterEmail);

    await commenter.page.goto(`${site.origin('alpha')}/${alpha}/?toolbar-code=${alpha}`);
    await expect(toolbar(commenter.page)).toContainText('Sign in to see and leave comments.');
    await commenter.context.close();
});

test('an invited admin gets every project, the users and the settings', async ({ page, browser }, testInfo) => {
    const { alpha, beta } = await adminWithProjects(page);
    const secondAdmin = uniqueEmail('second-admin');
    const link = await invite(page, { email: secondAdmin, role: 'Admin' });

    const person = await newPerson(browser, testInfo);
    await person.page.goto(link);
    await expect(person.page.getByRole('heading', { level: 1, name: 'You are invited' })).toBeVisible();
    await person.page.getByRole('button', { name: 'Accept invitation' }).click();
    // No project in the invitation: the projects
    await expect(person.page).toHaveURL(/\/app\/projects$/);
    const personProjects = person.page.getByRole('list', { name: 'Active projects' });
    await expect(personProjects.getByRole('link', { name: 'Alpha' })).toBeVisible();
    await expect(personProjects.getByRole('link', { name: 'Beta' })).toBeVisible();
    await expect((await appNavigation(person.page)).getByRole('link', { name: 'Users' })).toBeVisible();
    await person.page.goto(`/app/projects/${beta}/settings`);
    await expect(person.page.getByRole('region', { name: 'Who can comment' })).toBeVisible();
    expect((await person.page.request.get(`/app/review/${alpha}`, { maxRedirects: 0 })).status()).toBe(307);

    await page.goto('/app/users');
    await expect(page.getByRole('list', { name: 'People' }).getByRole('listitem').filter({ hasText: secondAdmin })).toContainText('All projects');
    await person.context.close();
});

test('a removed workspace creator is not added back to their workspace', async ({ page, browser }, testInfo) => {
    const { adminEmail: creatorEmail, alpha } = await adminWithProjects(page);
    // The creator reviews Alpha, so the site keeps their review token
    await page.goto(`/app/review/${alpha}`);
    await expect(page).toHaveURL(`${site.origin('alpha')}/?toolbar-code=${alpha}`);
    await expect(page.getByRole('button', { name: 'Add comment' })).toBeVisible();

    const secondAdmin = uniqueEmail('second-admin');
    const link = await invite(page, { email: secondAdmin, role: 'Admin' });
    const person = await newPerson(browser, testInfo);
    await person.page.goto(link);
    await person.page.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(person.page).toHaveURL(/\/app\/projects$/);

    // The second admin removes the creator of the workspace
    await person.page.goto('/app/users');
    const people = person.page.getByRole('list', { name: 'People' });
    const creatorRow = people.getByRole('listitem').filter({ hasText: creatorEmail });
    await creatorRow.getByRole('button', { name: /^Remove / }).click();
    await person.page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
    await expect(creatorRow).toHaveCount(0);

    // The creator's session still works, but opening the app gives them a new, empty workspace of
    // their own instead of their admin membership back
    await page.goto('/app/users');
    const ownPeople = page.getByRole('list', { name: 'People' });
    await expect(ownPeople.getByRole('listitem')).toHaveCount(1);
    await expect(ownPeople).toContainText(creatorEmail);
    await expect(ownPeople).not.toContainText(secondAdmin);
    await page.goto('/app/projects');
    await expect(page.getByRole('link', { name: 'Alpha' })).toHaveCount(0);
    expect((await page.request.get(`/app/review/${alpha}`, { maxRedirects: 0 })).status()).toBe(404);

    // Their review token stopped working on the site, and the workspace still has only the second admin
    await page.goto(`${site.origin('alpha')}/${alpha}/?toolbar-code=${alpha}`);
    await expect(toolbar(page)).toContainText('Sign in to see and leave comments.');
    await person.page.reload();
    await expect(people.getByRole('listitem')).toHaveCount(1);
    await expect(people).not.toContainText(creatorEmail);
    await person.context.close();
});

test('invitations validate, replace earlier ones and can be revoked', async ({ page }) => {
    const { adminEmail } = await adminWithProjects(page);
    const email = uniqueEmail('invitee');

    // A commenter needs projects
    const dialog = await openInvite(page);
    await dialog.getByLabel('Email').fill(email);
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Choose the projects they can review.');
    await expectNoAxeViolations(page);

    const first = await invite(page, { email, projects: ['Alpha'] });
    const second = await invite(page, { email, projects: 'all' });

    // Inviting again replaces the earlier invitation and its link
    await page.goto('/app/users');
    const invitations = page.getByRole('list', { name: 'Invitations' });
    await expect(invitations.getByRole('listitem')).toHaveCount(1);
    await expect(invitations).toContainText('All projects');
    await page.goto(first);
    await expect(page.getByRole('heading', { name: 'This invitation has expired' })).toBeVisible();

    // Revoked: the link no longer works
    await page.goto('/app/users');
    await invitations.getByRole('button', { name: `Revoke the invitation for ${email}` }).click();
    await expect(page.getByText('No pending invitations.')).toBeVisible();
    await page.goto(second);
    await expect(page.getByRole('heading', { name: 'This invitation has expired' })).toBeVisible();

    // Members can't be invited again
    const again = await openInvite(page);
    await again.getByLabel('Email').fill(adminEmail);
    await again.getByRole('radio', { name: /^Admin/ }).click();
    await again.getByRole('button', { name: 'Send invitation' }).click();
    await expect(again.getByRole('alert')).toHaveText(`${adminEmail} is already in this workspace.`);
});
