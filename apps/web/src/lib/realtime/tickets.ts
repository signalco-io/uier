import { signToken, verifyToken } from '../app/tokens';
import { findProject, getProject, projectOrigins } from '../app/projects';
import { apiErrors } from '../comments/http';
import { assertCanUseComments, memberActor, type ProjectActor } from '../review/actor';
import type { DbProject } from '../app/model';
import type { RealtimeTicket } from '@uier/toolbar/realtime';

type Identity = { kind: 'member'; userId: string } | { kind: 'guest'; visitorId: string } | { kind: 'anonymous' };
export type RealtimeClaims = {
    domain: string;
    projectId?: string;
    workspaceId?: string;
    origin: string;
    apiOrigin: string;
    audience: 'showcase' | 'review' | 'app';
    identity: Identity;
};

/** Match the review API's public request origin when Vercel terminates TLS upstream. */
export function realtimeApiOrigin(request: Request) {
    const url = new URL(request.url);
    const host = request.headers.get('host');
    const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    if (host) url.host = host;
    if (protocol === 'https' || protocol === 'http') url.protocol = `${protocol}:`;
    return url.origin;
}

/** Origin-bound, five-minute capability. Sent in the first frame, never a URL or browser storage. */
export function issueRealtimeTicket(request: Request, domain: string, actor: ProjectActor, audience: RealtimeClaims['audience'], project?: DbProject): RealtimeTicket {
    const apiOrigin = realtimeApiOrigin(request);
    const origin = request.headers.get('origin') ?? apiOrigin;
    if (audience !== 'review' && origin !== apiOrigin) throw apiErrors.forbidden();
    if (audience === 'review' && origin !== apiOrigin && (!project || !projectOrigins(project).includes(origin)))
        throw apiErrors.forbidden();
    const claims: RealtimeClaims = { domain, origin, apiOrigin, audience,
        ...(project ? { projectId: project.id, workspaceId: project.workspaceId } : {}),
        identity: actor.kind === 'member' ? { kind: 'member', userId: actor.userId }
            : actor.kind === 'guest' ? { kind: 'guest', visitorId: actor.visitorId } : { kind: 'anonymous' } };
    return { token: signToken('realtime', claims, 300), url: `${apiOrigin.replace(/^http/, 'ws')}/api/realtime` };
}

export function readRealtimeTicket(token: string, origin: string, apiOrigin: string) {
    const claims = verifyToken<RealtimeClaims>('realtime', token);
    if (!claims || claims.origin !== origin || claims.apiOrigin !== apiOrigin
        || !['showcase', 'review', 'app'].includes(claims.audience) || typeof claims.domain !== 'string'
        || !claims.identity || !['member', 'guest', 'anonymous'].includes(claims.identity.kind)) return null;
    return claims;
}

/** Recheck membership, role, project access and the reviewed address throughout an open session. */
export async function authorizeRealtime(claims: RealtimeClaims): Promise<ProjectActor> {
    if (claims.audience === 'app' && claims.identity.kind !== 'member') throw apiErrors.forbidden();
    if (!claims.projectId) {
        if (claims.audience !== 'showcase' || claims.identity.kind === 'member') throw apiErrors.forbidden();
        return claims.identity;
    }
    if (claims.domain !== `project:${claims.projectId}`) throw apiErrors.forbidden();
    const project = claims.workspaceId ? await getProject(claims.workspaceId, claims.projectId) : await findProject(claims.projectId);
    if (!project || (claims.audience === 'review' && claims.origin !== claims.apiOrigin && !projectOrigins(project).includes(claims.origin)))
        throw apiErrors.notFound();
    const actor = claims.identity.kind === 'member' ? await memberActor(project, claims.identity.userId) : claims.identity;
    if (!actor) throw apiErrors.signInRequired();
    // Members can still read the app when toolbar comments are disabled.
    if (claims.audience !== 'app') assertCanUseComments(project, actor);
    return actor;
}
