import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { finishWelcome, findOrCreateUser, getUser } from '../src/lib/app/users';
import { ensureOwnWorkspace, getWorkspace, renameWorkspace } from '../src/lib/app/workspaces';
import { nameFromEmail } from '../src/lib/app/welcome';
import type { AppContext } from '../src/lib/app/context';
import { welcomeWorkspace } from '../app/(rest)/(app)/app/(auth)/welcome/welcomeWorkspace';

// The first-run step (`/app/welcome`): its suggestions, the flag that shows it once, and the workspace it names.

const originalLocal = process.env.UIER_LOCAL;
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => {
    if (originalLocal === undefined)
        delete process.env.UIER_LOCAL;
    else
        process.env.UIER_LOCAL = originalLocal;
});

test('suggests a person name from the email', () => {
    expect(nameFromEmail('maya.tester@example.test')).toBe('Maya Tester');
    expect(nameFromEmail('maya.tester+uier@example.com')).toBe('Maya Tester');
    expect(nameFromEmail('j_doe-smith@example.com')).toBe('J Doe Smith');
    expect(nameFromEmail('ana@example.com')).toBe('Ana');


});

test('a new account is welcomed once; finishing keeps or sets its name', async () => {
    const email = `welcome-${randomUUID()}@example.com`;
    const user = await findOrCreateUser(email);
    expect(user.welcomePending).toBe(true);
    // Signing in again finds the same account, still waiting
    expect((await findOrCreateUser(email)).welcomePending).toBe(true);

    await finishWelcome(user.id);
    const skipped = await getUser(user.id);
    expect(skipped?.welcomePending).toBeUndefined();
    expect(skipped?.name).toBe(email.split('@')[0]);

    await finishWelcome(user.id, 'Maya Tester');
    expect((await getUser(user.id))?.name).toBe('Maya Tester');
});

test('only the workspace made for the account is named by the first-run step', async () => {
    const user = await findOrCreateUser(`welcome-${randomUUID()}@example.com`);
    const member = await ensureOwnWorkspace(user);
    const workspace = (await getWorkspace(member.workspaceId))!;
    const own = { member, workspace };
    expect(welcomeWorkspace({ user, memberships: [own] } as AppContext)?.id).toBe(workspace.id);

    // An invited account joined someone else's workspace, or is not its admin: nothing to name
    const inviter = await findOrCreateUser(`welcome-inviter-${randomUUID()}@example.com`);
    const inviterMember = await ensureOwnWorkspace(inviter);
    const invited = { member: { ...inviterMember, userId: user.id, role: 'commenter' as const }, workspace: (await getWorkspace(inviterMember.workspaceId))! };
    expect(welcomeWorkspace({ user, memberships: [invited] } as AppContext)).toBeUndefined();
    expect(welcomeWorkspace({ user, memberships: [{ member: { ...member, role: 'commenter' as const }, workspace }] } as AppContext)).toBeUndefined();
});

test('automatic workspaces start as Personal and returning accounts keep their stored names', async () => {
    for (const domain of ['gmail.com', 'acme.test']) {
        const user = await findOrCreateUser(`personal-${randomUUID()}@${domain}`);
        const member = await ensureOwnWorkspace(user);
        expect((await getWorkspace(member.workspaceId))?.name).toBe('Personal');
        await renameWorkspace(member.workspaceId, user.id, 'Existing studio');
        expect((await ensureOwnWorkspace(user)).workspaceId).toBe(member.workspaceId);
        expect((await getWorkspace(member.workspaceId))?.name).toBe('Existing studio');
    }
});
