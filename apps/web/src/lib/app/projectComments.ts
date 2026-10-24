import type { DbComment, DbCommentKind, DbDeviceSize } from '../db/schema';
import { normalizePath } from '../comments/validation';
import type { ProjectActor } from '../review/actor';
import {
    canDeleteComment,
    canEditComment,
    canMakeCommentPrivate,
    canResolveComment,
    listProjectComments
} from '../review/comments';
import { authorNames, itemAuthorName } from '../review/dto';
import type { AppContext } from './context';
import type { DbProject } from './model';
import { projectOrigins } from './projects';

/** The signed-in app user as the actor on a project of the current workspace */
export function appActor(context: AppContext): ProjectActor {
    return { kind: 'member', userId: context.user.id, name: context.user.name, isAdmin: context.isAdmin };
}

export type ProjectCommentMessage = {
    id: string;
    author: { name: string; isMe: boolean };
    text: string;
    createdAt?: string;
    deleted: boolean;
};

/** A comment as the app shows it */
export type ProjectCommentView = {
    id: string;
    /** The page it was left on: origin and path */
    url: string;
    path: string;
    /** A pinned comment, general feedback or a bug report (about the whole page) */
    kind: DbCommentKind;
    device?: DbDeviceSize;
    createdAt?: string;
    resolved: boolean;
    private: boolean;
    assignee?: { id: string; name: string };
    /** Author of the comment (its first message) */
    author: { name: string; isMe: boolean };
    /** Text of the first message; empty when its author deleted it (`deleted`) */
    text: string;
    quotedText?: string;
    deleted: boolean;
    edited: boolean;
    replies: ProjectCommentMessage[];
    permissions: { resolve: boolean; edit: boolean; delete: boolean; makePrivate: boolean; assign: boolean };
};

const deviceSizes: readonly DbDeviceSize[] = ['desktop', 'tablet', 'mobile'];

function toView(comment: DbComment, project: DbProject, actor: ProjectActor, names: Map<string, string>): ProjectCommentView | null {
    const items = Array.isArray(comment.thread?.items) ? comment.thread.items : [];
    const [first, ...replies] = items;
    if (!first)
        return null;

    const myId = actor.kind === 'member' ? `user:${actor.userId}` : undefined;
    const path = normalizePath(typeof comment.path === 'string' ? comment.path : '/');
    const origin = comment.origin ?? projectOrigins(project)[0] ?? '';
    const size = comment.device?.size;
    return {
        id: comment.id,
        url: `${origin}${path === '/' ? '/' : path}`,
        path,
        kind: comment.kind === 'feedback' || comment.kind === 'bug' ? comment.kind : 'comment',
        device: size && deviceSizes.includes(size) ? size : undefined,
        createdAt: comment.createdAt,
        resolved: comment.resolved === true,
        private: comment.private === true,
        assignee: comment.assigneeId ? { id: comment.assigneeId, name: names.get(comment.assigneeId) ?? 'Former member' } : undefined,
        author: first.deletedAt
            ? { name: 'Deleted', isMe: false }
            : { name: itemAuthorName(first, names), isMe: Boolean(myId) && first.authorId === myId },
        text: first.deletedAt ? '' : first.text,
        quotedText: first.deletedAt ? undefined : first.quotedText,
        deleted: Boolean(first.deletedAt),
        edited: Boolean(first.editedAt),
        replies: replies.map(reply => ({
            id: String(reply.id),
            author: { name: itemAuthorName(reply, names), isMe: Boolean(myId) && reply.authorId === myId },
            text: reply.text,
            createdAt: reply.createdAt,
            deleted: Boolean(reply.deletedAt)
        })),
        permissions: {
            resolve: canResolveComment(comment, actor),
            edit: canEditComment(comment, actor) && !first.deletedAt,
            delete: canDeleteComment(comment, actor),
            makePrivate: canMakeCommentPrivate(actor),
            assign: actor.kind === 'member'
        }
    };
}

/** Every comment of the project the app user can see (all pages), newest first */
export async function loadProjectComments(context: AppContext, project: DbProject) {
    const actor = appActor(context);
    const comments = await listProjectComments(project, actor);
    const names = await authorNames(comments);
    return comments
        .map(comment => toView(comment, project, actor, names))
        .filter((view): view is ProjectCommentView => Boolean(view));
}

export type ProjectUsage = {
    comments: number;
    open: number;
    done: number;
    replies: number;
    pages: number;
    lastCommentAt?: string;
};

export function projectUsage(comments: ProjectCommentView[]): ProjectUsage {
    return {
        comments: comments.length,
        open: comments.filter(comment => !comment.resolved).length,
        done: comments.filter(comment => comment.resolved).length,
        replies: comments.reduce((count, comment) => count + comment.replies.length, 0),
        pages: new Set(comments.map(comment => comment.path)).size,
        lastCommentAt: comments.map(comment => comment.createdAt).filter(Boolean).sort().at(-1)
    };
}
