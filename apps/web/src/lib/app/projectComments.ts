import { readActivity, type ReadActivity } from '../comments/activity';
import { loadReadSequences } from '../comments/readState';
import type { DbComment, DbCommentKind, DbDeviceSize } from '../db/schema';
import { toReproductionContext, type ReproductionContext } from '../comments/reproduction';
import { commentPath } from '../comments/dto';
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
import { KnownPageLinks } from '../../knownPages';

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
    edited: boolean;
};

/** A comment as the app shows it */
export type ProjectCommentView = {
    activity?: ReadActivity;
    id: string;
    /** The page it was left on: origin and path */
    url: string;
    path: string;
    /** Public id, numbered per project (`#12`, as in the toolbar); missing on older comments */
    number?: number;
    /** The screenshot its author took of the commented part of the page */
    screenshot?: { url: string; width: number; height: number };
    /** A pinned comment, general feedback or a bug report (about the whole page) */
    kind: DbCommentKind;
    device?: DbDeviceSize;
    reproduction: ReproductionContext;
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

function toView(comment: DbComment, project: DbProject, actor: ProjectActor, names: Map<string, string>, readSequence = 0): ProjectCommentView | null {
    const items = Array.isArray(comment.thread?.items) ? comment.thread.items : [];
    const [first, ...replies] = items;
    if (!first)
        return null;

    const myId = actor.kind === 'member' ? `user:${actor.userId}` : undefined;
    const path = commentPath(comment);
    const origin = comment.origin ?? projectOrigins(project)[0] ?? '';
    const size = comment.device?.size;
    return {
        activity: readActivity(comment, myId, readSequence),
        id: comment.id,
        url: `${origin}${path === '/' ? '/' : path}`,
        path,
        number: Number.isInteger(comment.number) ? comment.number : undefined,
        screenshot: comment.screenshot
            ? { url: KnownPageLinks.projectCommentScreenshot(project.id, comment.id), width: comment.screenshot.width, height: comment.screenshot.height }
            : undefined,
        kind: comment.kind === 'feedback' || comment.kind === 'bug' || comment.kind === 'rewrite' ? comment.kind : 'comment',
        device: size && deviceSizes.includes(size) ? size : undefined,
        reproduction: toReproductionContext(comment, projectOrigins(project)),
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
            deleted: Boolean(reply.deletedAt),
            edited: Boolean(reply.editedAt)
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
    const [names, reads] = await Promise.all([
        authorNames(comments), loadReadSequences(`project:${project.id}`, `user:${context.user.id}`)
    ]);
    return comments
        .map(comment => toView(comment, project, actor, names, reads.get(comment.id)))
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
