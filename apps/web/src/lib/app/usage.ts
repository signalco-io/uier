import { headers } from 'next/headers';
import type { DbProject, DbWorkspace } from './model';
import type { AppContext } from './context';
import { getVisibleProject, listVisibleProjects } from './projects';
import { getCommentsStore } from '../repo/commentsStore';
import { projectPartition } from '../review/comments';
import { RATE_LIMIT_PAGE_COMMENTS } from '../comments/limits';
import { isUierFeedbackProject } from '../comments/publicProjectPolicy';
import {
    APP_COUNTERS_PARTITION,
    authorCommentsLimit,
    authorRepliesLimit,
    authorRewritesLimit,
    limitWindow,
    networkRewritesLimit,
    networkWritesLimit,
    rateLimitIpBucket,
    siteRewritesLimit,
    siteScreenshotsLimit,
    usedOf,
    type Limit
} from '../comments/rateLimits';

/** One limit and how much of it the current window used */
export type UsageMeter = {
    label: string;
    /** What the label alone does not say */
    description?: string;
    used: number;
    limit: number;
};

export type ProjectUsage = { project: DbProject; meters: UsageMeter[] };

async function meter(partition: string, limit: Limit, label: string, description?: string): Promise<UsageMeter> {
    const { used } = await usedOf(getCommentsStore(), partition, limit);
    return { label, ...(description ? { description } : {}), used, limit: limit.limit };
}

/** Seconds until the hourly limits start again (they share one fixed window: the top of the hour) */
export const hourlyResetSeconds = () => limitWindow(authorCommentsLimit('')).resetsInSeconds;
/** Seconds until the daily limits start again (midnight UTC) */
export const dailyResetSeconds = () => limitWindow(siteScreenshotsLimit).resetsInSeconds;

export const pageCommentsPerDay = RATE_LIMIT_PAGE_COMMENTS;

/**
 * The network of this page's request (its IP address, or IPv6 /64), as the APIs bucket it. The
 * toolbar's requests come from the same browser, so they usually count in the same bucket.
 */
async function requestIpBucket() {
    return rateLimitIpBucket({ headers: await headers() });
}

/**
 * The person's own hourly limits in a project, counted the way the APIs count them. Members get the member
 * limits in their projects. uier's own feedback project is the exception: the toolbar on uier's pages writes
 * through the anonymous comments API, which keeps the visitor and IP limits for every writer, staff included,
 * except that a signed-in account gets more new comments.
 */
async function personalProjectUsage(project: DbProject, userId: string, ipBucket: string | undefined): Promise<UsageMeter[]> {
    const authorId = `user:${userId}`;
    const member = !isUierFeedbackProject(project.id);
    const partition = projectPartition(project.id);
    return await Promise.all([
        meter(partition, authorCommentsLimit(authorId, member, !member), 'New comments'),
        meter(partition, authorRepliesLimit(authorId, member), 'Replies', 'Yours, and those your coding agents write for you'),
        meter(partition, authorRewritesLimit(authorId), 'Rewrite suggestions'),
        // Members are not counted by address
        ...(!member && ipBucket ? [meter(partition, networkWritesLimit(ipBucket), 'From your network',
            'New comments and replies from everyone on your internet connection')] : [])
    ]);
}

/** The person's workspaces with the projects they can see in each; the open workspace first */
async function workspacesWithProjects(context: AppContext) {
    const memberships = [...context.memberships].sort((a, b) =>
        Number(b.workspace.id === context.workspace.id) - Number(a.workspace.id === context.workspace.id));
    return await Promise.all(memberships.map(async ({ workspace, member }) => {
        const scoped: AppContext = { ...context, workspace, member, isAdmin: member.role === 'admin' };
        return { workspace, projects: await listVisibleProjects(scoped) };
    }));
}

export type AccountUsage = {
    workspaces: { workspace: DbWorkspace; projects: ProjectUsage[] }[];
    /** Rewrite suggestions from the person's network on every site; missing when addresses are not counted */
    network?: UsageMeter;
};

/** What the account's Usage page shows: the person's limits in every project they can see, in all their workspaces */
export async function accountUsage(context: AppContext): Promise<AccountUsage> {
    const ipBucket = await requestIpBucket();
    const [workspaces, network] = await Promise.all([
        workspacesWithProjects(context),
        ipBucket ? meter(APP_COUNTERS_PARTITION, networkRewritesLimit(ipBucket), 'Rewrite suggestions from your network',
            'On every site, from everyone on your internet connection') : undefined
    ]);
    return {
        workspaces: (await Promise.all(workspaces.map(async ({ workspace, projects }) => ({
            workspace,
            projects: await Promise.all(projects.map(async project => ({ project, meters: await personalProjectUsage(project, context.user.id, ipBucket) })))
        })))).filter(({ projects }) => projects.length > 0),
        ...(network ? { network } : {})
    };
}

/** What a whole project shares in a day, whoever sends it */
export async function sharedProjectUsage(project: DbProject): Promise<UsageMeter[]> {
    const partition = projectPartition(project.id);
    return await Promise.all([
        meter(partition, siteScreenshotsLimit, 'Screenshots', 'New comments past the limit are saved without one'),
        meter(partition, siteRewritesLimit, 'Rewrite suggestions')
    ]);
}

/**
 * The project a usage link names (`?project=<public id>`) when it is not in the open workspace but in
 * another of the person's workspaces, so the page can offer to open that workspace
 */
export async function projectInOtherWorkspace(context: AppContext, code: string) {
    for (const { workspace, member } of context.memberships) {
        if (workspace.id === context.workspace.id)
            continue;
        const project = await getVisibleProject({ ...context, workspace, member, isAdmin: member.role === 'admin' }, code);
        if (project)
            return { workspace, project };
    }
    return null;
}
