import type { AppDoc } from '../../app/model';
import type { GrantLease, LeasedGrant } from '../grants';
import type { IntegrationConnection } from '../model';

export type LinearGrant = LeasedGrant & {
    type: 'linear-grant'; provider: 'linear'; clientId: string;
    organizationId: string; organizationName: string; organizationSlug: string; appUserId: string;
    authorizedBy: string; access?: string; refresh?: string; expiresAt?: string; scopes: string[];
    status: 'connected' | 'needs_reconnect' | 'disconnected'; statusCode?: string;
    refreshLease?: GrantLease; refreshStartedAt?: string; pausedUntil?: string; lastCallAt?: string;
    createdAt: string; updatedAt: string;
};
export type LinearInstallation = AppDoc & {
    type: 'linear-installation-claim'; provider: 'linear'; workspaceId: string; grantId: string;
    organizationId: string; clientId: string; status: 'reserved' | 'active' | 'disconnected' | 'vacant'; reservedBy?: string;
    operation?: { id: string; until: string }; createdAt: string; updatedAt: string;
};
export type LinearDestination = {
    organizationId: string; organizationSlug: string; teamId: string; teamName: string;
    projectId?: string; projectName?: string; openStateId: string; doneStateId: string;
    openStateName: string; doneStateName: string; labelIds: string[]; screenshots: boolean;
};
export type LinearConnection = IntegrationConnection & { provider: 'linear'; type: 'linear-connection'; grantId: string;
    config: Record<string, unknown> & Partial<LinearDestination>; retiredGrantIds?: string[] };
export type LinearSelection = AppDoc & { type: 'linear-selection'; projectId: string; connectionId: string };
export type LinearOption = { id: string; name: string; type?: string };
export type LinearOptionPage = { items: LinearOption[]; truncated: boolean };
export type LinearSavedComment = { id: string; hash?: string; deleted?: boolean; uncertain?: boolean };
export type LinearIssueGeneration = {
    generation: number; issueId: string; marker: string; teamId: string; projectId?: string;
    grantId?: string; organizationId?: string; appUserId?: string;
    uncertainUpload?: { revision: string; assetUrl: string }; createUncertain?: boolean;
    destinationRevision: number; identifier?: string; url?: string; bodyHash?: string; stateId?: string;
    managedLabels: string[]; comments: Record<string, LinearSavedComment>;
    screenshot?: { revision: string; assetUrl: string; uploaded?: boolean }; scrubbed?: boolean; trashed?: boolean; cleaned?: boolean; cleanupStarted?: boolean;
};
export type LinearState = Record<string, unknown> & {
    issue?: LinearIssueGeneration; retired?: LinearIssueGeneration[]; visibilityGeneration?: number;
};
