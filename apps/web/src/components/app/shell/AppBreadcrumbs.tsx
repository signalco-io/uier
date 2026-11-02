'use client';

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
import { integrationLabels, isIntegrationProvider } from '@/src/lib/integrations/model';
import { projectSettingsSections } from '../projects/projectSettingsSections';
import { accountSections } from '../account/accountSections';

type Crumb = { label: string; href: string };

const projectPages: Record<string, string> = { install: 'Install', settings: 'Settings' };

/**
 * Where the current page sits: `/app/projects/<id>/settings` -> Projects / <project> / Settings, and a
 * settings section after that (`/settings/integrations` -> ... / Settings / Integrations) and a connected
 * service's page under Integrations (`/settings/integrations/github` -> ... / Integrations / GitHub);
 * an account section the same way (`/app/account/sign-in` -> Account / Sign-in)
 */
function crumbs(pathname: string, projectNames: Record<string, string>): Crumb[] {
    const [, , section, id, page, subpage, detail] = pathname.split('/');
    if (section === 'projects') {
        const root = { label: 'Projects', href: KnownPages.AppProjects };
        if (!id)
            return [root];
        if (id === 'new')
            return [root, { label: 'Create project', href: KnownPages.AppNewProject }];
        const project = { label: projectNames[id] ?? 'Project', href: KnownPageLinks.project(id) };
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
    if (section === 'teams')
        return [{ label: 'Teams', href: KnownPages.AppTeams }, ...(id ? [{ label: 'Team', href: pathname }] : [])];
    if (section === 'users')
        return [{ label: 'Users', href: KnownPages.AppUsers }];
    if (section === 'clients')
        return [{ label: 'Clients', href: KnownPages.AppClients }];
    if (section === 'account') {
        const root = { label: 'Account', href: KnownPages.AppAccount };
        const accountSection = id ? accountSections.find(item => item.section === id) : undefined;
        return accountSection ? [root, { label: accountSection.label, href: pathname }] : [root];
    }
    if (section === 'settings')
        return [{ label: 'Workspace settings', href: KnownPages.AppSettings }];
    if (section === 'github' && id === 'error')
        return [{ label: 'GitHub connection', href: KnownPages.AppGitHubError }];
    return [];
}

export function AppBreadcrumbs({ projectNames }: { projectNames: Record<string, string> }) {
    const items = crumbs(usePathname(), projectNames);
    if (!items.length)
        return null;

    return (
        <Breadcrumb className="min-w-0">
            <BreadcrumbList className="flex-nowrap">
                {items.map((item, index) => {
                    const last = index === items.length - 1;
                    return (
                        <Fragment key={item.href}>
                            {/* Small screens show the current page only */}
                            {index > 0 && <BreadcrumbSeparator className="hidden md:block" />}
                            <BreadcrumbItem className={last ? 'min-w-0' : 'hidden md:inline-flex'}>
                                {last
                                    ? <BreadcrumbPage className="truncate">{item.label}</BreadcrumbPage>
                                    : <BreadcrumbLink render={<Link href={item.href} />}>{item.label}</BreadcrumbLink>}
                            </BreadcrumbItem>
                        </Fragment>
                    );
                })}
            </BreadcrumbList>
        </Breadcrumb>
    );
}
