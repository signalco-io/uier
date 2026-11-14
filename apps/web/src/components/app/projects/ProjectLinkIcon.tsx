import { LinkIcon } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import type { ProjectLinkProvider } from '@/src/lib/app/projectLinks';
import { integrationLogos, serviceLogos, type ServiceLogo } from '../integrations/IntegrationLogo';

/** The integrations' logos where there is one; Azure Boards and Azure Repos show Azure DevOps' mark */
const projectLinkLogos: Record<ProjectLinkProvider, ServiceLogo> = {
    github: integrationLogos.github,
    gitlab: serviceLogos.gitlab,
    'azure-boards': integrationLogos['azure-devops'],
    'azure-repos': integrationLogos['azure-devops'],
    'azure-devops': integrationLogos['azure-devops'],
    slack: integrationLogos.slack,
    notion: integrationLogos.notion,
    figma: serviceLogos.figma,
    'google-drive': serviceLogos['google-drive'],
    discord: serviceLogos.discord,
    linear: integrationLogos.linear
};

/**
 * A project link's icon (decorative, 16 px unless `className` sizes it): the service's own mark, one-colour marks in
 * the text colour, or Lucide's link, muted, for any other address
 */
export function ProjectLinkIcon({ provider, className }: { provider: ProjectLinkProvider | undefined; className?: string }) {
    if (!provider)
        return <LinkIcon aria-hidden="true" data-project-link-icon="link" className={cn('size-4 shrink-0 text-muted-foreground', className)} />;
    const logo = projectLinkLogos[provider];
    return (
        <svg aria-hidden="true" data-project-link-icon={provider} viewBox={logo.viewBox} focusable="false"
            className={cn('size-4 shrink-0 text-foreground', className)}>
            {logo.paths.map(path => <path key={path.d} d={path.d} fill={path.fill ?? 'currentColor'} />)}
        </svg>
    );
}
