import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAppStore } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import { ensureOwnWorkspace, getMember, getWorkspace } from '../src/lib/app/workspaces';
import { createProject } from '../src/lib/app/projects';
import { removeMember } from '../src/lib/app/invitations';
import { accessImpact, saveTeam, updateMemberAccess } from '../src/lib/app/teams';
import { loadWorkspaceAccess } from '../src/lib/app/access';
import { memberActor } from '../src/lib/review/actor';
import { memberId, type DbAccessEvent, type DbMember } from '../src/lib/app/model';
import type { AppContext } from '../src/lib/app/context';
import { memberAccessActionSchema } from '../src/components/app/teams/actionSchemas';
import { describeAccessEvent, type ActivityNames } from '../src/components/app/teams/activityText';
import { createAppTranslator } from '../src/lib/i18n/translate';
import de from '../src/lib/i18n/catalogs/management/de';
import fr from '../src/lib/i18n/catalogs/management/fr';
import es from '../src/lib/i18n/catalogs/management/es';
import it from '../src/lib/i18n/catalogs/management/it';
import hr from '../src/lib/i18n/catalogs/management/hr';
import { PUBLIC_WORKSPACE_ID } from '../src/lib/comments/publicProjectPolicy';

test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });

async function fixture() {
    const admin = await findOrCreateUser(`role-admin-${randomUUID()}@example.test`);
    const member = await ensureOwnWorkspace(admin);
    const workspace = (await getWorkspace(member.workspaceId))!;
    const context = { user: admin, member, workspace, isAdmin: true, memberships: [{ member, workspace }] } satisfies AppContext;
    const user = await findOrCreateUser(`role-person-${randomUUID()}@example.test`);
    const person: DbMember = { ...member, id: memberId(user.id), userId: user.id, email: user.email, role: 'commenter', projects: [] };
    const store = getAppStore();
    await store.create(person);
    const personContext: AppContext = { ...context, user, member: person, isAdmin: false };
    const revision = async () => (await getWorkspace(workspace.id))!.accessRevision ?? 0;
    const events = () => store.query<DbAccessEvent>({ type: 'access-event', pk: workspace.pk });
    return { context, personContext, person, user, store, revision, events };
}

test('role changes preserve grants, preview effective access and record one translated activity event per change', async () => {
    const f = await fixture();
    const a = await createProject(f.context, { name: 'Alpha', urls: ['https://alpha.example'] });
    const b = await createProject(f.context, { name: 'Beta', urls: ['https://beta.example'] });
    const team = await saveTeam(f.context, { name: 'Design', projectIds: [a.id] });
    const grants = { projects: [a.id], teamIds: [team], relationship: 'external' as const };
    await updateMemberAccess(f.context, f.user.id, grants);
    const person = (await getMember(f.context.workspace.id, f.user.id))!;
    const access = await loadWorkspaceAccess(f.context.workspace.id);
    const next = { ...grants, role: 'admin' as const };
    expect(accessImpact(access, person, next, [a, b]).find(row => row.id === b.id)).toMatchObject({ before: [], after: ['Workspace admin'] });
    const revision = await f.revision();
    await updateMemberAccess(f.context, f.user.id, next, revision);
    const promoted = (await getMember(f.context.workspace.id, f.user.id))!;
    expect(promoted).toMatchObject({ ...grants, role: 'admin' });
    expect(await memberActor(b, f.user.id)).toMatchObject({ isAdmin: true });
    const events = (await f.events()).filter(event => event.before.role === 'commenter' && event.after.role === 'admin');
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event).toMatchObject({ action: 'member.access', actorId: f.context.user.id, targetIds: expect.arrayContaining([person.id]), ttl: 180 * 86400 });
    expect(event.before).toMatchObject({ ...grants, role: 'commenter' });
    expect(event.after).toMatchObject(next);
    const names: ActivityNames = { people: new Map([[f.user.id, 'Settings']]), invitations: new Map(), teams: new Map(), projects: new Map() };
    expect(describeAccessEvent(event, names)).toMatchObject({ text: 'changed the access of Settings', details: ['Role: Commenter → Admin'] });
    for (const [language, catalog] of [['de', de], ['fr', fr], ['es', es], ['it', it], ['hr', hr]] as const) {
        const description = describeAccessEvent(event, names, createAppTranslator(catalog), language);
        expect(description.text).toContain('Settings');
        expect(description.details).toEqual([`${catalog['Role: {before} → {after}'].replace('{before}', catalog.Commenter).replace('{after}', catalog.Admin)}`]);
        expect(description.details.join()).not.toContain('Role: Commenter → Admin');
    }
    // A retry with the old preview is rejected; a current no-op adds no event or revision.
    await expect(updateMemberAccess(f.context, f.user.id, next, revision)).rejects.toThrow('Access changed since this preview');
    const afterPromotion = await f.revision();
    const eventCount = (await f.events()).length;
    await updateMemberAccess(f.context, f.user.id, next, afterPromotion);
    await updateMemberAccess(f.context, f.user.id, grants, afterPromotion);
    expect((await getMember(f.context.workspace.id, f.user.id))?.role).toBe('admin');
    expect(await f.revision()).toBe(afterPromotion);
    expect(await f.events()).toHaveLength(eventCount);
    expect(accessImpact(access, promoted, { ...grants, role: 'commenter' }, [a, b]).find(row => row.id === b.id)?.after).toEqual([]);
    await updateMemberAccess(f.context, f.user.id, { ...grants, role: 'commenter' }, afterPromotion);
    expect(await getMember(f.context.workspace.id, f.user.id)).toMatchObject({ ...grants, role: 'commenter' });
    expect(await memberActor(b, f.user.id)).toBeNull();
    expect(await memberActor(a, f.user.id)).toMatchObject({ isAdmin: false });
    const demotion = (await f.events()).find(event => event.before.role === 'admin' && event.after.role === 'commenter')!;
    expect(describeAccessEvent(demotion, names).details).toEqual(['Role: Admin → Commenter']);
});

test('role writes reject invalid roles, forged admin contexts, absent targets and the public workspace', async () => {
    const f = await fixture();
    const update = { teamIds: [], projects: [] };
    const before = await f.store.get(f.person.pk, f.person.id);
    for (const role of ['owner', '', null, {}, true]) {
        expect(memberAccessActionSchema.safeParse({ userId: f.user.id, update: { ...update, role }, revision: 0 }).success).toBe(false);
        await expect(updateMemberAccess(f.context, f.user.id, { ...update, role: role as 'admin' })).rejects.toThrow();
    }
    const outsider = await findOrCreateUser(`role-outsider-${randomUUID()}@example.test`);
    for (const context of [
        { ...f.personContext, isAdmin: true },
        { ...f.context, user: outsider }
    ])
        await expect(updateMemberAccess(context, f.user.id, { ...update, role: 'admin' })).rejects.toThrow('your access changed');
    await expect(updateMemberAccess(f.context, outsider.id, { ...update, role: 'admin' })).rejects.toThrow('no longer in the workspace');
    await expect(updateMemberAccess({ ...f.context, workspace: { ...f.context.workspace, id: PUBLIC_WORKSPACE_ID } }, f.user.id, { ...update, role: 'admin' })).rejects.toThrow('Everyone joins');
    expect(await f.store.get(f.person.pk, f.person.id)).toEqual(before);
    expect(await f.revision()).toBe(0);
    expect(await f.events()).toEqual([]);
});

test('only current admins can act and a sole admin cannot demote themselves', async () => {
    const f = await fixture(), update = { projects: [], teamIds: [] };
    const before = await f.store.get(f.context.member.pk, f.context.member.id);
    await expect(updateMemberAccess(f.context, f.context.user.id, { ...update, role: 'commenter' })).rejects.toThrow('at least one admin');
    expect(await f.store.get(f.context.member.pk, f.context.member.id)).toEqual(before);
    expect(await f.revision()).toBe(0);
    expect(await f.events()).toEqual([]);
    await updateMemberAccess(f.context, f.user.id, { ...update, role: 'admin' });
    // Old contexts cannot retain admin powers after their stored role changes or membership disappears.
    const stale = { ...f.personContext, isAdmin: true };
    await updateMemberAccess(f.context, f.user.id, { ...update, role: 'commenter' });
    await expect(updateMemberAccess(stale, f.user.id, { ...update, role: 'admin' })).rejects.toThrow('your access changed');
    await removeMember(f.context, f.user.id);
    await expect(updateMemberAccess(stale, f.context.user.id, { ...update, role: 'commenter' })).rejects.toThrow('your access changed');
    expect(await getMember(f.context.workspace.id, f.user.id)).toBeNull();
});

test('concurrent self-demotions serialize and keep exactly one admin', async () => {
    const f = await fixture(), update = { projects: [], teamIds: [] };
    await updateMemberAccess(f.context, f.user.id, { ...update, role: 'admin' });
    const revision = await f.revision();
    const outcomes = await Promise.allSettled([
        updateMemberAccess(f.context, f.context.user.id, { ...update, role: 'commenter' }),
        updateMemberAccess(f.personContext, f.user.id, { ...update, role: 'commenter' })
    ]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(await f.store.query<DbMember>({ type: 'member', pk: f.person.pk, where: { role: 'admin' } })).toHaveLength(1);
    expect(await f.revision()).toBe(revision + 1);
    expect((await f.events()).filter(event => event.after.role === 'commenter')).toHaveLength(1);
});

test('admin removal racing a demotion cannot remove the last admin or recreate a member', async () => {
    const f = await fixture(), update = { projects: [], teamIds: [] };
    await updateMemberAccess(f.context, f.user.id, { ...update, role: 'admin' });
    const outcomes = await Promise.allSettled([
        removeMember(f.context, f.user.id),
        updateMemberAccess(f.personContext, f.context.user.id, { ...update, role: 'commenter' })
    ]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await f.store.query<DbMember>({ type: 'member', pk: f.person.pk, where: { role: 'admin' } })).toHaveLength(1);
});

test('role updates racing removal never restore a removed member or retain a removed actor’s powers', async () => {
    for (const remove of ['actor', 'target'] as const) {
        const f = await fixture(), update = { projects: [], teamIds: [] };
        await updateMemberAccess(f.context, f.user.id, { ...update, role: 'admin' });
        const outcomes = await Promise.allSettled([
            remove === 'actor'
                ? removeMember({ ...f.personContext, isAdmin: true }, f.context.user.id)
                : removeMember(f.context, f.user.id),
            updateMemberAccess(f.context, f.user.id, { ...update, role: 'commenter' })
        ]);
        if (remove === 'actor') {
            // Whichever guarded write wins revokes the other actor's authority on retry.
            expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
            if (await getMember(f.context.workspace.id, f.context.user.id)) {
                expect((await getMember(f.context.workspace.id, f.user.id))?.role).toBe('commenter');
            } else {
                expect((await getMember(f.context.workspace.id, f.user.id))?.role).toBe('admin');
                await expect(updateMemberAccess(f.context, f.user.id, { ...update, role: 'commenter' })).rejects.toThrow('your access changed');
            }
        } else {
            // The update may win first, but removal must remain final in either order.
            expect(outcomes[0]!.status).toBe('fulfilled');
            expect(await getMember(f.context.workspace.id, f.user.id)).toBeNull();
            await expect(updateMemberAccess(f.context, f.user.id, { ...update, role: 'admin' })).rejects.toThrow('no longer in the workspace');
        }
        expect(await f.store.query<DbMember>({ type: 'member', pk: f.person.pk, where: { role: 'admin' } })).toHaveLength(1);
    }
});
