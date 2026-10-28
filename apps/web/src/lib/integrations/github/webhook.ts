import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AppDoc } from '../../app/model';
import { getAppStore, updateDoc, type AppStore } from '../../app/store';
import { sha256Hex } from '../../app/tokens';
import { githubConfig, githubId } from './config';
import { githubInstallationPk, type GitHubInstallation } from './model';

type GitHubEvent = AppDoc & { type: 'github-event'; event: string; action: string; installationId?: string;
    repositoryIds: string[]; userId?: string; receivedAt: string; processed: boolean; processedAt?: string };
export const githubAppPk = (appId: string) => `github-app:${appId}`;
export type GitHubUserAccess = AppDoc & { type: 'github-user-access'; revokedAt: string };

async function applyEvent(event: GitHubEvent, store: AppStore) {
    const { appId } = githubConfig();
    if (event.event === 'github_app_authorization' && event.action === 'revoked' && event.userId) {
        const next: GitHubUserAccess = { type: 'github-user-access', pk: githubAppPk(appId), id: `user_${event.userId}`, revokedAt: event.receivedAt };
        if (!await store.create(next)) await updateDoc<GitHubUserAccess>(next.pk, next.id, current => Date.parse(current.revokedAt) > Date.parse(next.revokedAt) ? current : next, store);
    } else if (event.installationId) {
        const pk = githubInstallationPk(appId, event.installationId);
        const next: GitHubInstallation = { type: 'github-installation', pk, id: 'installation', appId,
            installationId: event.installationId, status: event.action === 'deleted' ? 'deleted' : event.action === 'created' ? 'connected' : 'suspended', deniedRepositories: [], updatedAt: event.receivedAt };
        await store.create(next);
        await updateDoc<GitHubInstallation>(pk, 'installation', current => {
            if (current.type !== 'github-installation' || current.appId !== appId || current.installationId !== event.installationId) throw new Error('GitHub installation mismatch');
            if (event.event === 'installation_repositories') {
                const denied = new Set(current.deniedRepositories);
                if (event.action === 'removed') event.repositoryIds.forEach(id => denied.add(id));
                // An added repository still needs an explicit verified setup before a paused binding resumes.
                return { ...current, deniedRepositories: [...denied].slice(0, 5000), updatedAt: event.receivedAt };
            }
            // Never resurrect an installation from delayed created/unsuspended events. OAuth + live access verification does that.
            return event.action === 'deleted' || event.action === 'suspend' || event.action === 'suspended'
                ? { ...current, status: event.action === 'deleted' ? 'deleted' : current.status === 'deleted' ? 'deleted' : 'suspended', updatedAt: event.receivedAt }
                : current;
        }, store);
    }
    await updateDoc<GitHubEvent>(event.pk, event.id, current => ({ ...current, processed: true, processedAt: new Date().toISOString() }), store);
}

/** Signature-checked lifecycle signals only; no feedback or issue content is stored or applied. */
export async function receiveGitHubWebhook(rawBody: string, headers: Headers, store: AppStore = getAppStore()) {
    let config: ReturnType<typeof githubConfig>;
    try { config = githubConfig(); } catch { return { status: 503 }; }
    const signature = headers.get('x-hub-signature-256');
    const delivery = headers.get('x-github-delivery');
    const event = headers.get('x-github-event');
    if (Buffer.byteLength(rawBody) > 1024 * 1024 || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)
        || !delivery || !/^[a-f0-9-]{36}$/i.test(delivery)) return { status: 400 };
    const expected = createHmac('sha256', config.webhookSecret).update(rawBody).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) return { status: 401 };
    if (!event || !['installation', 'installation_repositories', 'github_app_authorization', 'ping'].includes(event)) return { status: 202 };
    if (event === 'ping') return { status: 200 };
    try {
        const data = JSON.parse(rawBody) as { action?: unknown; installation?: { id?: unknown; app_id?: unknown }; sender?: { id?: unknown };
            repositories_removed?: { id: unknown }[] };
        const action = typeof data.action === 'string' && /^[a-z_]{1,40}$/.test(data.action) ? data.action : '';
        if (!action || (data.installation?.app_id !== undefined && githubId(data.installation.app_id) !== config.appId)) return { status: 400 };
        const doc: GitHubEvent = { type: 'github-event', pk: githubAppPk(config.appId), id: `event_${sha256Hex(delivery)}`,
            event, action, repositoryIds: (data.repositories_removed ?? []).slice(0, 5000).map(repo => githubId(repo.id)),
            receivedAt: new Date().toISOString(), processed: false, ttl: 30 * 24 * 60 * 60,
            ...(data.installation ? { installationId: githubId(data.installation.id) } : {}),
            ...(event === 'github_app_authorization' ? { userId: githubId(data.sender?.id) } : {}) };
        await store.create(doc);
        const persisted = (await store.get<GitHubEvent>(doc.pk, doc.id))?.doc;
        if (persisted && !persisted.processedAt) await applyEvent(persisted, store);
        return { status: 202 };
    } catch { return { status: 503 }; }
}

export async function processGitHubWebhookEvents(options: { deadline: number; maxCalls?: number }, store: AppStore = getAppStore()) {
    if (Date.now() >= options.deadline || (options.maxCalls !== undefined && options.maxCalls <= 0)) return { checked: 0 };
    const config = githubConfig();
    let checked = 0;
    const events = await store.query<GitHubEvent>({ type: 'github-event', pk: githubAppPk(config.appId), where: { processed: false }, limit: Math.min(100, Math.max(1, options.maxCalls ?? 30)) });
    for (const event of events) {
        if (Date.now() >= options.deadline) break;
        if (!event.processedAt) { await applyEvent(event, store); checked++; }
    }
    return { checked };
}
