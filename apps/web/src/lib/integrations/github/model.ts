import type { AppDoc } from '../../app/model';
import type { IntegrationAttempt, IntegrationConnection } from '../model';

export type GitHubDestination = {
    revision: number; installationId: string; repositoryId: string; repositoryNodeId: string;
    owner: string; name: string; botId: string; marker: string; authorizedGitHubUserId: string; authorizedAt: string;
    issue?: { id: string; number: number; url: string; bodyHash?: string; status?: string };
    items: Record<string, { id: string; marker: string; hash: string }>;
    scan?: { kind: 'issue' | 'comment'; page: number; pages: number; match?: { id: string; number: number; url: string }; itemId?: string; marker: string; rounds: number; initial: boolean };
    /** Unknown creates detached during cleanup so unrelated known copies can be removed. */
    uncertainCreates?: IntegrationAttempt[];
    cleaned?: boolean;
};
export type GitHubState = { active?: GitHubDestination; retired: GitHubDestination[] };
export type GitHubConnection = IntegrationConnection & { provider: 'github'; type: 'github-connection'; config: {
    installationId: string; repositoryId: string; repositoryNodeId: string; owner: string; name: string;
    private: boolean; botId: string; markerSeed: string; authorizedGitHubUserId: string; authorizedAt: string;
} };
export type GitHubInstallation = AppDoc & {
    type: 'github-installation'; appId: string; installationId: string; botId?: string; accountName?: string;
    status: 'connected' | 'suspended' | 'deleted'; deniedRepositories: string[]; pausedUntil?: string; updatedAt: string;
};
export type GitHubSetup = AppDoc & {
    type: 'github-setup'; userId: string; workspaceId: string; projectId: string; installationId: string;
    accountName: string; botId: string; githubUserId: string; token?: string; tokenExpiresAt?: string;
    createdAt: string; expiresAt: string; usedAt?: string;
};
export type GitHubRepository = { id: number; node_id: string; name: string; owner: { login: string }; full_name: string;
    private: boolean; archived?: boolean; disabled?: boolean; has_issues?: boolean; permissions?: { admin?: boolean } };
export type GitHubIssue = { id: number; number: number; html_url: string; title: string; body: string | null; state: string;
    created_at: string; pull_request?: unknown; user: { id: number; type: string; login: string } };
export type GitHubComment = { id: number; body: string | null; issue_url?: string; user: { id: number; type: string } };
export const githubInstallationPk = (appId: string, id: string) => `github-installation:${appId}:${id}`;
