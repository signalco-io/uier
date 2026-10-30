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

type Crumb = { label: string; href: string };

const projectPages: Record<string, string> = { install: 'Install', settings: 'Settings' };

/** Where the current page sits: `/app/projects/<id>/settings` -> Projects / <project> / Settings */
function crumbs(pathname: string, projectNames: Record<string, string>): Crumb[] {
    const [, , section, id, page] = pathname.split('/');
    if (section === 'projects') {
        const root = { label: 'Projects', href: KnownPages.AppProjects };
        if (!id)
            return [root];
        if (id === 'new')
            return [root, { label: 'Create project', href: KnownPages.AppNewProject }];
        const project = { label: projectNames[id] ?? 'Project', href: KnownPageLinks.project(id) };
        const pageLabel = page ? projectPages[page] : undefined;
        return pageLabel ? [root, project, { label: pageLabel, href: pathname }] : [root, project];
    }
    if (section === 'teams')
        return [{ label: 'Teams', href: KnownPages.AppTeams }, ...(id ? [{ label: 'Team', href: pathname }] : [])];
    if (section === 'users')
        return [{ label: 'Users', href: KnownPages.AppUsers }];
    if (section === 'clients')
        return [{ label: 'Clients', href: KnownPages.AppClients }];
    if (section === 'account')
        return [{ label: 'Account', href: KnownPages.AppAccount }];
    if (section === 'settings')
        return [{ label: 'Workspace settings', href: KnownPages.AppSettings }];
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
                                    : <BreadcrumbLink asChild><Link href={item.href}>{item.label}</Link></BreadcrumbLink>}
                            </BreadcrumbItem>
                        </Fragment>
                    );
                })}
            </BreadcrumbList>
        </Breadcrumb>
    );
}
