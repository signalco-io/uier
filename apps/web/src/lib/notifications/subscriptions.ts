import type { AppDoc } from '../app/model';
import { getAppStore } from '../app/store';
import { sha256Hex } from '../app/tokens';

export const notificationPk = (projectId: string) => `notifications:${projectId}`;
export const subscriptionId = (actorId: string, threadId: string) => `subscription_${sha256Hex(`${actorId}:${threadId}`)}`;
export const preferenceId = (actorId: string) => `preference_${sha256Hex(actorId)}`;

export type NotificationSubscription = AppDoc & {
    type: 'notification-subscription';
    projectId: string;
    threadId: string;
    actorId: string;
    userId?: string;
    following: boolean;
    /** Do not replay activity from before a deliberate follow/verification. */
    since: string;
    email?: string;
    verifiedAt?: string;
    version: string;
    pendingUntil?: string;
    proofAssetId?: string;
    proofShareId?: string;
    proofEpoch?: string;
    proofMailbox?: string;
};

export type NotificationPreference = AppDoc & {
    type: 'notification-preference';
    projectId: string;
    actorId: string;
    muted: boolean;
    version: string;
};

export async function notificationPreference(projectId: string, actorId: string) {
    return (await getAppStore().get<NotificationPreference>(notificationPk(projectId), preferenceId(actorId)))?.doc;
}

export async function notificationSubscription(projectId: string, actorId: string, threadId: string) {
    return (await getAppStore().get<NotificationSubscription>(notificationPk(projectId), subscriptionId(actorId, threadId)))?.doc;
}
