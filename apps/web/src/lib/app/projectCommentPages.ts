import { selectedGroupLabels } from './projectCommentPaging';
import { timingSafeEqual } from 'node:crypto';
import { agentIsWorking } from '@uier/toolbar/agents';
import { commentPriority, matchesFeedbackSearch } from '@uier/toolbar/triage';
import { feedbackStages, feedbackStage } from '@uier/toolbar/verification';
import { keyedHash } from '../comments/environment';
import { ApiError, apiErrors } from '../comments/http';
import { loadReadSequences } from '../comments/readState';
import { readActivity } from '../comments/activity';
import { commentPath } from '../comments/dto';
import { threadPullRequestLinks } from '../comments/pullRequestLinks';
import { getAppStore } from './store';
import { notificationPk, type NotificationSubscription } from '../notifications/preferences';
import { getCommentsStore } from '../repo/commentsStore';
import type { CommentQueryCandidate } from '../repo/commentQuerySource';
import { commentVisibilityFilter } from '../review/comments';
import { threadTitle } from '../titles/model';
import { aiTitlesEnabled } from '../titles/settings';
import { appActor, loadProjectComment, loadProjectComments, type ProjectCommentView } from './projectComments';
import { environmentFilter, feedbackSource } from './environments';
import { effectiveThreadLabels } from './threadLabels';
import { labelsForComment } from './threadLabel';
import { effectiveStatusWorkflow } from './statusWorkflows';
import { orderedStatuses, statusForComment } from './statusWorkflow';
import { boardSortsOf } from './boardSort';
import { boardSortOrders, compareCommentOrder } from '../../components/app/comments/commentOrder';
import { pageMatches } from '../../components/app/comments/pageFilter';
import { boardStatusFilter, statusMatches, type StatusFilter } from '../../components/app/comments/commentLabels';
import type { CommentsQuery } from '../../components/app/comments/commentsQuery';
import type { AppContext } from './context';
import type { DbProject } from './model';
import type { listProjectMembers } from './members';
import { englishAppTranslator } from '../i18n/translate';
import type { AppTranslator } from '../i18n/types';

export { PROJECT_COMMENT_PAGE_SIZE } from './projectCommentPaging';
import { labelLaneKey, PROJECT_COMMENT_MAX_DEPTH, PROJECT_COMMENT_PAGE_SIZE, projectCommentPageKey, type CommentLane, type CommentPage, type ProjectCommentPaging, type ProjectCommentPageInput } from './projectCommentPaging';
export type { ProjectCommentPageInput } from './projectCommentPaging';

type Pivot = Pick<ProjectCommentView, 'id' | 'number' | 'createdAt' | 'updatedAt' | 'completedAt' | 'archivedAt'> & { priority?: ProjectCommentView['priority'] };
type Cursor = { key: string; after: Pivot; expires: number };
const stages = feedbackStages;
const filters: StatusFilter[] = ['active', ...stages, 'all', 'archived'];

function signCursor(cursor: Cursor) {
    const body = Buffer.from(JSON.stringify(cursor)).toString('base64url');
    return `${body}.${keyedHash('project-comment-page-v1', body)}`;
}
function readCursor(token: string, key: string): Cursor {
    try {
        if (token.length > 8192) throw new Error();
        const [body, signature, extra] = token.split('.');
        const actual = Buffer.from(signature ?? ''), expected = Buffer.from(keyedHash('project-comment-page-v1', body ?? ''));
        if (extra || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
        const cursor = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8')) as Cursor;
        if (cursor.key !== key || !Number.isFinite(cursor.expires) || cursor.expires <= Date.now() || typeof cursor.after?.id !== 'string') throw new Error();
        return cursor;
    } catch { throw apiErrors.invalidRequest('The query cursor expired or belongs to a different query.'); }
}
/** Only the row presentation crosses the initial boundary, never its full discussion or diagnostics. */
function summary(view: ProjectCommentView): ProjectCommentView {
    const pullRequests = threadPullRequestLinks([{ text: view.text, deleted: view.deleted }, ...view.replies], view.pullRequests)
        .map(link => ({ url: link.url, canRemove: view.pullRequests?.find(saved => saved.url === link.url)?.canRemove ?? false }));
    return { ...view, pullRequests, workflow: undefined, availableLabels: undefined, summary: true, text: view.text.slice(0, 500), displayText: view.displayText.slice(0, 500),
        displayMentions: view.displayMentions?.filter(mention => mention.end <= 500), replies: [], history: undefined,
        screenshot: undefined, anchor: { type: 'page', label: '' }, reproduction: { text: '' }, quotedText: undefined, reactions: undefined,
        verification: view.verification ? { ...view.verification, fixUrl: undefined } : undefined };
}

/** One projected, budgeted scan per request. Canonical/enrichment reads are bounded to the selected page(s). */
export async function loadProjectCommentPages(context: AppContext, project: DbProject, query: CommentsQuery,
    membersForRequest: ReturnType<typeof listProjectMembers>, authorId?: string, input: ProjectCommentPageInput = {}, t: AppTranslator = englishAppTranslator) {
    const actor = appActor(context), domain = `project:${project.id}`, viewerId = `user:${context.user.id}`;
    const [candidates, reads, members, subscriptions] = await Promise.all([
        getCommentsStore().queryCandidates(domain, { visibility: commentVisibilityFilter(domain, actor),
            origin: query.environment && query.environment !== 'all' ? environmentFilter(project, query.environment) : undefined,
            archive: 'all', authorId, includeText: Boolean(query.q), signal: input.signal }),
        loadReadSequences(domain, viewerId), membersForRequest,
        getAppStore().query<NotificationSubscription>({ type: 'notification-subscription', pk: notificationPk(project.id), where: { actorId: viewerId } })
    ]);
    input.signal?.throwIfAborted();
    const scope = candidates.filter(comment => comment.thread.items.length && (!authorId || comment.authorId === authorId || comment.thread.items.some(item => !item.deletedAt && item.authorId === authorId)));
    const titles = aiTitlesEnabled(context.workspace, project), labels = effectiveThreadLabels(context.workspace, project);
    const matches = (comment: CommentQueryCandidate) => {
        if (query.label && !labelsForComment(labels, comment).some(label => label.id === query.label)) return false;
        if (query.priority && commentPriority(comment.priority) !== query.priority) return false;
        if (query.page && !pageMatches(query.page, commentPath(comment))) return false;
        const assignees = comment.assigneeIds ?? (comment.assigneeId ? [comment.assigneeId] : []);
        if (query.people === 'assigned' && !assignees.includes(context.user.id)) return false;
        if (query.people === 'unassigned' && assignees.length) return false;
        if (query.people === 'mine' && comment.thread.items[0]?.authorId !== viewerId) return false;
        if (query.unread && comment.id !== input.openId && !readActivity(comment, viewerId, reads.get(comment.id)).unread) return false;
        if (!query.q) return true;
        return matchesFeedbackSearch({ path: commentPath(comment), number: comment.number,
            context: [threadTitle(comment, titles)?.text ?? ''], messages: comment.thread.items.map(item => ({ ...item, deleted: Boolean(item.deletedAt) })) }, query.q ?? '');
    };
    const matching = scope.filter(matches), sorts = boardSortsOf(project.boardSorts);
    const archiveExpanded = input.archiveExpanded ?? Boolean(project.boardArchiveExpanded);
    const workflow = effectiveStatusWorkflow(context.workspace, project), definitions = orderedStatuses(workflow);
    const stage = (comment: CommentQueryCandidate) => feedbackStage({ ...comment, verificationEnabled: workflow.verificationEnabled === true });
    const key = projectCommentPageKey(query, sorts, archiveExpanded, workflow, `${project.id}:${context.user.id}`, selectedGroupLabels(project, labels));
    const board = query.view === 'board' && query.status !== 'archived';
    const boardStatus = board ? boardStatusFilter(query.status) : undefined;
    const lanes: Partial<Record<CommentLane, CommentPage>> = {};
    const selected = new Set<string>();
    const groupLabels = selectedGroupLabels(project, labels);
    const groups = groupLabels ? [...groupLabels, 'unlabeled'] : [''];
    const laneDefinitions = definitions.flatMap(status => groups.map(label => ({ status, label, id: label ? labelLaneKey(status.id, label) : status.id })));
    const rowsByLane = new Map(laneDefinitions.map(lane => [lane.id, [] as CommentQueryCandidate[]]));
    for (const comment of matching) {
        const status = statusForComment(workflow, comment).id;
        const assigned = groupLabels ? labelsForComment(labels, comment).map(label => label.id).filter(id => groupLabels.includes(id)) : [''];
        for (const label of assigned.length ? assigned : ['unlabeled'])
            rowsByLane.get(label ? labelLaneKey(status, label) : status)?.push(comment);
    }
    if (board) for (const { status, id } of laneDefinitions) lanes[id] = { ids: [], total: boardStatus && status.category !== boardStatus ? 0 : rowsByLane.get(id)!.length, nextCursor: null };
    const available = laneDefinitions.filter(({ status }) => (!boardStatus || status.category === boardStatus) && (status.category !== 'archive' || archiveExpanded));
    const choices: CommentLane[] = input.lane ? [input.lane] : board ? available.map(lane => lane.id) : ['list'];
    if (input.lane && (board ? !available.some(lane => lane.id === input.lane) : input.lane !== 'list')) throw apiErrors.invalidRequest('This column does not belong to the current view.');
    if (input.depths && Object.keys(input.depths).some(lane => !choices.includes(lane))) throw apiErrors.invalidRequest('This column does not belong to the current view.');
    for (const lane of choices) {
        const definition = board ? laneDefinitions.find(value => value.id === lane)!.status : undefined;
        const sort = definition ? sorts[definition.category] : undefined;
        const compare = (a: Pivot, b: Pivot) => (sort ? boardSortOrders[sort](a, b) : compareCommentOrder(a, b)) || compareCommentOrder(a, b) || a.id.localeCompare(b.id);
        const rows = (board ? rowsByLane.get(lane)! : matching.filter(comment => statusMatches(query.status, stage(comment), comment.archivedAt))).sort(compare);
        const binding = keyedHash('project-comment-page-binding', JSON.stringify([key, lane, viewerId, project.id, context.isAdmin, project.access, project.urls, query.unread ? input.openId : undefined]));
        const cursor = input.cursor ? readCursor(input.cursor, binding) : undefined;
        const remaining = cursor ? rows.filter(row => compare(row, cursor.after) > 0) : rows;
        const depth = input.depths?.[lane] ?? 1;
        if (!Number.isInteger(depth) || depth < 1 || depth > PROJECT_COMMENT_MAX_DEPTH) throw apiErrors.invalidRequest('Invalid column depth.');
        const size = input.allIds ? Math.max(rows.length, 1) : depth * PROJECT_COMMENT_PAGE_SIZE;
        const page = remaining.slice(0, size), last = page.at(-1);
        const after = last && { id: last.id, priority: last.priority ?? 'normal', number: last.number, createdAt: last.createdAt,
            updatedAt: last.updatedAt, completedAt: last.completedAt, archivedAt: last.archivedAt };
        lanes[lane] = { ids: page.map(row => row.id), total: rows.length,
            nextCursor: remaining.length > size && after ? signCursor({ key: binding, after, expires: cursor?.expires ?? Date.now() + 15 * 60_000 }) : null };
        for (const row of page) selected.add(row.id);
    }
    const statusCounts = Object.fromEntries(filters.map(filter => [filter, matching.filter(comment => statusMatches(filter, stage(comment), comment.archivedAt)).length])) as Record<StatusFilter, number>;
    const statusUnread = Object.fromEntries(filters.map(filter => [filter, matching.filter(comment => statusMatches(filter, stage(comment), comment.archivedAt) && readActivity(comment, viewerId, reads.get(comment.id)).unread).length])) as Record<StatusFilter, number>;
    const paths = new Map<string, number>();
    for (const comment of scope.filter(comment => board || Boolean(comment.archivedAt) === (query.status === 'archived'))) {
        const path = commentPath(comment); paths.set(path, (paths.get(path) ?? 0) + 1);
    }
    const paging: ProjectCommentPaging = { key, lanes, statusCounts, statusUnread, scopeTotal: scope.length, matchedTotal: matching.length,
        pages: [...paths].map(([path, count]) => ({ path, count })),
        historySources: [...new Set(scope.map(comment => feedbackSource(project, comment.origin).environment).filter(id => id === 'removed' || id === 'unknown'))],
        unreadCount: matching.filter(comment => (board ? (!boardStatus || stage(comment) === boardStatus && !comment.archivedAt) && (!comment.archivedAt || archiveExpanded) : statusMatches(query.status, stage(comment), comment.archivedAt)) && readActivity(comment, viewerId, reads.get(comment.id)).unread).length };
    const [views, openedComment] = await Promise.all([
        input.revisionOnly ? [] : loadProjectComments(context, project, undefined, undefined, undefined, Promise.resolve(members), 'all', t, [...selected], { reads, subscriptions }),
        !input.revisionOnly && input.openId && !selected.has(input.openId) && scope.some(comment => comment.id === input.openId) ? loadProjectComment(context, project, input.openId).catch(error => {
            if (error instanceof ApiError && error.status === 404) return null;
            throw error;
        }) : undefined
    ]);
    // Stable across presentation filters and cursors. Off-page edits, read cursors, policy, names and expiring leases count.
    const revision = keyedHash('app-comments-paged-snapshot', JSON.stringify({
        scope: scope.map(comment => [comment.id, comment.revision, reads.get(comment.id) ?? 0,
            [...(comment.assigneeAgents ?? (comment.assigneeAgent ? [comment.assigneeAgent] : []))].map(agent => agentIsWorking(agent.workingUntil))]).sort(([a], [b]) => String(a).localeCompare(String(b))),
        members, subscriptions, project, user: context.user, workspace: context.workspace, actor
    }));
    const byId = new Map(views.map(view => [view.id, view]));
    if (!input.revisionOnly) for (const lane of Object.values(lanes)) if (lane) lane.ids = lane.ids.filter(id => byId.has(id));
    return { comments: [...selected].flatMap(id => byId.has(id) ? [summary(byId.get(id)!)] : []), openedComment: openedComment ?? undefined, paging, revision };
}
