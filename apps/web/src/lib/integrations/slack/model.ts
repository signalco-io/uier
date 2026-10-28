import type { AppDoc } from '../../app/model';
import type { IntegrationConnection, IntegrationState } from '../model';
import type { LeasedGrant } from '../grants';

export type SlackGrant = LeasedGrant & {
    type: 'slack-grant'; provider: 'slack'; appId: string; teamId: string; teamName: string; botId: string;
    scopes: string[]; teamHost?: string; tokens?: { access: string; refresh: string; expiresAt: string }; refreshStartedAt?: string;
    /** Set only while this exact OAuth generation is being attached or recovered. */
    setupNonce?: string;
    setupPending?: boolean;
};
export type SlackInstallationOwner = AppDoc & {
    type: 'slack-installation-owner'; appId: string; teamId: string; workspaceId: string; grantId: string;
    status: 'reserved' | 'active' | 'disconnected' | 'released'; nonce: string; generation: number;
    everCommitted?: boolean;
    reservedUntil?: string;
    operationLease?: { id: string; until: string };
};
export type SlackDestination = { generation: number; since: string; teamId: string; channelId: string };
export type SlackConfig = {
    teamId: string; teamName: string; botId: string; teamHost?: string; channelId?: string; channelName?: string;
    since?: string; replySummaries: boolean; statusSummaries: boolean;
};
export type SlackConnection = IntegrationConnection & { provider: 'slack'; type: 'slack-connection'; config: SlackConfig & Record<string, unknown>; setupNonce?: string };
export type SlackMessage = { ts: string; channelId: string; teamId: string; payloadHash?: string; permalink?: string };
export type SlackUncertainPost = { operationId: string; step: string; channelId: string; teamId: string;
    destinationRevision: number; firstSentAt: string; planHash: string; resolved?: 'adopted' | 'absent'; ts?: string };
export type SlackState = IntegrationState & {
    destination?: SlackDestination;
    root?: SlackMessage;
    notifications?: SlackMessage[];
    retired?: SlackMessage[];
    lastNotifiedStatus?: string;
    notifiedReplyIds?: string[];
    baselineOnly?: boolean;
    suppressed?: boolean;
    resume?: { id: string; requestedAt: string; destinationRevision: number; completed?: boolean };
    uncertainPosts?: SlackUncertainPost[];
    missing?: boolean;
};
