import { signToken, verifyToken } from '../app/tokens';
import type { NotificationSubscription } from '../notifications/subscriptions';
import { proofThreadPath } from './threadModel';

const purpose = 'proof-returning-link';
export const proofFollowLifetime = 24 * 60 * 60;
export const proofRecoveryLifetime = 30 * 60;
export const proofDigestLifetime = 7 * 24 * 60 * 60;

type ReturningLink = {
    projectId: string;
    assetId: string;
    subscriptionId: string;
    subscriptionVersion: string;
    versionId: string;
    action: 'confirm' | 'open';
    /** A reminder for a superseded or completed check cannot open a different check. */
    verificationId?: string;
};

export function proofReturningLink(baseUrl: string, projectRouteId: string, doc: NotificationSubscription, versionId: string,
    action: ReturningLink['action'], lifetime: number, verificationId?: string) {
    const link = new URL(proofThreadPath(projectRouteId, doc.proofAssetId!, versionId, doc.threadId), baseUrl);
    link.hash = new URLSearchParams({ reviewer: signToken<ReturningLink>(purpose, {
        projectId: doc.projectId, assetId: doc.proofAssetId!, subscriptionId: doc.id, subscriptionVersion: doc.version,
        versionId, action, ...(verificationId ? { verificationId } : {})
    }, lifetime), ...(action === 'confirm' ? { follow: '1' } : {}) }).toString();
    return link.toString();
}

export function readProofReturningLink(token: string) {
    return verifyToken<ReturningLink>(purpose, token);
}
