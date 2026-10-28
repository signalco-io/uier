import type { IntegrationAttempt, IntegrationConnection, IntegrationState } from '../model';
import type { LeasedGrant } from '../grants';

export type NotionSchema = Record<string, { name: string; type: string; options?: string[] }>;
export type NotionMapping = {
    title: string;
    uierId: string;
    status?: { property: string; type: 'status' | 'select'; open: string; done: string };
    kind?: string;
    environment?: string;
    link?: string;
    page?: string;
    created?: string;
    assignee?: string;
    screenshot?: string;
};
export type NotionConfiguration = {
    dataSourceId?: string;
    databaseId?: string;
    dataSourceName?: string;
    mapping?: NotionMapping;
    schema?: NotionSchema;
    schemaCheckedAt?: string;
    maxFileUploadBytes?: number;
    notionWorkspaceId?: string;
    notionWorkspaceName?: string;
};
export type NotionConnection = IntegrationConnection & { type: 'notion-connection'; provider: 'notion'; config: NotionConfiguration & Record<string, unknown> };
export type NotionGrant = LeasedGrant & {
    type: 'notion-grant'; provider: 'notion'; projectId: string; connectedBy: string;
    botId: string; notionWorkspaceId: string; notionWorkspaceName?: string;
    tokens?: { access: string; refresh?: string };
    pausedUntil?: string;
    issuedAt: string;
};
export type NotionBlock = { object?: 'block'; type: string; [key: string]: unknown };
export type BlockSpec = { key: string; block: NotionBlock; hash: string };
export type BlockRecord = { key: string; id: string; type: string; hash: string };
export type NotionPageRecord = {
    id: string; url: string; dataSourceId: string; databaseId?: string; notionWorkspaceId: string; botId: string;
    mapping: NotionMapping; pastMappings?: NotionMapping[]; blocks: BlockRecord[]; propertiesHash?: string; scrubbed?: boolean; scrubPending?: boolean; trashed?: boolean;
    screenshot?: { revision: string; fileUploadId: string };
};
export type NotionUpload = { id: string; revision: string; expiryTime: string; sent: boolean; attached: boolean };
export type NotionState = IntegrationState & {
    page?: NotionPageRecord; retired?: NotionPageRecord[]; upload?: NotionUpload;
    retiredAttempts?: IntegrationAttempt[];
    reconciliationCount?: number; rebuild?: boolean; removedAtVersion?: number;
};
export type NotionSettingsView = {
    configured: boolean;
    status: 'not_connected' | NotionConnection['status']; statusCode?: string; enabled: boolean;
    notionWorkspaceName?: string; dataSourceId?: string; dataSourceName?: string;
    mapping?: NotionMapping; schema?: NotionSchema; lastSyncedAt?: string; pausedUntil?: string;
    backfill?: { queued: number; total: number; done: boolean }; needsReviewCount: number; needsReviewCountCapped?: boolean;
};
