import { nanoid } from 'nanoid';
import sharp from 'sharp';
import { ApiError, apiErrors } from '../comments/http';
import { PUBLIC_WORKSPACE_ID } from '../comments/publicProjectPolicy';
import { avatarErrors, sniffPictureFormat } from './avatars';
import { memberId, workspaceLogoDocId, workspacePk, type DbMember, type DbWorkspace, type DbWorkspaceLogo } from './model';
import { resizeRasterIcon } from './siteIconVariants';
import { getAppStore, type AppMutation } from './store';
import { workspaceIdSchema } from './validation';
import { MAX_WORKSPACE_LOGO_DIMENSION, workspaceLogoSizes } from './workspaceLogoSizes';

type LogoVariants = DbWorkspaceLogo['variants'];

/** Decode one raster frame and persist only the pixels the two display densities need. */
export async function normalizeWorkspaceLogo(input: Buffer): Promise<LogoVariants> {
    if (!input.length) throw apiErrors.invalidRequest(avatarErrors.empty);
    const format = sniffPictureFormat(input);
    if (!format) throw new ApiError(415, 'unsupported_media_type', avatarErrors.type);
    const image = sharp(input, { limitInputPixels: MAX_WORKSPACE_LOGO_DIMENSION ** 2, pages: 1, failOn: 'warning' });
    const metadata = await image.metadata().catch(() => null);
    if (!metadata || metadata.format !== format || !metadata.width || !metadata.height)
        throw apiErrors.invalidRequest(avatarErrors.unreadable);
    if (Math.max(metadata.width, metadata.height) > MAX_WORKSPACE_LOGO_DIMENSION)
        throw apiErrors.invalidRequest('Use an image up to 4096 pixels on each side.');
    const [oneX, twoX] = workspaceLogoSizes;
    try {
        const small = await resizeRasterIcon(image.clone(), oneX);
        const large = await resizeRasterIcon(image, twoX);
        return { [oneX]: small.toString('base64'), [twoX]: large.toString('base64') };
    } catch {
        throw apiErrors.invalidRequest(avatarErrors.unreadable);
    }
}

export async function workspaceLogoAccess(workspaceId: string, userId: string, write = false, store = getAppStore()) {
    if (!workspaceIdSchema.safeParse(workspaceId).success) return null;
    const pk = workspacePk(workspaceId);
    // Read the workspace first: permission changes also change its ETag, which guards the write.
    const workspace = await store.get<DbWorkspace>(pk, workspaceId);
    if (workspace?.doc.type !== 'workspace') return null;
    const member = (await store.get<DbMember>(pk, memberId(userId)))?.doc;
    if (member?.type !== 'member' || member.workspaceId !== workspaceId || member.userId !== userId) return null;
    if (write && (member.role !== 'admin' || workspaceId === PUBLIC_WORKSPACE_ID))
        throw apiErrors.forbidden('Only admins can do this.');
    return workspace;
}

export async function getWorkspaceLogo(workspaceId: string, version: string, userId: string) {
    if (!/^[A-Za-z0-9_-]{21}$/.test(version)) return null;
    const workspace = await workspaceLogoAccess(workspaceId, userId);
    if (workspace?.doc.logoVersion !== version) return null;
    const logo = (await getAppStore().get<DbWorkspaceLogo>(workspace.doc.pk, workspaceLogoDocId(version)))?.doc;
    return logo?.type === 'workspace-logo' ? logo : null;
}

/** The reference, its two variants, and removal of the previous version commit in one batch. */
export async function changeWorkspaceLogo(workspaceId: string, userId: string, variants: LogoVariants | null, store = getAppStore()) {
    for (let attempt = 0; attempt < 8; attempt++) {
        const current = await workspaceLogoAccess(workspaceId, userId, true, store);
        if (!current) throw apiErrors.notFound('This workspace is unavailable or your access changed.');
        const { pk, logoVersion, ...workspace } = current.doc;
        if (!variants && !logoVersion) return;
        const previous = logoVersion ? await store.get<DbWorkspaceLogo>(pk, workspaceLogoDocId(logoVersion)) : null;
        const version = variants ? nanoid() : undefined;
        const operations: AppMutation[] = [{
            kind: 'replace', doc: { ...workspace, pk, ...(version ? { logoVersion: version } : {}) }, etag: current.etag
        }];
        if (variants && version)
            operations.push({ kind: 'create', doc: { type: 'workspace-logo', id: workspaceLogoDocId(version), pk, variants } satisfies DbWorkspaceLogo });
        if (previous)
            operations.push({ kind: 'delete', pk, id: previous.doc.id, etag: previous.etag });
        if (await store.transact(operations)) return;
    }
    throw new ApiError(409, 'conflict', 'Access changed while saving. Refresh and try again.');
}
