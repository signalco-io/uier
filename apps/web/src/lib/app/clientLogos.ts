import { nanoid } from 'nanoid';
import { apiErrors } from '../comments/http';
import { PUBLIC_WORKSPACE_ID } from '../comments/publicProjectPolicy';
import { hasProjectAccess, loadWorkspaceAccess } from './access';
import { isAvatarVersion, type AvatarImage } from './avatars';
import { getClient } from './clients';
import { clientLogoDocId, memberId, workspacePk, type DbClientLogo, type DbMember, type DbProject } from './model';
import { isLiveProject } from './projectPublicIds';
import { getAppStore, type AppMutation, type AppStore } from './store';
import { workspaceIdSchema } from './validation';

/** Like the Clients page: visible only through a live project the current member can open. */
export async function clientLogoAccess(workspaceId: string, clientId: string, userId: string, admin = false, store: AppStore = getAppStore()) {
    if (!workspaceIdSchema.safeParse(workspaceId).success) return null;
    const pk = workspacePk(workspaceId);
    const [client, member] = await Promise.all([
        getClient(workspaceId, clientId, store), store.get<DbMember>(pk, memberId(userId))
    ]);
    if (!client || member?.doc.type !== 'member' || member.doc.workspaceId !== workspaceId || member.doc.userId !== userId) return null;
    const [projects, access] = await Promise.all([
        store.query<DbProject>({ type: 'project', pk, where: { clientId } }), loadWorkspaceAccess(workspaceId, store)
    ]);
    for (const project of projects) {
        if (hasProjectAccess(access, member.doc, project) && await isLiveProject(project, store)) {
            if (admin && (member.doc.role !== 'admin' || workspaceId === PUBLIC_WORKSPACE_ID))
                throw apiErrors.forbidden('Only admins can change client logos.');
            return client;
        }
    }
    return null;
}

/** Every read rechecks current visibility, even if the caller already knows an old image URL. */
export async function getClientLogoImage(workspaceId: string, clientId: string, version: string, userId: string, store: AppStore = getAppStore()) {
    if (!isAvatarVersion(version)) return null;
    const client = await clientLogoAccess(workspaceId, clientId, userId, false, store);
    if (client?.doc.logo?.version !== version) return null;
    const image = (await store.get<DbClientLogo>(workspacePk(workspaceId), clientLogoDocId(version)))?.doc;
    return image?.type === 'client-logo' && image.clientId === clientId && image.workspaceId === workspaceId ? image : null;
}

/** A reference and its image change atomically, preserving concurrent edits to client details. */
export async function changeClientLogo(workspaceId: string, clientId: string, userId: string, image: AvatarImage | null, store: AppStore = getAppStore()) {
    const pk = workspacePk(workspaceId);
    for (let attempt = 0; attempt < 8; attempt++) {
        const current = await clientLogoAccess(workspaceId, clientId, userId, true, store);
        if (!current) throw apiErrors.notFound('Client not found.');
        if (!image && !current.doc.logo) return current.doc;
        const previous = current.doc.logo ? await store.get<DbClientLogo>(pk, clientLogoDocId(current.doc.logo.version)) : null;
        const now = new Date().toISOString();
        const version = nanoid();
        const { logo: _logo, ...rest } = current.doc;
        const client = { ...rest, ...(image ? { logo: { version, updatedAt: now } } : {}), updatedAt: now };
        const operations: AppMutation[] = [{ kind: 'replace', doc: client, etag: current.etag }];
        if (image) operations.push({ kind: 'create', doc: {
            type: 'client-logo', id: clientLogoDocId(version), pk, workspaceId, clientId,
            contentType: 'image/webp', size: image.size, bytes: image.data.length,
            data: image.data.toString('base64'), createdAt: now
        } satisfies DbClientLogo });
        if (previous) operations.push({ kind: 'delete', pk, id: previous.doc.id, etag: previous.etag });
        if (await store.transact(operations)) return client;
    }
    throw new Error('Could not save the client logo');
}
