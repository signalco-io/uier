'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { Fragment } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator
} from '@/src/components/ui/breadcrumb';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import { cn } from '@/src/lib/utils';
import { integrationLabels, isIntegrationProvider } from '@/src/lib/integrations/model';
import { projectSettingsSections } from '../projects/projectSettingsSections';
import { accountSections } from '../account/accountSections';
import { ProjectMark } from '../projects/ProjectMark';

/** A project the breadcrumbs can name: its name, and its first address for its favicon */
export type BreadcrumbProject = { name: string; url?: string };

type Crumb = { label: string; href: string; translate?: boolean; mark?: { projectId: string; url?: string } };

const projectPages: Record<string, string> = { install: 'Install', settings: 'Settings' };

/** The workspace area's tabs, and what one of their own pages is (a team, a person) */
const workspacePages: Record<string, { label: string; href: string; item?: string }> = {
    users: { label: 'Users', href: KnownPages.AppUsers, item: 'Person' },
    teams: { label: 'Teams', href: KnownPages.AppTeams, item: 'Team' },
    clients: { label: 'Clients', href: KnownPages.AppClients },
    usage: { label: 'Usage', href: KnownPages.AppWorkspaceUsage },
    activity: { label: 'Activity', href: KnownPages.AppActivity },
    settings: { label: 'Settings', href: KnownPages.AppSettings }
};

/**
 * Where the current page sits: `/app/projects/<id>/settings` -> Projects / <project> / Settings, and a
 * settings section after that (`/settings/integrations` -> ... / Settings / Integrations) and a connected
 * service's page under Integrations (`/settings/integrations/github` -> ... / Integrations / GitHub);
 * an account section the same way (`/app/account/sign-in` -> Account / Sign-in), and the workspace area
 * by its tabs (`/app/workspace/teams/<id>` -> Workspace / Teams / Team)
 */
function crumbs(pathname: string, projects: Record<string, BreadcrumbProject>): Crumb[] {
    const [, , section, id, page, subpage, detail] = pathname.split('/');
    if (section === 'projects') {
        const root = { label: 'Projects', href: KnownPages.AppProjects };
        if (!id)
            return [root];
        if (id === 'new')
            return [root, { label: 'Create project', href: KnownPages.AppNewProject }];
        const known = projects[id];
        // A known project carries its favicon (`ProjectMark`, as in the sidebar and the project header)
        const project = known
            ? { label: known.name, translate: false, href: KnownPageLinks.project(id), mark: { projectId: id, url: known.url } }
            : { label: 'Project', href: KnownPageLinks.project(id) };
        const pageLabel = page ? projectPages[page] : undefined;
        if (!pageLabel)
            return [root, project];
        const settingsSection = page === 'settings' && subpage ? projectSettingsSections.find(item => item.section === subpage) : undefined;
        if (!settingsSection)
            return [root, project, { label: pageLabel, href: pathname }];
        const settings = { label: pageLabel, href: KnownPageLinks.projectSettings(id) };
        return settingsSection.section === 'integrations' && isIntegrationProvider(detail)
            ? [root, project, settings, { label: settingsSection.label, href: KnownPageLinks.projectSettings(id, 'integrations') }, { label: integrationLabels[detail], href: pathname }]
            : [root, project, settings, { label: settingsSection.label, href: pathname }];
    }
    if (section === 'my-work')
        return [{ label: 'My work', href: KnownPages.AppMyWork }];
    if (section === 'workspace') {
        // The workspace area: its tab, then a team's or a person's own page (`/app/workspace/teams/<id>`)
        const root = { label: 'Workspace', href: KnownPages.AppWorkspace };
        const tab = id ? workspacePages[id] : undefined;
        if (!tab)
            return [root];
        const tabCrumb = { label: tab.label, href: tab.href };
        return page && tab.item ? [root, tabCrumb, { label: tab.item, href: pathname }] : [root, tabCrumb];
    }
    if (section === 'account') {
        const root = { label: 'Account', href: KnownPages.AppAccount };
        const accountSection = id ? accountSections.find(item => item.section === id) : undefined;
        return accountSection ? [root, { label: accountSection.label, href: pathname }] : [root];
    }
    if (section === 'github' && id === 'error')
        return [{ label: 'GitHub connection', href: KnownPages.AppGitHubError }];
    return [];
}

export function AppBreadcrumbs({ projects }: { projects: Record<string, BreadcrumbProject> }) {
    const { t } = useAppI18n();
    const items = crumbs(usePathname(), projects);
    if (!items.length)
        return null;

    return (
        <Breadcrumb className="min-w-0">
            <BreadcrumbList className="flex-nowrap">
                {items.map((item, index) => {
                    const last = index === items.length - 1;
                    const label = item.translate === false ? item.label : t(item.label);
                    const content = item.mark
                        ? (
                            <>
                                <ProjectMark name={item.label} projectId={item.mark.projectId} url={item.mark.url} />
                                <span className="truncate">{label}</span>
                            </>
                        )
                        : label;
                    return (
                        <Fragment key={item.href}>
                            {/* Small screens show the current page only */}
                            {index > 0 && <BreadcrumbSeparator className="hidden md:block" />}
                            {/* One line in the 48 px bar: a long name (a project's) is cut short rather than wrapped */}
                            <BreadcrumbItem className={last ? "min-w-0" : "hidden min-w-0 md:inline-flex"}>
                                {last
                                    ? <BreadcrumbPage className={cn('truncate', item.mark && 'flex min-w-0 items-center gap-1.5')}>{content}</BreadcrumbPage>
                                    : <BreadcrumbLink render={<Link href={item.href} />} className={cn('max-w-56 truncate', item.mark && 'flex min-w-0 items-center gap-1.5')}>{content}</BreadcrumbLink>}
                            </BreadcrumbItem>
                        </Fragment>
                    );
                })}
            </BreadcrumbList>
        </Breadcrumb>
    );
}
