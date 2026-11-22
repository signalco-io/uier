import { feedbackSource } from '../app/environments';
import { userPk, type DbProject, type DbUser } from '../app/model';
import { getAppStore, updateDoc, type AppStore } from '../app/store';
import { sha256Hex } from '../app/tokens';
import type { DbComment, DbReviewRelease } from '../db/schema';
import type { CommentsStore } from '../repo/commentsStore';
import { getCommentReviewRelease, reviewReleaseId } from '../review/reviewSessionRelease';
import { getIntegrationConnection } from './connection';
import { integrationProviders, type IntegrationAdapter, type IntegrationConnection, type IntegrationProviderId, type IntegrationSync, type ReviewGroupProjection } from './model';

export function groupReviewSessions(connection: IntegrationConnection) {
    return typeof connection.config.groupSessions === 'boolean' ? connection.config.groupSessions
        : connection.provider !== 'slack' || !connection.replySync?.enabled;
}

export function notionReviewSessionProperty(connection: IntegrationConnection) {
    const mapping = connection.config.mapping as { reviewSession?: { property?: unknown } } | undefined;
    return typeof mapping?.reviewSession?.property === 'string' && mapping.reviewSession.property !== '';
}

export async function canStartReviewSessions(project: DbProject, store = getAppStore()) {
    const connection = await getIntegrationConnection(project, 'notion', store);
    return !connection?.enabled || !groupReviewSessions(connection) || notionReviewSessionProperty(connection);
}

function destinationCutoff(project: DbProject, connection: IntegrationConnection) {
    return connection.provider === 'slack' && typeof connection.config.since === 'string'
        ? connection.config.since : project.integrations?.[connection.provider]?.since;
}

function reviewDestination(project: DbProject, connection: IntegrationConnection) {
    const config = connection.config;
    const parts = {
        slack: [config.teamId, config.channelId],
        github: [config.installationId, config.repositoryId],
        linear: [config.organizationId, config.teamId, config.projectId],
        'azure-devops': [config.organizationId, config.projectId, config.workItemType],
        notion: [config.notionWorkspaceId, config.dataSourceId]
    }[connection.provider];
    return sha256Hex(JSON.stringify([destinationCutoff(project, connection), ...parts]));
}

export async function snapshotReviewGroups(project: DbProject, store = getAppStore()) {
    const result: Partial<Record<IntegrationProviderId, { connectionId: string; destination: string; grouped: boolean }>> = {};
    await Promise.all(integrationProviders.map(async provider => {
        const connection = await getIntegrationConnection(project, provider, store);
        if (connection) result[provider] = { connectionId: connection.id, destination: reviewDestination(project, connection),
            grouped: groupReviewSessions(connection) };
    }));
    return result;
}

export function reviewGroupIdentity(project: DbProject, connection: IntegrationConnection, sessionId: string) {
    return reviewGroupIdentityForDestination(connection, sessionId, reviewDestination(project, connection));
}

export function reviewGroupIdentityForDestination(connection: IntegrationConnection, sessionId: string, destination: string) {
    const { provider, projectId } = connection;
    return { pk: `${provider}:${projectId}`, id: `${provider}_${sha256Hex(JSON.stringify([connection.id, projectId, sessionId, destination]))}` };
}

export function reviewSessionLink(project: DbProject, sessionId: string, baseUrl: string) {
    const url = new URL(`/app/projects/${encodeURIComponent(project.publicId ?? project.id)}`, baseUrl);
    url.searchParams.set('reviewSessionId', sessionId);
    url.searchParams.set('status', 'all');
    return url.href;
}

export const reviewGroupTitle = (group: ReviewGroupProjection) => group.title || `Review ${group.number} by ${group.author}`;

export async function registerReviewGroup(project: DbProject, connection: IntegrationConnection, source: DbComment,
    store: AppStore, comments: CommentsStore, options: { historical?: boolean; now: number }) {
    if (!source.reviewSession) return null;
    const release = await getCommentReviewRelease(source, comments);
    if (!release) return null;
    const destination = reviewDestination(project, connection);
    const identity = reviewGroupIdentity(project, connection, release.sessionId);
    const { pk, id } = identity;
    const current = (await store.get<IntegrationSync>(pk, id))?.doc;
    const previous = current?.reviewGroup;
    const cutoff = destinationCutoff(project, connection);
    const snapshot = release.integrationGroups?.[connection.provider];
    // When a destination changed, older revisions require an explicit backfill.
    if (!previous?.threadIds.includes(source.id) && !options.historical && cutoff && release.submittedAt < cutoff) return { route: undefined, release };
    const grouped = previous?.grouped ?? (snapshot?.connectionId === connection.id && snapshot.destination === destination
        ? snapshot.grouped : groupReviewSessions(connection));
    if (grouped && connection.provider === 'notion' && !notionReviewSessionProperty(connection)) return { route: undefined, release, waiting: true };
    if (previous?.threadIds.includes(source.id) && previous.destinationRevision === connection.destinationRevision) return { route: current, release };
    const routesToParent = grouped && connection.provider !== 'notion';
    const sourceIds = options.historical ? [source.id] : release.threadIds;
    const next: IntegrationSync = {
        ...identity, type: `${connection.provider}-session-sync`, provider: connection.provider,
        workspaceId: project.workspaceId, projectId: project.id, connectionId: connection.id, threadId: release.sessionId,
        requestedVersion: 1, processedVersion: 0, requestRevision: 1, processedRequestRevision: 0,
        tombstoned: false, active: routesToParent, failures: 0, nextAttemptAt: new Date(options.now).toISOString(),
        status: routesToParent ? 'queued' : 'accepted', state: {},
        reviewGroup: { destination, destinationRevision: connection.destinationRevision, grouped, threadIds: sourceIds }
    };
    const route = await store.create(next) ? next : await updateDoc<IntegrationSync>(pk, id, row => {
        if (!row.reviewGroup || row.workspaceId !== project.workspaceId || row.connectionId !== connection.id) throw new Error('Review group identity mismatch');
        const threadIds = [...new Set([...row.reviewGroup.threadIds, ...sourceIds])];
        if (threadIds.length === row.reviewGroup.threadIds.length && row.reviewGroup.destinationRevision === connection.destinationRevision) return row;
        const active = row.reviewGroup.grouped && connection.provider !== 'notion' && !['failed', 'ambiguous'].includes(row.status);
        return { ...row, reviewGroup: { ...row.reviewGroup, destinationRevision: connection.destinationRevision, threadIds }, requestedVersion: row.requestedVersion + 1,
            active, ...(active ? { nextAttemptAt: next.nextAttemptAt } : {}) };
    }, store);
    if (!route) throw new Error('Review group disappeared during delivery');
    return { route, release };
}

export async function wakeReviewGroup(child: IntegrationSync, store: AppStore, now: number, groupId = child.reviewGroupId) {
    if (!groupId) return;
    await updateDoc<IntegrationSync>(child.pk, groupId, row => {
        if (!row.reviewGroup?.grouped || row.provider === 'notion' || ['failed', 'ambiguous'].includes(row.status)) return row;
        return { ...row, requestedVersion: row.requestedVersion + 1, active: true, nextAttemptAt: new Date(now).toISOString() };
    }, store);
}

export async function projectReviewGroup(ledger: IntegrationSync, connection: IntegrationConnection, project: DbProject,
    adapter: IntegrationAdapter, store: AppStore, comments: CommentsStore, baseUrl: string) {
    if (!ledger.reviewGroup?.grouped || ledger.reviewGroup.destination !== reviewDestination(project, connection)) return null;
    const partition = `project:${project.id}`;
    const ids = new Set(ledger.reviewGroup.threadIds);
    if (!ids.size) return null;
    const parameters = [...ids].map((id, index) => ({ name: `@qReviewId${index}`, value: id }));
    const children = await comments.queryCandidates(partition, {
        includeText: false,
        maxCandidates: ids.size,
        predicate: { clause: `c.id IN (${parameters.map(parameter => parameter.name).join(', ')})`,
            parameters, test: candidate => ids.has(candidate.id) }
    });
    const shared = children.filter(child => child.projectId === project.id && !child.private && child.reviewSession?.id === ledger.threadId);
    const revisions = [...new Set(shared.map(child => child.reviewSession!.revision))];
    const releases = new Map(await Promise.all(revisions.map(async revision => [revision,
        (await comments.reviewSessionRecord<DbReviewRelease>(partition, reviewReleaseId(ledger.threadId, revision)))?.doc] as const)));
    const visible = shared.flatMap(child => {
        const release = releases.get(child.reviewSession!.revision);
        return release?.type === 'review-release' && release.threadIds.includes(child.id) ? [{ child, release }] : [];
    });
    if (!visible.length) return null;
    const latest = visible.reduce((newest, row) => row.release.revision > newest.release.revision ? row : newest);
    const { release } = latest;
    const member = release.authorId.startsWith('user:') ? release.authorId.slice(5) : undefined;
    const author = (member ? (await store.get<DbUser>(userPk(member), member))?.doc.name : release.authorName) || (member ? 'Former member' : 'Guest');
    const complete = visible.length === ids.size && visible.length === release.threadCount
        && release.threadIds.every(id => visible.some(({ child }) => child.id === id));
    const links: string[] = [];
    if (connection.provider === 'github' && adapter.externalLink && adapter.validateExternalLink) {
        const found = await Promise.all(visible.map(async ({ child }) => {
            const id = `${connection.provider}_${sha256Hex(`${connection.id}:${project.id}:${child.id}`)}`;
            const sync = (await store.get<IntegrationSync>(ledger.pk, id))?.doc;
            if (!sync?.reviewGroupFallback || sync.reviewGroupId !== ledger.id) return undefined;
            const raw = adapter.externalLink!(connection, sync);
            if (!raw) return undefined;
            const url = new URL(raw);
            return adapter.validateExternalLink!(url, connection, sync) ? url.href : undefined;
        }));
        links.push(...found.filter(link => link !== undefined));
    }
    const kinds = new Map<string, ReviewGroupProjection['kinds'][number]>();
    const environments = new Set<string>();
    for (const { child } of visible) {
        const kind = child.kind ?? 'comment';
        const label = kind.startsWith('custom_') ? child.feedbackType?.label : undefined;
        const key = label ?? kind;
        const tally = kinds.get(key);
        if (tally) tally.count++;
        else kinds.set(key, { kind, customLabel: label, count: 1 });
        const environment = feedbackSource(project, child.origin);
        if (environment.available) environments.add(environment.label);
    }
    const projection: ReviewGroupProjection = {
        number: release.number, author, ...(complete ? { title: release.title, summary: release.summary } : {}),
        url: reviewSessionLink(project, ledger.threadId, baseUrl), threads: visible.length,
        done: visible.filter(({ child }) => child.resolved).length, pages: new Set(visible.map(({ child }) => child.path)).size,
        environments: [...environments].sort(), kinds: [...kinds.values()].sort((a, b) => (a.customLabel ?? a.kind).localeCompare(b.customLabel ?? b.kind)),
        links: links.sort()
    };
    return { projection, submittedAt: release.submittedAt, hash: sha256Hex(JSON.stringify(projection)) };
}

export function reviewGroupFeedback(ledger: IntegrationSync, group: ReviewGroupProjection, submittedAt: string): import('@uier/toolbar/feedback-context').FeedbackExport {
    return {
        markdown: '',
        context: {
            schemaVersion: 1, contentTrust: 'untrusted', identity: { commentId: ledger.threadId },
            kind: 'comment', title: reviewGroupTitle(group), status: group.done === group.threads ? 'done' : 'open',
            feedback: { id: ledger.threadId, deleted: false, text: group.summary, authorName: group.author, createdAt: submittedAt },
            anchor: { type: 'page' }, source: { path: '' }, links: { comment: group.url }, reproduction: {},
            screenshot: { state: 'unavailable' }, discussion: [], notes: []
        }
    };
}
