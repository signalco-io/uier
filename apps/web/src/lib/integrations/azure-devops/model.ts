import type { AppDoc } from '../../app/model';
import type { GrantLease, LeasedGrant } from '../grants';
import type { IntegrationConnection } from '../model';

/** Delegated Microsoft Entra credentials for one project connection. Work items are written as this user. */
export type AzureDevOpsGrant = LeasedGrant & {
    type: 'azure-devops-grant'; provider: 'azure-devops'; clientId: string; projectId: string; connectionId: string;
    /** Azure DevOps profile id and display name of the signed-in Microsoft user. */
    userId: string; userName: string;
    authorizedBy: string; access?: string; refresh?: string; expiresAt?: string; scopes: string[];
    status: 'connected' | 'needs_reconnect' | 'disconnected'; statusCode?: string;
    refreshLease?: GrantLease; pausedUntil?: string;
    /** Set by a refresh forced by a refused token; a fresh token refused again means lost access, not expiry. */
    forcedRefreshAt?: string;
    createdAt: string; updatedAt: string;
};
export type AzureDevOpsDestination = {
    organization: string; organizationId: string; projectId: string; projectName: string;
    workItemType: string; bodyField: AzureDevOpsBodyField; openState: string; doneState: string; areaPath?: string;
};
export type AzureDevOpsBodyField = 'System.Description' | 'Microsoft.VSTS.TCM.ReproSteps';
export type AzureDevOpsConnection = IntegrationConnection & { provider: 'azure-devops'; type: 'azure-devops-connection'; grantId: string;
    config: Record<string, unknown> & Partial<AzureDevOpsDestination> };
/** Finds the project's connection before a destination is saved and bound. */
export type AzureDevOpsSelection = AppDoc & { type: 'azure-devops-selection'; projectId: string; connectionId: string };
export type AzureDevOpsOption = { id: string; name: string };
export type AzureDevOpsOptionPage = { items: AzureDevOpsOption[]; truncated: boolean };
export type AzureDevOpsStateOption = { name: string; category: string };
export type AzureDevOpsTypeOption = { name: string; states: AzureDevOpsStateOption[] };
export type AzureDevOpsProjectOptions = { organization: string; projectId: string; types: AzureDevOpsTypeOption[];
    areaPaths: string[]; truncated: boolean };

/** One external copy. Retired copies keep their own destination so cleanup never uses the current one. */
export type AzureDevOpsWorkItem = {
    generation: number; marker: string; organization: string; projectId: string; projectName: string;
    workItemType: string; bodyField: AzureDevOpsBodyField; destinationRevision: number;
    id?: number; bodyHash?: string; status?: 'open' | 'done';
    /** Set before the create leaves; bounds the reconciliation query after a lost response. */
    createStartedAt?: string; createUncertain?: boolean;
    cleanupStarted?: boolean; scrubbed?: boolean; deleted?: boolean; cleaned?: boolean;
};
export type AzureDevOpsState = Record<string, unknown> & {
    item?: AzureDevOpsWorkItem; retired?: AzureDevOpsWorkItem[]; visibilityGeneration?: number;
};

/** States whose category means work is still to be done, and those that mean it is finished. */
export const openCategories = ['Proposed', 'InProgress'];
export const doneCategories = ['Resolved', 'Completed'];
