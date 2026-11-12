import { effectiveThreadLabels } from '../app/threadLabels';
import { labelsForComment } from '../app/threadLabel';
import { effectiveStatusWorkflow } from '../app/statusWorkflows';
import { getWorkspace } from '../app/workspaces';
import { aiTitlesEnabled } from '../titles/settings';
import { statusForComment } from '../app/statusWorkflow';
import { feedbackSource } from '../app/environments';
import { KnownPageLinks } from '../../knownPages';
import { projectOrigins } from '../app/projects';
import type { DbProject } from '../app/model';
import { feedbackExport } from '../comments/feedbackContext';
import { apiErrors } from '../comments/http';
import { toReproductionContext } from '../comments/reproduction';
import { getCommentsStore } from '../repo/commentsStore';
import type { ProjectActor } from './actor';
import { getProjectComment } from './comments';
import { authorNames, participantNames, toReviewCommentDto } from './dto';
import { getUser } from '../app/users';
import { manualThreadTitle, threadTitle } from '../titles/model';

/** One authorized read model for toolbar, app and later integrations. Reloads at export time. */
export async function projectFeedbackExport(project: DbProject, actor: ProjectActor, id: string, siteOrigin: string | undefined, baseUrl: string) {
    return createProjectFeedbackExportReader(project, actor, siteOrigin, baseUrl)(id);
}

/**
 * One reader per export request/batch, never retained between requests. Only display enrichment is
 * shared: every packet still loads its thread and checks current visibility before reading names,
 * settings or screenshot evidence. Lazy promises avoid any enrichment for unavailable threads.
 */
export function createProjectFeedbackExportReader(project: DbProject, actor: ProjectActor, siteOrigin: string | undefined, baseUrl: string) {
    let workspace: ReturnType<typeof getWorkspace> | undefined;
    const loadWorkspace = () => workspace ??= getWorkspace(project.workspaceId);
    let workflow: Promise<ReturnType<typeof effectiveStatusWorkflow>> | undefined;
    let participants: ReturnType<typeof participantNames> | undefined;
    let titleSetting: Promise<boolean> | undefined;
    const users = new Map<string, ReturnType<typeof getUser>>();
    const user = (id: string) => {
        let pending = users.get(id);
        if (!pending) { pending = getUser(id); users.set(id, pending); }
        return pending;
    };
    return async (id: string) => {
        const comment = await getProjectComment(project, actor, id);
        if (!comment) throw apiErrors.notFound();
        const origins = projectOrigins(project);
        const [names, people] = await Promise.all([
            authorNames([comment], user),
            participants ??= participantNames(project)
        ]);
        const dto = toReviewCommentDto(comment, actor, names, origins, 0, people, project);
        if (!dto) throw apiErrors.notFound();
        // Guests see only the source they are currently reviewing, never other configured addresses
        // or the member-only browser context. Removed sources do not fall back to another environment.
        const allowedOrigins = actor.kind === 'member' ? origins : siteOrigin && origins.includes(siteOrigin) ? [siteOrigin] : [];
        const pageUrl = toReproductionContext(comment, allowedOrigins).url;
        if (actor.kind !== 'member' && dto.verification?.fixUrl && origins.includes(new URL(dto.verification.fixUrl).origin)
            && !allowedOrigins.includes(new URL(dto.verification.fixUrl).origin)) delete dto.verification.fixUrl;
        const [screenshot, titles] = await Promise.all([
            dto.screenshot ? getCommentsStore().getScreenshot(comment.domain, comment.id) : null,
            // Only on a thread the actor can see (getProjectComment): the title is as visible as the first message
            comment.aiTitle && !manualThreadTitle(comment) ? titleSetting ??= loadWorkspace().then(workspace => aiTitlesEnabled(workspace, project)) : false
        ]);
        let commentUrl: string | undefined;
        if (pageUrl) {
            if (actor.kind === 'member') commentUrl = new URL(KnownPageLinks.projectReview(project.id, pageUrl, comment.id), baseUrl).href;
            else {
                const direct = new URL(pageUrl);
                direct.searchParams.set('review', 'true');
                direct.searchParams.set('uier-comment', comment.id);
                commentUrl = direct.href;
            }
        }
        const packet = feedbackExport(dto, {
            projectId: project.id, pageUrl,
            assignees: actor.kind === 'member' ? dto.assignees : undefined,
            assigneeName: actor.kind === 'member' ? dto.assignee?.name : undefined,
            assigneeAgent: actor.kind === 'member' ? dto.assignee?.agent : undefined,
            environment: actor.kind === 'member' || pageUrl ? feedbackSource(project, comment.origin).label : undefined,
            commentUrl,
            title: threadTitle(comment, titles)?.text,
            screenshotUrl: screenshot ? new URL(actor.kind === 'member'
                ? KnownPageLinks.projectCommentScreenshot(project.id, comment.id)
                : `/api/review/${encodeURIComponent(project.publicId ?? project.id)}/comments/${encodeURIComponent(comment.id)}/screenshot`, baseUrl).href : undefined
        });
        return actor.kind === 'member' ? { ...packet, labels: labelsForComment(effectiveThreadLabels(await loadWorkspace(), project), comment), workflowStatus: statusForComment(await (workflow ??= loadWorkspace().then(workspace => effectiveStatusWorkflow(workspace, project))), comment) } : packet;
    };
}
