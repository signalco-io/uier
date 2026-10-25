import { KnownPageLinks } from '../../knownPages';
import { projectOrigins } from '../app/projects';
import type { DbProject } from '../app/model';
import { feedbackExport } from '../comments/feedbackContext';
import { apiErrors } from '../comments/http';
import { toReproductionContext } from '../comments/reproduction';
import { getCommentsStore } from '../repo/commentsStore';
import type { ProjectActor } from './actor';
import { getProjectComment } from './comments';
import { authorNames, toReviewCommentDto } from './dto';

/** One authorized read model for toolbar, app and later integrations. Reloads at export time. */
export async function projectFeedbackExport(project: DbProject, actor: ProjectActor, id: string, siteOrigin: string | undefined, baseUrl: string) {
    const comment = await getProjectComment(project, actor, id);
    if (!comment) throw apiErrors.notFound();
    const dto = toReviewCommentDto(comment, actor, await authorNames([comment]), projectOrigins(project));
    if (!dto) throw apiErrors.notFound();
    // Guests see only the source they are currently reviewing, never other configured addresses
    // or the member-only browser context. Removed sources do not fall back to another environment.
    const allowedOrigins = actor.kind === 'member' ? projectOrigins(project) : siteOrigin ? [siteOrigin] : [];
    const pageUrl = toReproductionContext(comment, allowedOrigins).url;
    const screenshot = dto.screenshot ? await getCommentsStore().getScreenshot(comment.domain, comment.id) : null;
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
    return feedbackExport(dto, {
        projectId: project.id, pageUrl,
        commentUrl,
        screenshotUrl: screenshot ? new URL(actor.kind === 'member'
            ? KnownPageLinks.projectCommentScreenshot(project.id, comment.id)
            : `/api/review/${encodeURIComponent(project.id)}/comments/${encodeURIComponent(comment.id)}/screenshot`, baseUrl).href : undefined
    });
}
