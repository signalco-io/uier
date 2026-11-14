import type { DbProject } from './model';

// Pure helpers for a project's links (its repository, boards, chat, designs), shared by the server
// (`projects.ts` validates them, the project header shows them) and the General settings form.

/** A link of the project, as saved: an optional label and an http or https address */
export type ProjectLink = { label: string; url: string };

/** The services a link's address is recognised as; each shows its own mark, any other address a link icon */
export type ProjectLinkProvider = 'github' | 'gitlab' | 'azure-boards' | 'azure-repos' | 'azure-devops' | 'slack' | 'notion'
    | 'figma' | 'google-drive' | 'discord' | 'linear';

/** Product names: shown in place of an empty label, never translated */
export const projectLinkProviderNames: Record<ProjectLinkProvider, string> = {
    github: 'GitHub',
    gitlab: 'GitLab',
    'azure-boards': 'Azure Boards',
    'azure-repos': 'Azure Repos',
    'azure-devops': 'Azure DevOps',
    slack: 'Slack',
    notion: 'Notion',
    figma: 'Figma',
    'google-drive': 'Google Drive',
    discord: 'Discord',
    linear: 'Linear'
};

const MAX_URL_LENGTH = 2048;

/**
 * A link's address as typed: `github.com/acme/site`, `https://dev.azure.com/acme/site/_boards`. Returns
 * the full URL (path, query and hash kept) or `null` when it is not an http or https web address.
 * Schemeless addresses use HTTPS. Addresses with a user name or password are refused, since every
 * member of the project sees the link.
 */
export function normalizeProjectLinkUrl(input: string) {
    const trimmed = input.trim();
    if (!trimmed || trimmed.length > MAX_URL_LENGTH)
        return null;
    let url: URL;
    try {
        url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
        return null;
    if (url.username || url.password || !url.hostname)
        return null;
    // A host name with a dot (example.com), localhost, or an IP address
    if (!url.hostname.includes('.') && url.hostname !== 'localhost' && !url.hostname.startsWith('['))
        return null;
    return url.href.length > MAX_URL_LENGTH ? null : url.href;
}

/** The Azure DevOps service an address opens: the first `_` segment of its path (`/acme/site/_git/web`) */
function azureDevOpsProvider(pathname: string): ProjectLinkProvider | undefined {
    const area = pathname.split('/').find(segment => segment.startsWith('_'))?.toLowerCase();
    if (area === '_git')
        return 'azure-repos';
    if (area && ['_boards', '_workitems', '_backlogs', '_sprints', '_queries'].includes(area))
        return 'azure-boards';
    return area ? 'azure-devops' : undefined;
}

/**
 * The service a saved link's address belongs to, by its host (and, for Azure DevOps, its path), or
 * `undefined` for any other address. Self-hosted GitLab counts when its host starts with `gitlab.`.
 */
export function projectLinkProvider(url: string): ProjectLinkProvider | undefined {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return undefined;
    }
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    const on = (...domains: string[]) => domains.some(domain => host === domain || host.endsWith(`.${domain}`));
    if (on('github.com', 'ghe.com'))
        return 'github';
    if (on('gitlab.com') || host.startsWith('gitlab.'))
        return 'gitlab';
    if (on('dev.azure.com'))
        return azureDevOpsProvider(parsed.pathname) ?? 'azure-devops';
    // Older Azure DevOps organizations (`acme.visualstudio.com/site/_git/web`): only with a service in the path, so
    // Visual Studio's own sites (code., marketplace.) keep the link icon
    if (on('visualstudio.com') && host.split('.').length === 3)
        return azureDevOpsProvider(parsed.pathname);
    if (on('slack.com'))
        return 'slack';
    if (on('notion.so', 'notion.site', 'notion.com'))
        return 'notion';
    if (on('figma.com'))
        return 'figma';
    if (host === 'drive.google.com' || host === 'docs.google.com')
        return 'google-drive';
    if (on('discord.com', 'discord.gg', 'discordapp.com'))
        return 'discord';
    if (on('linear.app'))
        return 'linear';
    return undefined;
}

/** What a link shows: its label, else its service's name, else its host (`example.com`) */
export function projectLinkName(link: ProjectLink) {
    const label = link.label.trim();
    if (label)
        return label;
    const provider = projectLinkProvider(link.url);
    if (provider)
        return projectLinkProviderNames[provider];
    try {
        return new URL(link.url).hostname.replace(/^www\./, '');
    } catch {
        return link.url;
    }
}

/**
 * The project's saved links that are still http or https addresses (older or damaged records never
 * become a link that runs script), each as `{ label, url }` only
 */
export function projectLinks(project: Pick<DbProject, 'links'>): ProjectLink[] {
    if (!Array.isArray(project.links))
        return [];
    return project.links.flatMap(link => {
        if (!link || typeof link.url !== 'string')
            return [];
        const url = normalizeProjectLinkUrl(link.url);
        return url === link.url ? [{ label: typeof link.label === 'string' ? link.label : '', url }] : [];
    });
}
