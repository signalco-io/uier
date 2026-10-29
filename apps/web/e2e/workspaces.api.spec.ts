import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAppStore } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import { ensureOwnWorkspace, getMember, listUserMemberships, ownWorkspaceId } from '../src/lib/app/workspaces';
import { memberId, workspacePk, type DbMember, type DbWorkspace } from '../src/lib/app/model';
import { removeMember } from '../src/lib/app/invitations';
import type { AppContext } from '../src/lib/app/context';
import { PUBLIC_WORKSPACE_ID } from '../src/lib/comments/publicProject';

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

test('self-removal compares the stored user id even when an argument coerces to that id', async () => {
    const user = await newUser();
    const member = await ensureOwnWorkspace(user);
    const workspace = (await getAppStore().get<DbWorkspace>(member.pk, member.workspaceId))!.doc;
    const context = { user, member, workspace, isAdmin: true } as AppContext;
    const before = await getAppStore().get(member.pk, member.id);
    for (const id of [user.id, new String(user.id), { toString: () => user.id }])
        await expect(removeMember(context, id as string)).rejects.toThrow('You can\'t remove yourself.');
    expect(await getAppStore().get(member.pk, member.id)).toEqual(before);
});

test('two concurrent admin removals leave exactly one admin and never restore a removed member', async () => {
    const [alice, bob] = await Promise.all([newUser(), newUser()]);
    const a = await ensureOwnWorkspace(alice);
    const b: DbMember = { ...a, id: memberId(bob.id), userId: bob.id, email: bob.email };
    const store = getAppStore();
    await store.create(b);
    const workspace = (await store.get<DbWorkspace>(a.pk, a.workspaceId))!.doc;
    const results = await Promise.allSettled([
        removeMember({ user: alice, member: a, workspace, isAdmin: true } as AppContext, bob.id),
        removeMember({ user: bob, member: b, workspace, isAdmin: true } as AppContext, alice.id)
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(String((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason)).toContain('at least one admin');
    const members = await store.query<DbMember>({ type: 'member', pk: a.pk, where: { role: 'admin' } });
    expect(members).toHaveLength(1);
    const removed = members[0]!.userId === alice.id ? bob : alice;
    expect(await getMember(workspace.id, removed.id)).toBeNull();
    expect((await store.get<DbWorkspace>(workspace.pk, workspace.id))!.doc.memberRemovalVersion).toBe(1);
    await ensureOwnWorkspace(removed);
    expect(await getMember(workspace.id, removed.id)).toBeNull();
});

test('conditional member deletion leaves both documents untouched on a stale guard, changed target or missing target', async () => {
    const user = await newUser();
    const member = await ensureOwnWorkspace(user);
    const store = getAppStore();
    const guard = (await store.get<DbWorkspace>(member.pk, member.workspaceId))!;
    const target = (await store.get<DbMember>(member.pk, member.id))!;
    expect(await store.replaceAndDelete(guard.doc, 'stale', target)).toBe('conflict');
    expect(await store.replaceAndDelete(guard.doc, guard.etag, { ...target, etag: 'stale' })).toBe('conflict');
    expect(await store.get(guard.doc.pk, guard.doc.id)).toEqual(guard);
    expect(await store.get(target.doc.pk, target.doc.id)).toEqual(target);
    await store.delete(member.pk, member.id);
    expect(await store.replaceAndDelete(guard.doc, guard.etag, target)).toBe('not_found');
    expect(await store.get(guard.doc.pk, guard.doc.id)).toEqual(guard);
});

/** Workspaces the user is a member of, without uier's public feedback project every user joins */
async function memberOf(userId: string) {
    return (await listUserMemberships(userId))
        .map(member => member.workspaceId)
        .filter(workspaceId => workspaceId !== PUBLIC_WORKSPACE_ID);
}

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
    expect(await memberOf(user.id)).toEqual([ownWorkspaceId(user.id)]);
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
    expect(await memberOf(user.id)).toEqual([second]);
    expect(await ownWorkspaces(user.id)).toEqual([first.workspaceId, second].sort());

    // Removed from the second one too: a third, and still nothing in the earlier ones
    expect(await getAppStore().delete(workspacePk(second), memberId(user.id))).toBe(true);
    const third = await ensureOwnWorkspace(user);
    expect(third.workspaceId).toBe(ownWorkspaceId(user.id, 3));
    expect(await getMember(first.workspaceId, user.id)).toBeNull();
    expect(await getMember(second, user.id)).toBeNull();
});
