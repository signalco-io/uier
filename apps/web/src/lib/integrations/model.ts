import type { FeedbackExport } from '@uier/toolbar/feedback-context';
import type { AppDoc, DbProject } from '../app/model';

export const integrationProviders = ['notion', 'github', 'linear', 'slack'] as const;
export type IntegrationProviderId = typeof integrationProviders[number];
export const integrationLabels: Record<IntegrationProviderId, string> = {
    notion: 'Notion', github: 'GitHub', linear: 'Linear', slack: 'Slack'
};
export function isIntegrationProvider(value: unknown): value is IntegrationProviderId {
    return typeof value === 'string' && integrationProviders.some(provider => provider === value);
}

export type IntegrationBinding = { connectionId: string; since: string };
export type IntegrationTarget = { provider: IntegrationProviderId; connectionId: string };
export type IntegrationConnection = AppDoc & {
    type: `${IntegrationProviderId}-connection`;
    provider: IntegrationProviderId;
    workspaceId: string;
    projectId: string;
    connectedBy: string;
    enabled: boolean;
    status: 'connected' | 'needs_reconnect' | 'paused';
    statusCode?: string;
    pausedUntil?: string;
    /** Changes whenever the destination or mapping changes; fences persisted operations. */
    destinationRevision: number;
    config: Record<string, unknown>;
    grantId?: string;
    createdAt: string;
    updatedAt: string;
    lastSyncedAt?: string;
    backfill?: { id: string; threadIds: string[]; queued: number; requestedAt: string; done: boolean; destinationRevision?: number; canceled?: boolean };
    backfillPending?: boolean;
};

/** Provider metadata only: ids, hashes, cursors and booleans. Never exported text or credentials. */
export type IntegrationState = Record<string, unknown>;
export type IntegrationAttempt = {
    operationId: string;
    firstSentAt: string;
    through: number;
    requestRevision: number;
    destinationRevision: number;
    step: string;
    planHash: string;
    metadata: IntegrationState;
    /** An identical update/delete/read can be replayed; creates must first reconcile. */
    repeatable: boolean;
};

export type IntegrationSync = AppDoc & {
    type: `${IntegrationProviderId}-sync`;
    provider: IntegrationProviderId;
    workspaceId: string;
    connectionId: string;
    projectId: string;
    threadId: string;
    requestedVersion: number;
    processedVersion: number;
    /** Allows a connection-specific backfill to force the same source version once. */
    requestRevision: number;
    processedRequestRevision: number;
    reconcileRequestId?: string;
    reconcileDestinationRevision?: number;
    /** Independent source intent prevents a forced backfill from masking later normal changes. */
    sourceRequestedVersion?: number;
    deletion?: { version: number; deletedAt: string };
    tombstoned: boolean;
    active: boolean;
    failures: number;
    nextAttemptAt: string;
    lease?: { id: string; until: string };
    attempt?: IntegrationAttempt;
    status: 'queued' | 'waiting' | 'accepted' | 'suppressed' | 'failed' | 'ambiguous';
    lastCode?: string;
    state: IntegrationState;
};

export type IntegrationResult =
    | { status: 'accepted' | 'suppressed'; code?: string }
    | { status: 'waiting'; code: string; retryAt?: string }
    | { status: 'failed' | 'ambiguous'; code: string }
    | { status: 'paused' | 'needs_reconnect'; code: string };

export type IntegrationOperation = {
    step: string;
    /** Hash of the intended payload, never the payload itself. */
    planHash: string;
    metadata?: IntegrationState;
    repeatable?: boolean;
};

export type IntegrationDeliveryContext = {
    readonly connection: IntegrationConnection;
    readonly ledger: IntegrationSync;
    readonly project: DbProject;
    readonly mode: 'sync' | 'cleanup';
    /** Always null for cleanup, including a previously public thread made private. */
    readonly feedback: FeedbackExport | null;
    readonly through: number;
    readonly deadline: number;
    readonly baseUrl: string;
    /** A safe read still checks authority and the provider's remaining budget. */
    read<T>(send: (signal: AbortSignal) => Promise<T>): Promise<T>;
    /** Persist-before-send. An uncertain non-repeatable operation cannot be blindly replayed. */
    operation<T>(operation: IntegrationOperation, send: (signal: AbortSignal) => Promise<T>): Promise<T>;
    /** Lease-fenced metadata checkpoint after a definitive response or reconciliation. */
    checkpoint(state: IntegrationState, options?: { clearAttempt?: boolean }): Promise<void>;
};

export type IntegrationAdapter = {
    provider: IntegrationProviderId;
    isConfigured(): boolean;
    /** A maximum; the fair worker allowance can be smaller. */
    maxRunMs?: number;
    maxCalls?: number;
    /** Provider access/schema maintenance, without any feedback projection. */
    maintenance?(options: { deadline: number; maxCalls: number }): Promise<{ calls: number; deferred?: number }>;
    /** Must reconcile ledger.attempt before planning another create, even during cleanup. */
    deliver(context: IntegrationDeliveryContext): Promise<IntegrationResult>;
    externalLink?(connection: IntegrationConnection, ledger: IntegrationSync): string | null;
    /** Destination-specific HTTPS validation; a provider response URL alone is not authority. */
    validateExternalLink?(url: URL, connection: IntegrationConnection, ledger: IntegrationSync): boolean;
    revokeAdmin?(workspaceId: string, userId: string): Promise<void>;
};
