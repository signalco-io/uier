import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PUBLIC_PROJECT_ID } from '@/src/lib/comments/publicProject';
import { getAzureDevOpsSettings } from '@/src/lib/integrations/azure-devops';
import { getGitHubSettings } from '@/src/lib/integrations/github';
import { getLinearSettings } from '@/src/lib/integrations/linear';
import { getNotionSettings } from '@/src/lib/integrations/notion';
import { getSlackSettings } from '@/src/lib/integrations/slack/settings';
import { AzureDevOpsSection } from '@/src/components/app/azure-devops/AzureDevOpsSection';
import { GitHubSection } from '@/src/components/app/github/GitHubSection';
import { LinearSection } from '@/src/components/app/linear/LinearSection';
import { NotionSection } from '@/src/components/app/notion/NotionSection';
import { SlackSection } from '@/src/components/app/slack/SlackSection';
import { configurableProject } from '../settingsContext';

export const metadata: Metadata = {
    title: 'Integrations · Project settings'
};

/** Each provider's connection; the connect and callback routes come back here with their outcome (`?github=connected#github`) */
export default async function ProjectIntegrationsSettingsPage({ params, searchParams }: PageProps<'/app/projects/[projectId]/settings/integrations'>) {
    const { projectId } = await params;
    const { context, project } = await configurableProject(projectId);
    if (project.id === PUBLIC_PROJECT_ID)
        notFound();
    const query = await searchParams;
    const value = (key: string) => typeof query[key] === 'string' ? query[key] as string : undefined;
    const [notion, github, linear, azureDevOps, slack] = await Promise.all([getNotionSettings(project, context.user.id),
        getGitHubSettings(project, context.user.id, value('githubSetup')), getLinearSettings(project, context.user.id),
        getAzureDevOpsSettings(project, context.user.id), getSlackSettings(project, context.user.id)]);

    return (
        <>
            <NotionSection projectId={project.id} settings={notion} outcome={value('notion')} />
            <GitHubSection projectId={project.id} settings={github} outcome={value('github')} />
            <LinearSection projectId={project.id} settings={linear} outcome={value('linear')} />
            <AzureDevOpsSection projectId={project.id} settings={azureDevOps} outcome={value('azure-devops')} />
            <SlackSection projectId={project.id} settings={slack} outcome={value('slack')} />
        </>
    );
}
