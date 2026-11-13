import { effectiveThreadLabels } from './threadLabels';
import { labelsForComment, type ThreadLabel } from './threadLabel';
import { effectiveStatusWorkflow } from './statusWorkflows';
import type { StatusWorkflow } from './statusWorkflow';
import { englishAppTranslator } from '../i18n/translate';
import type { AppTranslator } from '../i18n/types';
import type { ArchiveFilter } from '../repo/archiveFilter';
import { feedbackTypeSnapshot, isCommentKind } from '@uier/toolbar/feedback-types';
import { verificationDetails, verificationPermissions } from '../review/fixVerificationDto';
import { commentPriority, type CommentPriority } from '@uier/toolbar/triage';
import { commentRevision } from '../review/commentRevision';
import { environmentFilter, type FeedbackSource } from './environments';
import type { ReadActivity } from '../comments/activity';
import { threadHistoryView, type ThreadHistoryEntry } from '../comments/history';
import { MAX_THREAD_ITEMS } from '../comments/limits';
import { commentAnchor, type CommentAnchorView } from './commentAnchor';
import { projectCommentRouting } from './projectCommentRouting';
import { commentSourcePath } from '../comments/dto';
import { reactionViews } from '../comments/reactions';
import { getReadSequence, loadReadSequences } from '../comments/readState';
import { ApiError } from '../comments/http';
import type { DbComment, DbCommentKind, DbDeviceSize } from '../db/schema';
import { toReproductionContext, type ReproductionContext } from '../comments/reproduction';
import type { ProjectActor } from '../review/actor';
import {
    canTriageProject,
    canDeleteComment,
    canDeleteItem,
    canEditComment,
    canEditItem,
    canMakeCommentPrivate,
    canResolveComment,
    canSeeComment,
    getProjectComment,
    listProjectComments,
    projectPartition
} from '../review/comments';
import { getCommentsStore } from '../repo/commentsStore';
import { authorNames, itemAuthorName, itemPersonName, messageMentions } from '../review/dto';
import { messageAgentView } from '../review/messageAgent';
import { listProjectMembers } from './members';
import type { AppContext } from './context';
import type { DbProject } from './model';
import { projectOrigins } from './projects';
import { KnownPageLinks } from '../../knownPages';
import { isNotificationParticipant, notificationPk, type NotificationSubscription } from '../notifications/preferences';
import { getAppStore } from './store';
import { loadIntegrationLinks } from '../integrations/links';
import type { ExternalFeedbackLink } from '@uier/toolbar/feedback-context';
import { threadTitle } from '../titles/model';
import { aiTitlesEnabled } from '../titles/settings';
import { assignedUserIds } from '../review/assignments';
import { queueAiTitles } from '../titles/threadTitles';

/** The signed-in app user as the actor on a project of the current workspace */
export function appActor(context: AppContext): ProjectActor {
    return { kind: 'member', userId: context.user.id, name: context.user.name, isAdmin: context.isAdmin };
}

/**
 * `avatarUrl`: the profile picture of a member who can still review the project, when they have one.
 * `agent`: the AI agent that wrote the message for them through a coding tool connection (`connection`, its
 * name); `name` is then the person alone and the thread adds "via Claude".
 * `kind`: a member, a guest, a reply from a connected tool (Linear, GitHub...), uier's own starter threads, or a
 * deleted message; rows and cards show an avatar for each (`AuthorAvatar`).
 */
export type ProjectCommentAuthorKind = 'member' | 'guest' | 'integration' | 'uier' | 'deleted';
export type ProjectCommentAuthor = { name: string; isMe: boolean; kind?: ProjectCommentAuthorKind; avatarUrl?: string; agent?: import('@uier/toolbar/agents').MessageAgentView & { connection?: string } };

/** Where a message's text names someone it mentions (`@Ana`): UTF-16 offsets into the text as shown */
export type MessageMentionRange = { start: number; end: number };

export type ProjectCommentMessage = {
    screenshot?: { url: string; width: number; height: number };
    recording?: import('@uier/toolbar/recordings').RecordingInfo;
    id: string;
    author: ProjectCommentAuthor;
    /** As shown: mentions are `@` and the person's current name */
    text: string;
    /** The mentions in `text`, so its Markdown never changes them */
    mentions?: MessageMentionRange[];
    createdAt?: string;
    deleted: boolean;
    edited: boolean;
    quotedText?: string;
    canDelete: boolean;
    canFilterAuthor: boolean;
    /**
     * Only for a message the signed-in member may edit (`canEditItem`, as the toolbar allows): its saved text, the
     * edit's `expectedText`, with its mentions where they are in that text, so an edit keeps them
     */
    editable?: { text: string; mentions: import('../db/schema').DbMention[] };
    pending?: boolean;
    /** Emoji reactions to the message (`comments/reactions.ts`); missing when it has none */
    reactions?: import('@uier/toolbar/reactions').MessageReaction[];
};

export type ProjectAssignee = { id: string; name: string; avatarUrl?: string; agent?: import('@uier/toolbar/agents').AssigneeAgentView; agents?: import('@uier/toolbar/agents').AssigneeAgentView[] };

/**
 * What a list/board summary leaves out, as counts and sizes only (uier #385), so the open thread's loading shell
 * (`CommentCardShell`) has the loaded thread's shape: the replies and the first message's text past the summary's 500
 * characters as `commentOutline.ts` encodes them (a few hundred bytes at most a thread), the first message's reactions,
 * the number of activity entries, what it was left on (`encodeAnchor`: its label and the length of its selected text or
 * selector) and the screenshot's size (`800x600`). Under 200 bytes a thread, so long discussions keep the list's budget. Nothing a viewer of the thread could not see.
 */
export type CommentOutline = {
    replies?: string;
    rest?: string;
    reactions?: number;
    history?: number;
    /** `encodeAnchor`: `t180 Selected text` */
    anchor?: string;
    screenshot?: string;
};

/** A comment as the app shows it */
export type ProjectCommentView = {
    labels?: ThreadLabel[];
    availableLabels?: ThreadLabel[];
    labelIds?: string[];
    verificationEnabled?: boolean;
    workflow?: StatusWorkflow;
    workflowStatusId?: string;
    archiveStatusId?: string;
    /** List/board summary: the canonical detail is loaded only when the thread opens. */
    summary?: boolean;
    /** A summary's outline of what it leaves out, so the open thread's loading shell has its shape (`CommentOutline`) */
    outline?: CommentOutline;
    pullRequests?: { url: string; canRemove: boolean }[];
    history?: ThreadHistoryEntry[];
    priority: CommentPriority;
    revision: string;
    integrationLinks?: ExternalFeedbackLink[];
    source: FeedbackSource;
    following?: boolean;
    activity?: ReadActivity;
    id: string;
    /** The page it was left on, as it was addressed (`/plans/`): origin and source path */
    url: string;
    path: string;
    /** Public id, numbered per project (`#12`, as in the toolbar); missing on older comments */
    number?: number;
    /** The screenshot its author took of the commented part of the page */
    screenshot?: { url: string; width: number; height: number };
    /** Private video metadata; the player requests a fresh URL with current thread access. */
    recording?: import('@uier/toolbar/recordings').RecordingInfo;
    /** A pinned comment, general feedback or a bug report (about the whole page) */
    kind: DbCommentKind;
    feedbackType?: import('@uier/toolbar/feedback-types').FeedbackTypeSnapshot;
    /** What it was left on: an element, selected text (empty once the comment is deleted) or the whole page */
    anchor: CommentAnchorView;
    device?: DbDeviceSize;
    reproduction: ReproductionContext;
    createdAt?: string;
    completedAt?: string;
    updatedAt?: string;
    verification?: import('@uier/toolbar/verification').VerificationDetails;
    verificationPermissions?: import('@uier/toolbar/verification').VerificationPermissions;
    archivedAt?: string;
    resolved: boolean;
    /** The stored In progress flag (`feedbackStage` gives the stage: a pending check or Done comes first) */
    inProgress: boolean;
    private: boolean;
    /** `agent`: the AI agent working under the assignee */
    assignee?: ProjectAssignee;
    assignees?: ProjectAssignee[];
    /** Signed-in assignee, used to name their avatar "you" even when they are not first. */
    assignedUserId?: string;
    eligibleAssigneeIds: string[];
    /**
     * The thread's title (`threadTitle`): the one a member gave it, else the one AI wrote from its first message
     * (`lib/titles`), which is missing until one is made, while titles are off for the project, and once the first
     * message is edited (until a new one) or deleted. Lists show the first line of `displayText` without it.
     */
    title?: string;
    /** `title` was written by AI (it shows the AI mark), not given by a member */
    titleByAi?: boolean;
    /** Author of the comment (its first message) */
    author: ProjectCommentAuthor;
    /** Text of the first message; empty when its author deleted it (`deleted`) */
    text: string;
    /** `text` as shown: mentions are `@` and the person's current name */
    displayText: string;
    /** The mentions in `displayText`, so its Markdown never changes them */
    displayMentions?: MessageMentionRange[];
    quotedText?: string;
    deleted: boolean;
    edited: boolean;
    /** The first message's id, for its reactions (missing in older snapshots) */
    messageId?: string;
    /** Emoji reactions to the first message; missing when it has none */
    reactions?: import('@uier/toolbar/reactions').MessageReaction[];
    replies: ProjectCommentMessage[];
    /** A message (not deleted) mentions the signed-in member */
    mentionsMe: boolean;
    canFilterAuthor: boolean;
    /** `agent`: the signed-in member is the assignee, so they choose the agent working under them */
    /** `title`: can give the thread its own title (as for priority) */
    /** `react`: may add emoji reactions to its messages (who may reply, also when the thread is full) */
    permissions: { resolve: boolean; edit: boolean; delete: boolean; makePrivate: boolean; assign: boolean; agent: boolean; reply: boolean; react?: boolean; triage: boolean; title: boolean };
};

const deviceSizes: readonly DbDeviceSize[] = ['desktop', 'tablet', 'mobile'];

/** A message's text as shown, mentions as `@` and the current name, and where those names are in it */
function mentionText(item: import('../db/schema').DbThreadItem, participants: Map<string, string>): { text: string; mentions?: MessageMentionRange[] } {
    if (item.deletedAt) return { text: '' };
    let text = '';
    let at = 0;
    const mentions: MessageMentionRange[] = [];
    for (const mention of [...(messageMentions(item, participants) ?? [])].sort((a, b) => a.start - b.start)) {
        if (mention.start < at || mention.end <= mention.start || mention.end > item.text.length) continue;
        text += item.text.slice(at, mention.start);
        const name = `@${mention.name}`;
        mentions.push({ start: text.length, end: text.length + name.length });
        text += name;
        at = mention.end;
    }
    return { text: text + item.text.slice(at), ...(mentions.length ? { mentions } : {}) };
}

function anchorView(comment: DbComment, first: import('../db/schema').DbThreadItem, t: AppTranslator): CommentAnchorView {
    const anchor = commentAnchor(comment.position, comment.kind, first.quotedText, t);
    // A deleted comment keeps where it was, not the words it quoted
    return anchor.type === 'text' && first.deletedAt ? { ...anchor, text: '' } : anchor;
}

/** The pictures of the project's current members, by user id: only people who can still review it show theirs */
function memberAvatars(members: Awaited<ReturnType<typeof listProjectMembers>>) {
    return new Map(members.flatMap(({ member, avatarUrl }) => avatarUrl ? [[member.userId, avatarUrl] as const] : []));
}

function authorAvatar(item: import('../db/schema').DbThreadItem, avatars: Map<string, string>) {
    return item.authorId?.startsWith('user:') && !item.deletedAt ? avatars.get(item.authorId.slice('user:'.length)) : undefined;
}

/**
 * What kind of author wrote a message. Guests always have an author id (their visitor id), so only uier's own
 * starter threads (`publicProject.ts`) are named "uier" without one.
 */
function authorKind(item: import('../db/schema').DbThreadItem): ProjectCommentAuthorKind {
    if (item.deletedAt) return 'deleted';
    if (item.authorId?.startsWith('user:')) return 'member';
    if (item.authorId?.startsWith('integration:')) return 'integration';
    return !item.authorId && item.authorName === 'uier' ? 'uier' : 'guest';
}

/** Who wrote a message: the person, and the AI agent that wrote it for them */
function messageAuthor(item: import('../db/schema').DbThreadItem, names: Map<string, string>, myId: string | undefined, avatars: Map<string, string>): ProjectCommentAuthor {
    const agent = messageAgentView(item, true);
    return {
        name: agent ? itemPersonName(item, names) : itemAuthorName(item, names),
        isMe: Boolean(myId) && item.authorId === myId,
        kind: authorKind(item),
        avatarUrl: authorAvatar(item, avatars),
        ...(agent ? { agent: { ...agent, ...(item.agent?.name ? { connection: item.agent.name } : {}) } } : {})
    };
}

function reactionsOf(item: import('../db/schema').DbThreadItem, myId: string | undefined, names: Map<string, string>) {
    const reactions = reactionViews(item, myId, names);
    return reactions ? { reactions } : {};
}

function recordingView(recording: import('@uier/toolbar/recordings').RecordingInfo): import('@uier/toolbar/recordings').RecordingInfo {
    const { id, contentType, size, duration, width, height } = recording;
    return { id, contentType, size, duration, width, height };
}

function toView(comment: DbComment, project: DbProject, actor: ProjectActor, names: Map<string, string>, participants: Map<string, string>, members: Awaited<ReturnType<typeof listProjectMembers>>, readSequence = 0, avatars = memberAvatars(members), titles = false, t: AppTranslator = englishAppTranslator): ProjectCommentView | null {
    const items = Array.isArray(comment.thread?.items) ? comment.thread.items : [];
    const [first, ...replies] = items;
    if (!first)
        return null;

    const myId = actor.kind === 'member' ? `user:${actor.userId}` : undefined;
    const { path, source, assignees, activity } = projectCommentRouting(comment, project, participants, myId, readSequence);
    const origin = source.origin ?? '';
    const size = comment.device?.size;
    const firstText = mentionText(first, participants);
    const title = threadTitle(comment, titles);
    return {
        verificationEnabled: project.verificationEnabled === true,
        verification: verificationDetails(comment, project, actor, participants),
        verificationPermissions: verificationPermissions(comment, project, actor, participants),
        priority: commentPriority(comment.priority),
        revision: commentRevision(comment),
        source,
        activity,
        history: threadHistoryView(comment, { member: actor.kind === 'member', authorId: myId, admin: actor.kind === 'member' && actor.isAdmin }, participants, t),
        id: comment.id,
        url: `${origin}${commentSourcePath(comment)}`,
        path,
        number: Number.isInteger(comment.number) ? comment.number : undefined,
        screenshot: comment.screenshot
            ? { url: KnownPageLinks.projectCommentScreenshot(project.id, comment.id), width: comment.screenshot.width, height: comment.screenshot.height }
            : undefined,
        ...(!first.deletedAt && comment.recording ? { recording: recordingView(comment.recording) } : {}),
        kind: isCommentKind(comment.kind) ? comment.kind : 'comment',
        ...(feedbackTypeSnapshot(comment.feedbackType, comment.kind) ? { feedbackType: feedbackTypeSnapshot(comment.feedbackType, comment.kind) } : {}),
        anchor: anchorView(comment, first, t),
        device: size && deviceSizes.includes(size) ? size : undefined,
        reproduction: toReproductionContext(comment, projectOrigins(project)),
        createdAt: comment.createdAt,
        completedAt: comment.completedAt,
        updatedAt: comment.updatedAt,
        archivedAt: comment.archivedAt,
        resolved: comment.resolved === true,
        inProgress: comment.inProgress === true && comment.resolved !== true,
        labelIds: comment.labelIds,
        workflowStatusId: comment.workflowStatusId,
        archiveStatusId: comment.archiveStatusId,
        private: comment.private === true,
        assignedUserId: actor.kind === 'member' && assignedUserIds(comment).includes(actor.userId) ? actor.userId : undefined,
        eligibleAssigneeIds: members.filter(({ member, user }) => user && canSeeComment(comment, { kind: 'member', userId: member.userId, name: '', isAdmin: member.role === 'admin' })).map(({ member }) => member.userId),
        assignees: assignees.map(person => ({ ...person, avatarUrl: avatars.get(person.id) })),
        assignee: assignees[0] && { ...assignees[0], avatarUrl: avatars.get(assignees[0].id) },
        title: title?.text,
        ...(title?.ai ? { titleByAi: true } : {}),
        author: first.deletedAt
            ? { name: 'Deleted', isMe: false, kind: 'deleted' }
            : messageAuthor(first, names, myId, avatars),
        text: first.deletedAt ? '' : first.text,
        displayText: firstText.text,
        ...(firstText.mentions ? { displayMentions: firstText.mentions } : {}),
        quotedText: first.deletedAt ? undefined : first.quotedText,
        deleted: Boolean(first.deletedAt),
        edited: Boolean(first.editedAt),
        messageId: String(first.id),
        ...reactionsOf(first, myId, names),
        mentionsMe: actor.kind === 'member' && items.some(item => !item.deletedAt && Boolean(item.mentions?.some(mention => mention.userId === actor.userId))),
        canFilterAuthor: actor.kind === 'member' && actor.isAdmin && Boolean(first.authorId ?? comment.authorId) && !first.deletedAt,
        replies: replies.map(reply => ({
            id: String(reply.id),
            ...(!reply.deletedAt && reply.screenshot ? { screenshot: { url: KnownPageLinks.projectReplyScreenshot(project.id, comment.id, reply.id), width: reply.screenshot.width, height: reply.screenshot.height } } : {}),
            ...(!reply.deletedAt && reply.recording ? { recording: recordingView(reply.recording) } : {}),
            author: messageAuthor(reply, names, myId, avatars),
            ...mentionText(reply, participants),
            quotedText: reply.deletedAt ? undefined : reply.quotedText,
            createdAt: reply.createdAt,
            deleted: Boolean(reply.deletedAt),
            edited: Boolean(reply.editedAt),
            canDelete: actor.kind === 'member' && actor.isAdmin && canDeleteItem(reply, actor),
            canFilterAuthor: actor.kind === 'member' && actor.isAdmin && Boolean(reply.authorId) && !reply.deletedAt,
            ...reactionsOf(reply, myId, names),
            ...(actor.kind === 'member' && canEditItem(reply, actor)
                ? { editable: { text: reply.text, mentions: (reply.mentions ?? []).map(({ userId, start, end }) => ({ userId, start, end })) } }
                : {})
        })),
        pullRequests: comment.pullRequests?.map(link => ({ url: link.url, canRemove: canTriageProject(project, actor) && link.addedBy === `user:${actor.kind === 'member' ? actor.userId : ''}` })),
        permissions: {
            resolve: canResolveComment(comment, actor),
            edit: canEditComment(comment, actor) && !first.deletedAt,
            delete: canDeleteComment(comment, actor),
            makePrivate: canMakeCommentPrivate(actor),
            triage: canTriageProject(project, actor),
            title: canTriageProject(project, actor) && !first.deletedAt,
            assign: actor.kind === 'member',
            agent: actor.kind === 'member' && assignedUserIds(comment).includes(actor.userId),
            reply: project.access !== 'disabled' && items.length < MAX_THREAD_ITEMS,
            react: project.access !== 'disabled'
        }
    };
}

/** A freshly authorized detail load has no dependency on the legacy list window. */
export async function loadProjectComment(context: AppContext, project: DbProject, id: string) {
    const actor = appActor(context), comment = await getProjectComment(project, actor, id);
    if (!comment) return null;
    const [members, names, readSequence, subscriptions, integrationLinks] = await Promise.all([
        listProjectMembers(project.workspaceId, project.id), authorNames([comment]),
        getReadSequence(comment.domain, `user:${context.user.id}`, id),
        getAppStore().query<NotificationSubscription>({ type: 'notification-subscription', pk: notificationPk(project.id), where: { actorId: `user:${context.user.id}`, threadId: id } }),
        loadIntegrationLinks(project, actor, [comment])
    ]);
    const participants = new Map(members.filter(({ user }) => user).map(({ member, name }) => [member.userId, name]));
    const workflow = effectiveStatusWorkflow(context.workspace, project);
    const view = toView(comment, project, actor, names, participants, members, readSequence, memberAvatars(members), aiTitlesEnabled(context.workspace, project));
    const labels = effectiveThreadLabels(context.workspace, project);
    return view ? { ...view, workflow, labels: labelsForComment(labels, view), availableLabels: labels, following: subscriptions[0]?.following ?? isNotificationParticipant(comment, `user:${context.user.id}`), integrationLinks: integrationLinks.get(id) } : null;
}

/** Bounded fanout even when a project has many custom-status columns. */
async function selectedProjectComments(project: DbProject, actor: ProjectActor, ids: readonly string[]) {
    const comments: DbComment[] = [];
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(8, ids.length) }, async () => {
        while (index < ids.length) {
            try {
                const comment = await getProjectComment(project, actor, ids[index++]!);
                if (comment) comments.push(comment);
            } catch (error) {
                // A deletion or privacy change after the candidate scan only removes this row.
                if (!(error instanceof ApiError && error.status === 404)) throw error;
            }
        }
    }));
    return comments;
}

/** Every comment of the project the app user can see (all pages), newest first */
export async function loadProjectComments(context: AppContext, project: DbProject, environment?: string, authorId?: string, onWindow?: (capped: boolean) => void, membersForRequest?: ReturnType<typeof listProjectMembers>, archive: ArchiveFilter = 'all', t: AppTranslator = englishAppTranslator, selectedIds?: readonly string[], loadedState?: { reads: Map<string, number>; subscriptions: NotificationSubscription[] }) {
    const actor = appActor(context);
    let windowCapped = false;
    const [comments, members, reads, subscriptions] = await Promise.all([
        selectedIds ? selectedProjectComments(project, actor, selectedIds) : Promise.all((archive === 'all' ? ['exclude', 'only'] as const : [archive]).map(scope =>
            listProjectComments(project, actor, undefined, environment ? environmentFilter(project, environment) : undefined, authorId,
                capped => { windowCapped ||= capped; }, scope)))
            .then(lists => {
                onWindow?.(windowCapped);
                return lists.flat().sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
            }),
        membersForRequest ?? listProjectMembers(project.workspaceId, project.id),
        loadedState?.reads ?? loadReadSequences(`project:${project.id}`, `user:${context.user.id}`),
        loadedState?.subscriptions ?? getAppStore().query<NotificationSubscription>({ type: 'notification-subscription', pk: notificationPk(project.id), where: { actorId: `user:${context.user.id}` } })
    ]);
    const [names, integrationLinks] = await Promise.all([authorNames(comments), loadIntegrationLinks(project, actor, comments)]);
    const participants = new Map(members.filter(({ user }) => user).map(({ member, name }) => [member.userId, name]));
    const avatars = memberAvatars(members);
    // Only threads this person can see (listProjectComments), so a title is never shown beyond its first message
    const titles = aiTitlesEnabled(context.workspace, project);
    const views = comments
        .map(comment => toView(comment, project, actor, names, participants, members, reads.get(comment.id), avatars, titles, t))
        .filter((view): view is ProjectCommentView => Boolean(view));
    // Threads from before titles, or whose title was not made yet: a bounded batch, newest first, after the response
    queueAiTitles(project, comments, 'shown', { enabled: titles });
    const following = new Map(subscriptions.map(subscription => [subscription.threadId, subscription.following]));
    const participated = new Set(comments.filter(comment => isNotificationParticipant(comment, `user:${context.user.id}`)).map(comment => comment.id));
    const workflow = effectiveStatusWorkflow(context.workspace, project);
    const labels = effectiveThreadLabels(context.workspace, project);
    return views.map(view => ({ ...view, workflow, labels: labelsForComment(labels, view), availableLabels: labels, following: following.get(view.id) ?? participated.has(view.id), integrationLinks: integrationLinks.get(view.id) }));
}

export type ProjectUsage = {
    comments: number;
    open: number;
    done: number;
    replies: number;
    pages: number;
    lastCommentAt?: string;
};

/** Usage needs no names, read receipts, subscriptions, assignees or integration links. */
export async function loadProjectUsage(context: AppContext, project: DbProject) {
    const comments = await listProjectComments(project, appActor(context));
    return projectUsage(comments.filter(comment => comment.thread?.items?.length).map(comment => ({
        archivedAt: comment.archivedAt,
        resolved: comment.resolved === true, replies: comment.thread.items.slice(1), path: comment.path ?? '/', createdAt: comment.createdAt
    })));
}

/** How many of the newest comments from the project's addresses `hasProjectFeedback` reads */
const FEEDBACK_WINDOW = 20;

/**
 * Whether one of the newest comments from the project's addresses is one this person can see (the
 * same comments that make Settings → Installation say "Feedback received"): the site sends feedback,
 * so the project header drops its Install tab. One small query, without names or read state.
 */
export async function hasProjectFeedback(context: AppContext, project: DbProject) {
    const actor = appActor(context);
    const recent = await getCommentsStore().listAll(projectPartition(project.id), FEEDBACK_WINDOW, { origins: projectOrigins(project) });
    return recent.some(comment => canSeeComment(comment, actor));
}

export function projectUsage(comments: { archivedAt?: string; resolved: boolean; replies: unknown[]; path: string; createdAt?: string }[]): ProjectUsage {
    return {
        comments: comments.length,
        open: comments.filter(comment => !comment.archivedAt && !comment.resolved).length,
        done: comments.filter(comment => !comment.archivedAt && comment.resolved).length,
        replies: comments.reduce((count, comment) => count + comment.replies.length, 0),
        pages: new Set(comments.map(comment => comment.path)).size,
        lastCommentAt: comments.map(comment => comment.createdAt).filter(Boolean).sort().at(-1)
    };
}
