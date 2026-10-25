import { brand } from '@uier/brand';
import { getAppStore, type AppStore } from '../app/store';
import { projectRefPk, workspacePk, type AppDoc, type DbProject, type DbProjectRef, type DbWorkspace } from '../app/model';
import type { DbComment } from '../db/schema';
import { getCommentsStore, type CommentsStore } from '../repo/commentsStore';
import { isLocalRuntime } from './environment';

export const PUBLIC_PROJECT_ID = 'uier00000001';
export const PUBLIC_PROJECT_PARTITION = `project:${PUBLIC_PROJECT_ID}`;
export const HEADLINE_COMMENT_ID = 'comment_uier_headline';
export const STEP_COMMENT_ID = 'comment_uier_first_step';
const workspaceId = 'w_uier_public';
const createdAt = '2026-10-25T00:00:00.000Z';

/** Local subdomains keep their own partitions, useful for isolated reviews and e2e tests. */
export function usesPublicProject(host: string) {
    return !isLocalRuntime() || /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
}

function starterComments(): DbComment[] {
    const common = {
        domain: PUBLIC_PROJECT_PARTITION,
        projectId: PUBLIC_PROJECT_ID,
        origin: brand.url,
        path: '/',
        kind: 'comment' as const,
        resolved: false,
        createdAt,
        updatedAt: createdAt,
        // Explicitly disable expiry, including in containers with a default TTL.
        ttl: -1
    };
    return [{
        ...common,
        id: HEADLINE_COMMENT_ID,
        position: {
            type: 'text', text: 'on the page.', startSelector: '#hero-comment-anchor',
            startOffset: 0, startType: 'text', endOffset: 12, endType: 'text'
        },
        thread: { items: [
            { id: 'item_uier_headline', text: 'Will first-time visitors get what “the page” means before they scroll? “on the site” might land faster.', quotedText: 'on the page.', authorName: 'Guest 3F2A', createdAt },
            { id: 'item_uier_headline_reply', text: 'The line right under it says “live website”. Keeping it, it is the whole point.', authorName: 'uier', createdAt }
        ] }
    }, {
        ...common,
        id: STEP_COMMENT_ID,
        position: { type: 'point', selector: '#first-step-comment-anchor', xNormal: 0.95, yNormal: 0 },
        thread: { items: [{ id: 'item_uier_first_step', text: 'Try it here. Press + in the toolbar, then click anything on the page to leave a comment.', authorName: 'uier', createdAt }] }
    }];
}

/** Create-only: concurrent cold starts never overwrite replies or reset an existing thread. */
async function createIfMissing(store: CommentsStore, comment: DbComment) {
    if (await store.get(comment.domain, comment.id))
        return;
    try {
        await store.create(comment);
    } catch (error) {
        if (!await store.get(comment.domain, comment.id))
            throw error;
    }
}

/** The public project and initial threads, provisioned in the deployment's own containers. */
export async function provisionPublicProject(app: AppStore, comments: CommentsStore, legacyDomain?: string) {
    const project: DbProject = {
        id: PUBLIC_PROJECT_ID, pk: workspacePk(workspaceId), type: 'project', workspaceId,
        name: `${brand.domain} public feedback`, urls: [brand.url], status: 'active', access: 'guests',
        createdBy: 'system', createdAt, updatedAt: createdAt, ttl: -1
    };
    await app.create<DbWorkspace>({ id: workspaceId, pk: workspacePk(workspaceId), type: 'workspace', name: brand.name, createdBy: 'system', createdAt, ttl: -1 });
    await app.create(project);
    await app.create<DbProjectRef>({ id: PUBLIC_PROJECT_ID, pk: projectRefPk(PUBLIC_PROJECT_ID), type: 'project-ref', workspaceId, ttl: -1 });

    // Keep existing production feedback accessible. Copy once; leave the source untouched.
    const migrationId = 'public-feedback-migration-v1';
    if (legacyDomain && !await app.get(project.pk, migrationId)) {
        for (const comment of await comments.listAll(legacyDomain, 1000)) {
            const migrated = { ...comment, domain: PUBLIC_PROJECT_PARTITION, projectId: PUBLIC_PROJECT_ID, origin: brand.url };
            if (await comments.get(migrated.domain, migrated.id))
                continue;
            if (comment.screenshot) {
                const image = await comments.getScreenshot(legacyDomain, comment.id);
                if (image && !await comments.getScreenshot(PUBLIC_PROJECT_PARTITION, comment.id)) {
                    try {
                        await comments.createScreenshot({ ...image, domain: PUBLIC_PROJECT_PARTITION });
                    } catch (error) {
                        if (!await comments.getScreenshot(PUBLIC_PROJECT_PARTITION, comment.id))
                            throw error;
                    }
                }
            }
            await createIfMissing(comments, migrated);
        }
        await app.create<AppDoc>({ id: migrationId, pk: project.pk, type: 'migration', ttl: -1 });
    }
    for (const comment of starterComments()) {
        if (!await comments.get(comment.domain, comment.id)) {
            comment.number = await comments.nextCommentNumber(comment.domain);
            await createIfMissing(comments, comment);
        }
    }
    return project;
}

let provisioned: Promise<DbProject> | undefined;

export function ensurePublicProject() {
    // This project disables Vercel system envs; the deploy workflow inlines UIER_DEPLOYMENT_ENV.
    const deployment = process.env.UIER_DEPLOYMENT_ENV || process.env.VERCEL_ENV;
    return provisioned ??= provisionPublicProject(getAppStore(), getCommentsStore(), deployment === 'production' ? brand.domain : undefined)
        .catch(error => { provisioned = undefined; throw error; });
}
