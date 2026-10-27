import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAppStore } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import { ensureOwnWorkspace, getMember, listUserMemberships, ownWorkspaceId } from '../src/lib/app/workspaces';
import { memberId, workspacePk, type DbWorkspace } from '../src/lib/app/model';

// A user's own workspace (`ensureOwnWorkspace`, run when the user is in no workspace at all): created
// once with its creator as admin, and never handed back to a creator whom an admin removed.

const originalLocal = process.env.UIER_LOCAL;
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => {
    if (originalLocal === undefined)
        delete process.env.UIER_LOCAL;
    else
        process.env.UIER_LOCAL = originalLocal;
});

const newUser = () => findOrCreateUser(`workspace-${randomUUID()}@example.com`);

async function ownWorkspaces(userId: string) {
    return (await getAppStore().query<DbWorkspace>({ type: 'workspace', where: { createdBy: userId } }))
        .map(workspace => workspace.id)
        .sort();
}

test('concurrent first requests create one own workspace with its creator as admin', async () => {
    const user = await newUser();
    const members = await Promise.all(Array.from({ length: 5 }, () => ensureOwnWorkspace(user)));

    expect(new Set(members.map(member => member.workspaceId))).toEqual(new Set([ownWorkspaceId(user.id)]));
    expect(members.every(member => member.role === 'admin' && member.projects === 'all')).toBe(true);
    expect(await ownWorkspaces(user.id)).toEqual([ownWorkspaceId(user.id)]);
    expect(await listUserMemberships(user.id)).toHaveLength(1);
});

test('a creator removed from their own workspace gets a new one, never the old one back', async () => {
    const user = await newUser();
    const first = await ensureOwnWorkspace(user);
    expect(first.workspaceId).toBe(ownWorkspaceId(user.id));

    // An admin removes the creator (removeMember deletes the member document)
    expect(await getAppStore().delete(workspacePk(first.workspaceId), memberId(user.id))).toBe(true);

    // Every request of theirs runs this while they are in no workspace, possibly at the same time
    const again = await Promise.all(Array.from({ length: 5 }, () => ensureOwnWorkspace(user)));
    const second = ownWorkspaceId(user.id, 2);
    expect(new Set(again.map(member => member.workspaceId))).toEqual(new Set([second]));
    expect(await getMember(first.workspaceId, user.id)).toBeNull();
    expect((await listUserMemberships(user.id)).map(member => member.workspaceId)).toEqual([second]);
    expect(await ownWorkspaces(user.id)).toEqual([first.workspaceId, second].sort());

    // Removed from the second one too: a third, and still nothing in the earlier ones
    expect(await getAppStore().delete(workspacePk(second), memberId(user.id))).toBe(true);
    const third = await ensureOwnWorkspace(user);
    expect(third.workspaceId).toBe(ownWorkspaceId(user.id, 3));
    expect(await getMember(first.workspaceId, user.id)).toBeNull();
    expect(await getMember(second, user.id)).toBeNull();
});
