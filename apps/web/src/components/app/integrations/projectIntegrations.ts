import { KnownPages } from '@/src/knownPages';
import type { getAzureDevOpsSettings } from '@/src/lib/integrations/azure-devops';
import type { getGitHubSettings } from '@/src/lib/integrations/github';
import type { getLinearSettings } from '@/src/lib/integrations/linear';
import type { IntegrationProviderId } from '@/src/lib/integrations/model';
import type { NotionSettingsView } from '@/src/lib/integrations/notion';
import type { getSlackSettings } from '@/src/lib/integrations/slack/settings';

export type GitHubSettings = Awaited<ReturnType<typeof getGitHubSettings>>;
export type LinearSettings = Awaited<ReturnType<typeof getLinearSettings>>;
export type AzureDevOpsSettings = Awaited<ReturnType<typeof getAzureDevOpsSettings>>;
export type SlackSettings = Awaited<ReturnType<typeof getSlackSettings>>;

/** The services a project can connect, in the order of its Integrations page: the line on their card and where Connect starts */
export const projectIntegrations: { provider: IntegrationProviderId; name: string; summary: string; connect: string }[] = [
    { provider: 'notion', name: 'Notion', summary: 'A page in your database for each shared feedback thread.', connect: KnownPages.AppNotionConnect },
    { provider: 'github', name: 'GitHub', summary: 'An issue in your repository for each shared feedback thread.', connect: KnownPages.AppGitHubConnect },
    { provider: 'linear', name: 'Linear', summary: 'An issue in your team for each shared feedback thread.', connect: KnownPages.AppLinearConnect },
    { provider: 'azure-devops', name: 'Azure DevOps', summary: 'An Azure Boards work item for each shared feedback thread.', connect: KnownPages.AppAzureDevOpsConnect },
    { provider: 'slack', name: 'Slack', summary: 'A channel message for each shared feedback thread.', connect: KnownPages.AppSlackConnect }
];

/** Starts a provider's connection for a project (a full navigation: it redirects to the provider) */
export function integrationConnectHref(provider: IntegrationProviderId, projectId: string) {
    const connect = projectIntegrations.find(item => item.provider === provider)!.connect;
    return `${connect}?project=${encodeURIComponent(projectId)}`;
}

/*
 * Each provider's status badge, shared by its page and the overview's list of connected services.
 */

export function notionStatus(settings: NotionSettingsView) {
    return !settings.configured ? 'Unavailable' : settings.status === 'not_connected' ? 'Not connected' : settings.status === 'needs_reconnect'
        ? 'Reconnect needed' : settings.status === 'paused' ? 'Waiting for Notion' : !settings.dataSourceId ? 'Choose a destination' : settings.enabled ? 'Sync on' : 'Sync off';
}

export function gitHubStatus(settings: GitHubSettings, outcome?: string) {
    const connection = settings.connection;
    return !settings.configured ? 'Unavailable' : settings.setup ? 'Choose a repository' : !connection ? (outcome === 'pending' ? 'Approval needed' : 'Not connected')
        : connection.status === 'needs_reconnect' ? 'Reconnect needed' : connection.status === 'paused' ? 'Waiting for GitHub'
        : connection.enabled ? 'Sync on' : 'Sync off';
}

export function linearStatus(settings: LinearSettings) {
    return !settings.configured ? 'Unavailable' : !settings.connected ? 'Not connected'
        : settings.status === 'needs_reconnect' ? 'Reconnect needed' : settings.status === 'paused' || settings.pausedUntil ? 'Waiting for Linear'
        : !settings.teamId ? 'Choose a destination' : settings.enabled ? 'Sync on' : 'Sync off';
}

export function azureDevOpsStatus(settings: AzureDevOpsSettings) {
    return !settings.configured ? 'Unavailable' : !settings.connected ? 'Not connected'
        : settings.status === 'needs_reconnect' ? 'Reconnect needed' : settings.status === 'paused' || settings.pausedUntil ? 'Waiting for Azure DevOps'
        : !settings.azureProjectId ? 'Choose a destination' : settings.enabled ? 'Sync on' : 'Sync off';
}

export function slackStatus(settings: SlackSettings) {
    const connection = settings.connection;
    return !settings.configured ? 'Unavailable' : !connection ? 'Not connected'
        : connection.status === 'needs_reconnect' ? 'Reconnect needed' : connection.status === 'paused' ? 'Waiting for Slack'
        : !connection.channelName ? 'Choose a channel' : connection.enabled ? 'Notifications on' : 'Notifications off';
}
