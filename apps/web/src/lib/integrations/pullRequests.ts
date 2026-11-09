import { memberId, workspacePk, type DbMember, type DbProject } from '../app/model';
import { getAppStore } from '../app/store';
import { apiErrors } from '../comments/http';
import { isLocalRuntime } from '../comments/environment';
import { threadPullRequestLinks, type PullRequestLink, type PullRequestState, type PullRequestStatus } from '../comments/pullRequestLinks';
import { memberActor } from '../review/actor';
import { getProjectComment } from '../review/comments';
import { getIntegrationConnection } from './connection';
import type { IntegrationConnection } from './model';
import { cachedPullRequestState, PullRequestReadError } from './pullRequestCache';
import { githubConfig, GitHubError, GITHUB_API_VERSION } from './github/config';
import { mintGitHubPullRequestToken } from './github/client';
import { githubInstallationPk, type GitHubConnection, type GitHubInstallation } from './github/model';
import { githubAppPk, type GitHubUserAccess } from './github/webhook';
import { azureDevOpsAccessToken, currentAzureDevOpsGrant } from './azure-devops/connection';
import { azureDevOpsUrl } from './azure-devops/client';
import type { AzureDevOpsConnection } from './azure-devops/model';
import { hasAzureDevOpsCodeRead, isAzureDevOpsConfigured } from './azure-devops/config';

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const signal = () => AbortSignal.timeout(5000);

/** Only fixed provider APIs. A loopback stand-in is allowed solely in local development/tests. */
function publicBase(provider: 'github' | 'gitlab') {
    const standIn = isLocalRuntime() && process.env.UIER_PULL_REQUEST_TEST_API_URL;
    if (standIn) {
        const url = new URL(standIn);
        if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
            || url.username || url.password || url.search || url.hash) throw new Error('Invalid pull request test API');
        return `${url.href.replace(/\/$/, '')}/${provider}`;
    }
    return provider === 'github' ? 'https://api.github.com' : 'https://gitlab.com/api/v4';
}

/** Bounded JSON, manual redirects, no browser credentials; only 429/rate-limit responses pause the bucket. */
async function readJson(url: string, token?: string): Promise<unknown> {
    const response = await fetch(url, { redirect: 'error', cache: 'no-store', signal: signal(), headers: {
        Accept: 'application/json', 'User-Agent': 'uier-pull-requests', 'X-GitHub-Api-Version': GITHUB_API_VERSION,
        ...(token ? { Authorization: `Bearer ${token}` } : {})
    } });
    if (response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))) {
        await response.body?.cancel();
        const now = Date.now();
        const after = response.headers.get('retry-after') ?? '';
        const retry = /^\d+$/.test(after) ? now + Number(after) * 1000 : Date.parse(after);
        const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
        throw new PullRequestReadError(Math.min(now + 86400_000, Math.max(now + 15 * 60_000, retry || 0, reset || 0)));
    }
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('application/json')) { await response.body?.cancel(); return; }
    const reader = response.body?.getReader();
    if (!reader) return;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 512 * 1024) { await reader.cancel(); return; }
            chunks.push(value);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } finally { reader.releaseLock(); }
}

export function pullRequestState(provider: PullRequestLink['provider'], body: unknown, number: number): PullRequestState | undefined {
    if (!object(body)) return;
    if (provider === 'github') {
        if (body.number !== number || (body.state !== 'open' && body.state !== 'closed') || typeof body.merged !== 'boolean') return;
        return body.merged ? 'merged' : body.state === 'closed' ? 'closed' : body.draft === true ? 'draft' : 'open';
    }
    if (provider === 'gitlab') {
        if (body.iid !== number) return;
        return body.state === 'merged' ? 'merged' : body.state === 'closed' ? 'closed'
            : body.state === 'opened' ? body.draft === true || body.work_in_progress === true ? 'draft' : 'open' : undefined;
    }
    if (body.pullRequestId !== number) return;
    return body.status === 'completed' ? 'merged' : body.status === 'abandoned' ? 'closed'
        : body.status === 'active' ? body.isDraft === true ? 'draft' : 'open' : undefined;
}

/** Recheck the binding and its connecting admin even for cached private state. */
async function connectionAuthority(project: DbProject, connection: IntegrationConnection) {
    const store = getAppStore();
    const current = (await store.get<DbProject>(project.pk, project.id))?.doc;
    const bound = current?.type === 'project' && current.workspaceId === project.workspaceId
        ? await getIntegrationConnection(current, connection.provider) : null;
    const admin = bound && (await store.get<DbMember>(project.pk, memberId(bound.connectedBy)))?.doc;
    return Boolean(bound && bound.id === connection.id && bound.destinationRevision === connection.destinationRevision
        && bound.updatedAt === connection.updatedAt && bound.status === 'connected'
        && (!bound.pausedUntil || Date.parse(bound.pausedUntil) <= Date.now()) && admin?.type === 'member' && admin.role === 'admin'
        && admin.workspaceId === project.workspaceId);
}

async function privateReader(project: DbProject, ref: PullRequestLink, sourceAuthority: () => Promise<boolean>) {
    if (ref.provider === 'gitlab') return;
    const connection = await getIntegrationConnection(project, ref.provider);
    if (!connection || !await connectionAuthority(project, connection)) return;
    if (ref.provider === 'github') {
        const github = connection as GitHubConnection;
        if (`${github.config.owner}/${github.config.name}`.toLowerCase() !== ref.repository.toLowerCase()) return;
        const config = githubConfig();
        const authorize = async () => {
            if (!await sourceAuthority() || !await connectionAuthority(project, github)) return false;
            const installation = (await getAppStore().get<GitHubInstallation>(githubInstallationPk(config.appId, github.config.installationId), 'installation'))?.doc;
            const revoked = (await getAppStore().get<GitHubUserAccess>(githubAppPk(config.appId), `user_${github.config.authorizedGitHubUserId}`))?.doc;
            return installation?.type === 'github-installation' && installation.appId === config.appId && installation.status === 'connected'
                && !installation.deniedRepositories.includes(github.config.repositoryId)
                && (!installation.pausedUntil || Date.parse(installation.pausedUntil) <= Date.now())
                && !(revoked && Date.parse(revoked.revokedAt) >= Date.parse(github.config.authorizedAt));
        };
        if (!await authorize()) return;
        return { scope: `${project.workspaceId}:${project.id}:${github.id}:${github.destinationRevision}:${github.updatedAt}`,
            bucket: `github:${config.appId}:${github.config.installationId}`, authorize,
            read: async () => {
                if (!await authorize()) return;
                let token: string;
                try { token = await mintGitHubPullRequestToken(github.config.installationId, github.config.repositoryId, signal()); }
                catch (error) {
                    if (error instanceof GitHubError && error.code === 'rate_limited') throw new PullRequestReadError(Date.parse(error.retryAt ?? '') || undefined);
                    throw error;
                }
                if (!await authorize()) return;
                return pullRequestState('github', await readJson(`${config.apiBase}/repos/${ref.repository}/pulls/${ref.number}`, token), ref.number);
            } };
    }
    const azure = connection as AzureDevOpsConnection;
    if (!isAzureDevOpsConfigured()) return;
    if (typeof azure.config.organization !== 'string' || typeof azure.config.projectName !== 'string'
        || azure.config.organization.toLowerCase() !== ref.organization?.toLowerCase()
        || ![azure.config.projectId, azure.config.projectName].some(value => typeof value === 'string' && value.toLowerCase() === ref.project?.toLowerCase())) return;
    const grant = await currentAzureDevOpsGrant(azure);
    if (grant.status !== 'connected' || !hasAzureDevOpsCodeRead(grant.scopes)) return;
    const authorize = async () => await sourceAuthority() && await connectionAuthority(project, azure)
        && (await currentAzureDevOpsGrant(azure)).status === 'connected';
    return { scope: `${project.workspaceId}:${project.id}:${azure.id}:${azure.destinationRevision}:${azure.updatedAt}:${grant.generation}`,
        bucket: `azure:${azure.id}`, authorize,
        read: async () => {
            if (!await authorize()) return;
            const token = await azureDevOpsAccessToken(azure, send => send(signal()));
            if (!await authorize()) return;
            const url = azureDevOpsUrl(ref.organization!, `${encodeURIComponent(azure.config.projectId as string)}/_apis/git/repositories/${encodeURIComponent(ref.repository)}/pullrequests/${ref.number}`);
            return pullRequestState('azure-devops', await readJson(url, token), ref.number);
        } };
}

type StateRead = { state?: PullRequestState; authorize?: () => Promise<boolean> };
async function stateFor(project: DbProject, ref: PullRequestLink, sourceAuthority: () => Promise<boolean>): Promise<StateRead> {
    try {
        const reader = await privateReader(project, ref, sourceAuthority);
        if (reader) {
            const state = await cachedPullRequestState({ ...reader, url: ref.url, hourlyLimit: 120 });
            if (state && await reader.authorize()) return { state, authorize: reader.authorize };
        }
    } catch { /* Missing configuration, consent or provider access leaves the public fallback available. */ }
    if (ref.provider === 'azure-devops') return {};
    const provider = ref.provider;
    const state = await cachedPullRequestState({ scope: `public:${provider}`, bucket: `public:${provider}`, url: ref.url,
        hourlyLimit: provider === 'github' ? 40 : 120,
        read: async () => {
            if (!await sourceAuthority()) return;
            const path = provider === 'github' ? `/repos/${ref.repository}/pulls/${ref.number}`
                : `/projects/${encodeURIComponent(ref.repository)}/merge_requests/${ref.number}`;
            return pullRequestState(provider, await readJson(`${publicBase(provider)}${path}`), ref.number);
        } });
    return { state };
}

async function visibleThread(workspaceId: string, projectId: string, userId: string, commentId: string) {
    const project = (await getAppStore().get<DbProject>(workspacePk(workspaceId), projectId))?.doc;
    if (project?.type !== 'project' || project.workspaceId !== workspaceId || project.status !== 'active') throw apiErrors.notFound();
    const actor = await memberActor(project, userId);
    if (!actor) throw apiErrors.notFound();
    const comment = await getProjectComment(project, actor, commentId);
    if (!comment) throw apiErrors.notFound();
    return { project, refs: threadPullRequestLinks(comment.thread?.items ?? []) };
}

/** Only saved, currently visible messages can initiate reads. No URL is accepted from a client. */
export async function loadThreadPullRequests(workspaceId: string, projectId: string, userId: string, commentId: string): Promise<PullRequestStatus[]> {
    const { project, refs } = await visibleThread(workspaceId, projectId, userId, commentId);
    const states = new Map<string, StateRead>();
    // Bound work on one view; all links are shown, at most twenty receive a state read, three at a time.
    for (let offset = 0; offset < Math.min(refs.length, 20); offset += 3) {
        await Promise.all(refs.slice(offset, Math.min(offset + 3, 20)).map(async ref => {
            const sourceAuthority = async () => {
                try { return (await visibleThread(workspaceId, projectId, userId, commentId)).refs.some(current => current.url === ref.url); }
                catch { return false; }
            };
            try { states.set(ref.url, await stateFor(project, ref, sourceAuthority)); } catch { /* Plain link on failure. */ }
        }));
    }
    const current = await visibleThread(workspaceId, projectId, userId, commentId);
    // Edits, deletion, revoked membership and private visibility changes during the read take effect before the response.
    return Promise.all(current.refs.map(async ref => {
        const result = states.get(ref.url);
        return { url: ref.url, state: !result?.authorize || await result.authorize() ? result?.state : undefined };
    }));
}
