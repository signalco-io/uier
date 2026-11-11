
import { getAppI18n } from '@/src/lib/i18n/server';
import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowUpRight, ChevronRight } from 'lucide-react';
import { KnownPageLinks } from '@/src/knownPages';
import { isUierFeedbackProject } from '@/src/lib/comments/publicProject';
import { getAzureDevOpsSettings } from '@/src/lib/integrations/azure-devops';
import { getGitHubSettings } from '@/src/lib/integrations/github';
import { getLinearSettings } from '@/src/lib/integrations/linear';
import type { IntegrationProviderId } from '@/src/lib/integrations/model';
import { getNotionSettings } from '@/src/lib/integrations/notion';
import { getSlackSettings } from '@/src/lib/integrations/slack/settings';
import { Badge } from '@/src/components/ui/badge';
import { buttonVariants } from '@/src/components/ui/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/src/components/ui/item';
import { IntegrationLogo } from '@/src/components/app/integrations/IntegrationLogo';
import { SuggestIntegration } from '@/src/components/app/integrations/SuggestIntegration';
import { integrationCatalog } from '@/src/lib/integrations/catalog';
import { azureDevOpsStatus, gitHubStatus, integrationConnectHref, linearStatus, notionStatus, projectIntegrations,
    slackStatus } from '@/src/components/app/integrations/projectIntegrations';
import { configurableProject } from '../settingsContext';

export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getAppI18n();
    return { title: t("Integrations · Project settings") };
}

type IntegrationState = { configured: boolean; connected: boolean; status: string; destination?: string };

/**
 * The services a project can connect: a grid of those not connected yet (Connect starts the provider's
 * sign-in), then the connected ones, each opening its own page with the destination and sync controls
 */
async function ProjectIntegrationsSettingsPageContent({ params }: PageProps<'/app/projects/[projectId]/settings/integrations'>) {
    const { t } = await getAppI18n();
    const { projectId } = await params;
    const { context, project } = await configurableProject(projectId);
    if (isUierFeedbackProject(project.id))
        notFound();
    const [notion, github, linear, azureDevOps, slack] = await Promise.all([getNotionSettings(project, context.user.id),
        getGitHubSettings(project, context.user.id), getLinearSettings(project, context.user.id),
        getAzureDevOpsSettings(project, context.user.id), getSlackSettings(project, context.user.id)]);
    const states: Record<IntegrationProviderId, IntegrationState> = {
        notion: { configured: notion.configured, connected: notion.status !== 'not_connected', status: notionStatus(notion),
            destination: notion.dataSourceName ?? notion.notionWorkspaceName },
        github: { configured: github.configured, connected: Boolean(github.connection), status: gitHubStatus(github),
            destination: github.connection?.repositoryName },
        linear: { configured: linear.configured, connected: linear.connected, status: linearStatus(linear),
            destination: linear.teamName ? [linear.teamName, linear.projectName].filter(Boolean).join(' / ') : linear.organizationName },
        'azure-devops': { configured: azureDevOps.configured, connected: azureDevOps.connected, status: azureDevOpsStatus(azureDevOps),
            destination: azureDevOps.azureProjectId ? `${azureDevOps.organization} / ${azureDevOps.azureProjectName ?? t("Saved project")}` : azureDevOps.accountName },
        slack: { configured: slack.configured, connected: Boolean(slack.connection), status: slackStatus(slack),
            destination: slack.connection?.channelName ? `#${slack.connection.channelName}` : slack.connection?.teamName }
    };
    const available = projectIntegrations.filter(({ provider }) => !states[provider].connected);
    const connected = projectIntegrations.filter(({ provider }) => states[provider].connected);

    return (
        <>
            <section aria-labelledby="available-integrations-title" className="@container flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                    <h2 id="available-integrations-title" className="m-0 text-base leading-6 font-semibold tracking-[-0.01em]">{t("Available integrations")}</h2>
                    <p className="m-0 text-sm text-muted-foreground">{t("Copy shared feedback to the tools your team works in. Private feedback is never sent.")}</p>
                </div>
                {available.length
                    ? <ul aria-label={t("Available integrations")} className="m-0 grid list-none gap-3 p-0 @lg:grid-cols-2 @2xl:grid-cols-3">
                        {available.map(({ provider, name, summary }) => (
                            <li key={provider} aria-labelledby={`${provider}-card-title`} className="flex flex-col gap-4 rounded-xl border bg-card p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <IntegrationLogo provider={provider} />
                                    {!states[provider].configured && <Badge variant="secondary">{t("Unavailable")}</Badge>}
                                </div>
                                <div className="flex flex-1 flex-col gap-1">
                                    <h3 id={`${provider}-card-title`} className="m-0 text-sm font-semibold">{name}</h3>
                                    <p className="m-0 text-sm text-muted-foreground">{t(summary)}</p>
                                </div>
                                {/* The optional features of its public page and its own page (IntegrationFeatures) */}
                                <ul aria-label={t("Optional for {value0}", { value0: name })} className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                                    {integrationCatalog[provider].features.filter(feature => feature.optional).map(feature => <li key={feature.key}><Badge variant="outline">{t(feature.title)}</Badge></li>)}
                                </ul>
                                <div className="flex flex-wrap gap-2">
                                    {states[provider].configured && <a href={integrationConnectHref(provider, project.id)} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                                            <ArrowUpRight data-icon="inline-start" />{t("Connect")}<span className="sr-only"> {name}</span>
                                        </a>}
                                    <Link href={KnownPageLinks.projectIntegration(project.id, provider)} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>{t("Details")}<span className="sr-only">{' '}{t("about")}{' '}{name}</span></Link>
                                </div>
                            </li>
                        ))}
                    </ul>
                    : <p className="m-0 text-sm text-muted-foreground">{t("Every integration is connected to this project.")}</p>}
                <SuggestIntegration />
            </section>
            {connected.length > 0 && <section aria-labelledby="connected-integrations-title" className="flex flex-col gap-4">
                <h2 id="connected-integrations-title" className="m-0 text-base leading-6 font-semibold tracking-[-0.01em]">{t("Connected")}</h2>
                <ItemGroup aria-label={t("Connected integrations")} className="gap-3">
                    {connected.map(({ provider, name }) => (
                        <div key={provider} role="listitem">
                            <Item variant="outline" className="rounded-xl" render={<Link href={KnownPageLinks.projectIntegration(project.id, provider)} />}>
                                <ItemMedia><IntegrationLogo provider={provider} className="size-9 p-1.5" /></ItemMedia>
                                <ItemContent className="min-w-0">
                                    <ItemTitle>{name}</ItemTitle>
                                    {states[provider].destination && <ItemDescription className="truncate">{states[provider].destination}</ItemDescription>}
                                </ItemContent>
                                <ItemActions>
                                    <Badge variant="secondary">{t(states[provider].status)}</Badge>
                                    <ChevronRight className="text-muted-foreground" />
                                </ItemActions>
                            </Item>
                        </div>
                    ))}
                </ItemGroup>
            </section>}
        </>
    );
}

export default function ProjectIntegrationsSettingsPage(props: Parameters<typeof ProjectIntegrationsSettingsPageContent>[0]) {
    return <Suspense fallback={<PageLoading title="Loading integrations" />}><ProjectIntegrationsSettingsPageContent {...props} /></Suspense>;
}
