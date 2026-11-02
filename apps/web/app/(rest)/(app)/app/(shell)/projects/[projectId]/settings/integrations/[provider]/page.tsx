import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { KnownPageLinks } from '@/src/knownPages';
import type { DbProject } from '@/src/lib/app/model';
import { PUBLIC_PROJECT_ID } from '@/src/lib/comments/publicProject';
import { getAzureDevOpsSettings } from '@/src/lib/integrations/azure-devops';
import { getGitHubSettings } from '@/src/lib/integrations/github';
import { getLinearSettings } from '@/src/lib/integrations/linear';
import { integrationLabels, isIntegrationProvider, type IntegrationProviderId } from '@/src/lib/integrations/model';
import { getNotionSettings } from '@/src/lib/integrations/notion';
import { getSlackSettings } from '@/src/lib/integrations/slack/settings';
import { cn } from 'cn';
import { buttonVariants } from '@/src/components/ui/button';
import { AzureDevOpsSection } from '@/src/components/app/azure-devops/AzureDevOpsSection';
import { GitHubSection } from '@/src/components/app/github/GitHubSection';
import { LinearSection } from '@/src/components/app/linear/LinearSection';
import { NotionSection } from '@/src/components/app/notion/NotionSection';
import { SlackSection } from '@/src/components/app/slack/SlackSection';
import { configurableProject } from '../../settingsContext';
import { getIntegrationConnection } from '@/src/lib/integrations/connection';
import { configuredIntegrationAdapters } from '@/src/lib/integrations/registry';
import { TwoWaySync } from '@/src/components/app/integrations/TwoWaySync';
import { ReplySync } from '@/src/components/app/integrations/ReplySync';
import { getAppStore } from '@/src/lib/app/store';
import type { SlackGrant } from '@/src/lib/integrations/slack/model';
import { slackReplyScopes } from '@/src/lib/integrations/slack/config';
import type { NotionConnection } from '@/src/lib/integrations/notion/model';

export async function generateMetadata({ params }: PageProps<'/app/projects/[projectId]/settings/integrations/[provider]'>): Promise<Metadata> {
    const { provider } = await params;
    return { title: `${isIntegrationProvider(provider) ? integrationLabels[provider] : 'Integration'} · Project settings` };
}

/**
 * One service's connection: its destination, sync controls and privacy limits. The connect and callback
 * routes come back here with their outcome (`?github=connected`).
 */
export default async function ProjectIntegrationSettingsPage({ params, searchParams }: PageProps<'/app/projects/[projectId]/settings/integrations/[provider]'>) {
    const { projectId, provider } = await params;
    if (!isIntegrationProvider(provider))
        notFound();
    const { context, project } = await configurableProject(projectId);
    if (project.id === PUBLIC_PROJECT_ID)
        notFound();
    const query = await searchParams;
    const adapter = configuredIntegrationAdapters.find(value => value.provider === provider);
    const connection = adapter?.supportsStatusSync || adapter?.supportsReplySync ? await getIntegrationConnection(project, provider) : null;
    const grant = provider === 'slack' && connection?.grantId ? (await getAppStore().get<SlackGrant>(connection.pk, connection.grantId))?.doc : null;
    const needsReplyPermissions = provider === 'slack' && (!grant || !slackReplyScopes.every(scope => grant.scopes.includes(scope)));
    const needsMapping = provider === 'notion' && !(connection as NotionConnection | null)?.config.mapping?.status;
    const value = (key: string) => typeof query[key] === 'string' ? query[key] as string : undefined;

    return (
        <>
            <Link href={KnownPageLinks.projectSettings(project.id, 'integrations')} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-mb-2 -ml-2.5 w-fit')}><ArrowLeft data-icon="inline-start" />All integrations</Link>
            <IntegrationSection provider={provider} project={project} userId={context.user.id} outcome={value(provider)} githubSetup={value('githubSetup')} />
            {connection && adapter?.supportsStatusSync && <TwoWaySync key={connection.id} projectId={project.id} provider={provider}
                enabled={connection.twoWaySync === true} canEnable={adapter!.isConfigured() && connection.status === 'connected' && !needsMapping}
                needsMapping={needsMapping} />}
            {connection && adapter?.supportsReplySync && <ReplySync key={`replies:${connection.id}`} projectId={project.id} provider={provider}
                enabled={connection.replySync?.enabled === true} canEnable={adapter.isConfigured() && connection.status === 'connected'} needsPermissions={needsReplyPermissions} />}
        </>
    );
}

async function IntegrationSection({ provider, project, userId, outcome, githubSetup }: {
    provider: IntegrationProviderId;
    project: DbProject;
    userId: string;
    outcome?: string;
    githubSetup?: string;
}) {
    switch (provider) {
        case 'notion':
            return <NotionSection projectId={project.id} settings={await getNotionSettings(project, userId)} outcome={outcome} />;
        case 'github':
            return <GitHubSection projectId={project.id} settings={await getGitHubSettings(project, userId, githubSetup)} outcome={outcome} />;
        case 'linear':
            return <LinearSection projectId={project.id} settings={await getLinearSettings(project, userId)} outcome={outcome} />;
        case 'azure-devops':
            return <AzureDevOpsSection projectId={project.id} settings={await getAzureDevOpsSettings(project, userId)} outcome={outcome} />;
        case 'slack':
            return <SlackSection projectId={project.id} settings={await getSlackSettings(project, userId)} outcome={outcome} />;
    }
}
