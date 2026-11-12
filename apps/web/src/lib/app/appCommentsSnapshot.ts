import { effectiveStatusWorkflow } from './statusWorkflows';
import { englishAppTranslator } from '../i18n/translate';
import type { AppTranslator } from '../i18n/types';
import { keyedHash } from '../comments/environment';
import { appActor, loadProjectComments } from './projectComments';
import { environmentOptions, isEnvironmentSelection } from './environments';
import { resolveCommentAuthorFilter } from './commentAuthors';
import { boardSortsOf } from './boardSort';
import { canSortProjectBoard } from './projectBoard';
import { listProjectMembers } from './members';
import type { AppContext } from './context';
import type { DbProject } from './model';
import type { CommentsQuery } from '../../components/app/comments/commentsQuery';

/** Use the same authorized view for a page render and its cheap-to-transfer idle check. */
export async function loadAppCommentsSnapshot(context: AppContext, project: DbProject, input: CommentsQuery, loadRequestMembers?: () => ReturnType<typeof listProjectMembers>, t: AppTranslator = englishAppTranslator) {
    const author = input.author ? await resolveCommentAuthorFilter(context, project, input.author) : undefined;
    if (input.author && !author) return null;
    const query = { ...input, environment: isEnvironmentSelection(project, input.environment) ? input.environment : 'all' };
    let searchWindowCapped = false;
    const membersForRequest = loadRequestMembers?.() ?? listProjectMembers(context.workspace.id, project.id);
    const [comments, members] = await Promise.all([
        loadProjectComments(context, project, query.environment, author?.authorId, capped => { searchWindowCapped = capped; }, membersForRequest, 'all', t),
        membersForRequest
    ]);
    const snapshot = {
        workflow: effectiveStatusWorkflow(context.workspace, project),
        environments: environmentOptions(project), projectId: project.id, access: project.access, isAdmin: context.isAdmin,
        comments, searchWindowCapped, query, authorFilter: author?.filter, userId: context.user.id,
        boardSorts: boardSortsOf(project.boardSorts), boardArchiveExpanded: Boolean(project.boardArchiveExpanded), canSortBoard: canSortProjectBoard(project, appActor(context)),
        assignees: members.map(({ member, name, avatarUrl }) => ({ userId: member.userId, name, avatarUrl }))
    };
    // Presentation filters change locally. Only the authorized environment/author scope belongs
    // to the server revision. Hash the actual rendered view, including time-dependent agent
    // leases, read cursors, current names, titles, access and subscriptions, never raw private rows.
    const revision = keyedHash('app-comments-snapshot', JSON.stringify({ ...snapshot,
        comments: comments.map(({ workflow: _workflow, ...comment }) => comment),
        query: { environment: query.environment, author: query.author },
        project: { name: project.name, urls: project.urls, status: project.status, clientId: project.clientId },
        workspace: { id: context.workspace.id, name: context.workspace.name }, user: { name: context.user.name }
    }));
    return { ...snapshot, revision };
}
