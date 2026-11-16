import type { AppDoc } from '../../app/model';
import { getAppStore, updateDoc, type AppStore } from '../../app/store';
import type { IntegrationSync } from '../model';
import { slackId, slackTimestamp } from './config';
import type { SlackMessage } from './model';

/**
 * Identifier-only pointer from a managed root message to its ledger, so an Events API reply can
 * find its thread with a point read. It holds no feedback or message content. The worker's reply
 * poll refreshes it; a pointer whose ledger is gone expires, and every use rechecks the ledger.
 */
export type SlackThread = AppDoc & {
    type: 'slack-thread'; teamId: string; channelId: string; ts: string;
    workspaceId: string; projectId: string; ledgerPk: string; ledgerId: string; indexedAt: string;
};

const ttlSeconds = 120 * 24 * 60 * 60;
const refreshAfterMs = 30 * 24 * 60 * 60 * 1000;
export const slackThreadPk = (teamId: string, channelId: string) => `slack-thread:${teamId}:${channelId}`;
export const slackThreadId = (ts: string) => `ts_${ts}`;

export async function indexSlackThread(ledger: Pick<IntegrationSync, 'pk' | 'id' | 'workspaceId' | 'projectId'>, root: SlackMessage,
    store: AppStore = getAppStore(), now = Date.now()) {
    if (!slackId(root.teamId) || !slackId(root.channelId) || !slackTimestamp(root.ts)) return;
    const pk = slackThreadPk(root.teamId, root.channelId); const id = slackThreadId(root.ts);
    const next: SlackThread = { type: 'slack-thread', pk, id, teamId: root.teamId, channelId: root.channelId, ts: root.ts,
        workspaceId: ledger.workspaceId, projectId: ledger.projectId, ledgerPk: ledger.pk, ledgerId: ledger.id,
        indexedAt: new Date(now).toISOString(), ttl: ttlSeconds };
    const existing = (await store.get<SlackThread>(pk, id))?.doc;
    if (!existing) { if (await store.create(next)) return; }
    else if (existing.ledgerPk === ledger.pk && existing.ledgerId === ledger.id
        && now - Date.parse(existing.indexedAt) < refreshAfterMs) return;
    // Rewriting restarts the TTL. A root id belongs to one ledger, so the latest writer is correct.
    await updateDoc<SlackThread>(pk, id, () => next, store);
}

export async function findSlackThread(teamId: string, channelId: string, ts: string, store: AppStore = getAppStore()) {
    if (!slackId(teamId) || !slackId(channelId) || !slackTimestamp(ts)) return null;
    const doc = (await store.get<SlackThread>(slackThreadPk(teamId, channelId), slackThreadId(ts)))?.doc;
    return doc?.type === 'slack-thread' && doc.teamId === teamId && doc.channelId === channelId && doc.ts === ts ? doc : null;
}
