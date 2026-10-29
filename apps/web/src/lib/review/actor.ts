import { z } from 'zod';
import { apiErrors } from '../comments/http';
import { getAppStore } from '../app/store';
import { getMember, memberCanAccessProject } from '../app/workspaces';
import { getUser } from '../app/users';
import { isRandomToken, randomToken, sha256Hex, signToken, verifyToken } from '../app/tokens';
import { MAX_NAME_LENGTH } from '../app/limits';
import type { AppDoc, DbProject } from '../app/model';
import { publicProjectMember } from '../comments/publicProjectPolicy';

/**
 * Who is using the toolbar on a project's site:
 * - `member`: signed in to uier with access to the project (a review token, `Authorization: Bearer`)
 * - `guest`: anyone else with a visitor id (`X-Uier-Visitor`, a random token kept by the toolbar)
 * - `anonymous`: neither (reading only)
 */
export type ProjectActor =
    | { kind: 'member'; userId: string; name: string; isAdmin: boolean; agent?: import('../db/schema').AgentSource }
    | { kind: 'guest'; visitorId: string }
    | { kind: 'anonymous' };

export const REVIEW_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const REVIEW_CODE_TTL_SECONDS = 10 * 60;
export const VISITOR_HEADER = 'X-Uier-Visitor';

type ReviewTokenPayload = { uid: string; pid: string };

type DbReviewCode = AppDoc & {
    type: 'review-code';
    pk: `review-code:${string}`;
    userId: string;
    projectId: string;
    createdAt: string;
    ttl: number;
};

const reviewCodePk = (hash: string) => `review-code:${hash}` as const;

/** The author id stored with a project comment */
export function actorAuthorId(actor: ProjectActor) {
    if (actor.kind === 'member')
        return `user:${actor.userId}`;
    if (actor.kind === 'guest')
        return actor.visitorId;
    return undefined;
}

/** A member of the project's workspace with access to it, as an actor; `null` otherwise */
export async function memberActor(project: DbProject, userId: string): Promise<ProjectActor | null> {
    const member = await getMember(project.workspaceId, userId);
    if (!member)
        return null;
    const user = await getUser(userId);
    if (!user)
        return null;
    const effective = publicProjectMember(member, user.email);
    if (!memberCanAccessProject(effective, project.id))
        return null;
    return { kind: 'member', userId, name: user.name, isAdmin: effective.role === 'admin' };
}

/** The actor of a toolbar request; an invalid or foreign review token counts as none */
export async function resolveActor(request: Request, project: DbProject): Promise<ProjectActor> {
    const authorization = request.headers.get('authorization');
    const bearer = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : undefined;
    const review = verifyToken<ReviewTokenPayload>('review', bearer);
    if (review && review.pid === project.id && typeof review.uid === 'string') {
        const member = await memberActor(project, review.uid);
        if (member)
            return member;
    }

    const visitor = request.headers.get(VISITOR_HEADER)?.trim();
    if (isRandomToken(visitor))
        return { kind: 'guest', visitorId: sha256Hex(visitor) };

    return { kind: 'anonymous' };
}

/**
 * A single-use code for the review link (`uier-token` in the site URL), valid for 10 minutes. The
 * toolbar exchanges it for a review token right away, so the token never appears in a URL.
 */
export async function issueReviewCode(userId: string, projectId: string) {
    const code = randomToken();
    const hash = sha256Hex(code);
    await getAppStore().create<DbReviewCode>({
        type: 'review-code',
        id: hash,
        pk: reviewCodePk(hash),
        userId,
        projectId,
        createdAt: new Date().toISOString(),
        ttl: REVIEW_CODE_TTL_SECONDS
    });
    return code;
}

/** Uses up a review code: the review token and the member, or `null` when the code is not valid */
export async function exchangeReviewCode(project: DbProject, code: unknown) {
    if (!isRandomToken(code))
        return null;

    const store = getAppStore();
    const hash = sha256Hex(code);
    const entry = (await store.get<DbReviewCode>(reviewCodePk(hash), hash))?.doc;
    if (!entry || entry.projectId !== project.id || Date.parse(entry.createdAt) + REVIEW_CODE_TTL_SECONDS * 1000 <= Date.now())
        return null;
    if (!await store.delete(entry.pk, entry.id))
        return null;

    const actor = await memberActor(project, entry.userId);
    if (!actor)
        return null;
    return {
        token: signToken<ReviewTokenPayload>('review', { uid: entry.userId, pid: project.id }, REVIEW_TOKEN_TTL_SECONDS),
        actor
    };
}

/** Comments are on, and this actor may use them (members always; anyone in guest mode) */
export function assertCanUseComments(project: DbProject, actor: ProjectActor) {
    if (project.access === 'disabled')
        throw apiErrors.commentsDisabled();
    if (project.access === 'invited' && actor.kind !== 'member')
        throw apiErrors.signInRequired();
}

/** Guests tag their comments with a name */
export const guestNameSchema = z.string().trim()
    .min(1, 'Enter your name.')
    .max(MAX_NAME_LENGTH, `Use at most ${MAX_NAME_LENGTH} characters.`);

export function assertWriter(actor: ProjectActor) {
    if (actor.kind === 'anonymous')
        throw apiErrors.invalidRequest('Comments need a visitor id.');
}
