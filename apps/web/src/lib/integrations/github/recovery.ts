import { randomUUID } from 'node:crypto';
import { getAppStore, updateDoc, type AppStore } from '../../app/store';
import { getIntegrationConnection } from '../connection';
import type { IntegrationSync } from '../model';
import { memberId, type DbMember } from '../../app/model';
import { githubAppPk, type GitHubUserAccess } from './webhook';
import { githubAdmin, type GitHubActorInput } from './connection';
import { githubRequest, mintGitHubInstallationToken } from './client';
import { GitHubError, githubConfig, githubId, githubRepositoryPath } from './config';
import { ownsGitHubContent } from './issue';
import { githubInstallationPk, type GitHubComment, type GitHubConnection, type GitHubInstallation, type GitHubIssue, type GitHubState } from './model';

/** A human recovery decision for one exact uncertain POST; normal retry never calls this. */
export async function resolveGitHubCreate(input: GitHubActorInput & { ledgerId: string; operationId: string;
    confirmAbsent?: boolean; issueNumber?: number; commentId?: string }, store: AppStore = getAppStore()) {
    const project = await githubAdmin(input, store);
    const connection = await getIntegrationConnection(project, 'github', store) as GitHubConnection | null;
    if (!connection || !connection.enabled || connection.status !== 'connected' || !/^github_[a-f0-9]{64}$/.test(input.ledgerId)) throw new GitHubError('recovery_unavailable');
    async function verifyBinding() {
        const currentProject = await githubAdmin(input, store);
        const current = await getIntegrationConnection(currentProject, 'github', store);
        const originalAdmin = current ? (await store.get<DbMember>(project.pk, memberId(current.connectedBy)))?.doc : null;
        if (!current || current.id !== connection!.id || current.destinationRevision !== connection!.destinationRevision
            || current.connectedBy !== connection!.connectedBy || !current.enabled || current.status !== 'connected'
            || originalAdmin?.role !== 'admin' || originalAdmin.userId !== current.connectedBy) throw new GitHubError('recovery_changed');
    }
    await verifyBinding();
    const stored = await store.get<IntegrationSync>(`github:${project.id}`, input.ledgerId);
    const state = structuredClone(stored?.doc.state ?? {}) as unknown as GitHubState;
    const retained = [state.active, ...(state.retired ?? [])].flatMap(destination => destination?.uncertainCreates ?? [])
        .find(attempt => attempt.operationId === input.operationId);
    const attempt = stored?.doc.attempt?.operationId === input.operationId ? stored.doc.attempt : retained;
    if (!stored || stored.doc.connectionId !== connection.id || stored.doc.workspaceId !== project.workspaceId || stored.doc.projectId !== project.id
        || !attempt || attempt.operationId !== input.operationId || attempt.repeatable || !['create_issue', 'create_comment'].includes(attempt.step)
        || (stored.doc.lease && Date.parse(stored.doc.lease.until) > Date.now())) throw new GitHubError('recovery_changed');
    const destination = [state.active, ...(state.retired ?? [])].find(row => row?.revision === attempt.metadata.revision);
    if (!destination) throw new GitHubError('recovery_changed');
    const lease = { id: randomUUID(), until: new Date(Date.now() + 120_000).toISOString() };
    if (await store.replace({ ...stored.doc, lease }, stored.etag) !== 'ok') throw new GitHubError('recovery_changed');
    try {
        if (input.confirmAbsent !== true) {
            await verifyBinding();
            const config = githubConfig();
            const installation = (await store.get<GitHubInstallation>(githubInstallationPk(config.appId, destination.installationId), 'installation'))?.doc;
            if (!installation || installation.status !== 'connected' || installation.deniedRepositories.includes(destination.repositoryId)) throw new GitHubError('installation_unavailable');
            const revoked = (await store.get<GitHubUserAccess>(githubAppPk(config.appId), `user_${githubId(destination.authorizedGitHubUserId)}`))?.doc;
            if (revoked && Date.parse(revoked.revokedAt) >= Date.parse(destination.authorizedAt)) throw new GitHubError('authorization_revoked');
            const token = await mintGitHubInstallationToken(destination.installationId, destination.repositoryId);
            await verifyBinding();
            const base = githubRepositoryPath(destination.owner, destination.name);
            if (attempt.step === 'create_issue') {
                if (!Number.isSafeInteger(input.issueNumber) || input.issueNumber! <= 0) throw new GitHubError('invalid_issue');
                const issue = await githubRequest<GitHubIssue>(`${base}/issues/${input.issueNumber}`, token.token);
                if (issue.pull_request || !ownsGitHubContent(issue.body, destination.marker, issue.user, destination.botId)) throw new GitHubError('ownership_changed');
                destination.issue = { id: githubId(issue.id), number: issue.number, url: `https://github.com/${destination.owner}/${destination.name}/issues/${issue.number}` };
            } else {
                const itemId = attempt.metadata.itemId, marker = attempt.metadata.marker;
                if (!destination.issue || typeof itemId !== 'string' || typeof marker !== 'string') throw new GitHubError('invalid_attempt');
                const comment = await githubRequest<GitHubComment>(`${base}/issues/comments/${githubId(input.commentId)}`, token.token);
                if (!ownsGitHubContent(comment.body, marker, comment.user, destination.botId) || !comment.issue_url
                    || new URL(comment.issue_url).origin !== 'https://api.github.com' || new URL(comment.issue_url).pathname !== `${base}/issues/${destination.issue.number}`)
                    throw new GitHubError('ownership_changed');
                destination.items[itemId] = { id: githubId(comment.id), marker, hash: '' };
            }
        }
        delete destination.scan;
        destination.uncertainCreates = destination.uncertainCreates?.filter(receipt => receipt.operationId !== input.operationId);
        if (input.confirmAbsent !== true) destination.cleaned = false;
        await verifyBinding();
        await updateDoc<IntegrationSync>(stored.doc.pk, stored.doc.id, row => {
            const currentState = row.state as unknown as GitHubState;
            const currentReceipt = [currentState.active, ...(currentState.retired ?? [])].some(value => value?.uncertainCreates?.some(receipt => receipt.operationId === input.operationId));
            if (row.lease?.id !== lease.id || Date.parse(row.lease.until) <= Date.now()
                || (row.attempt?.operationId !== input.operationId && !currentReceipt)) throw new GitHubError('recovery_changed');
            return { ...row, state: { ...state, recovery: { operationId: input.operationId, confirmedAbsent: input.confirmAbsent === true,
                by: input.userId, at: new Date().toISOString() } }, attempt: row.attempt?.operationId === input.operationId ? undefined : row.attempt, lease: undefined,
                status: 'queued', active: true, failures: 0, nextAttemptAt: new Date().toISOString() };
        }, store);
        return { status: 'queued' as const };
    } catch (error) {
        await updateDoc<IntegrationSync>(stored.doc.pk, stored.doc.id, row => row.lease?.id !== lease.id ? row : ({ ...row, lease: undefined }), store);
        throw error;
    }
}
