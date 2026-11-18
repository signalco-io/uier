'use client';

import Link from 'next/link';
import { PlusIcon } from 'lucide-react';
import { useAppI18n } from '@/src/lib/i18n/client';
import { useUrlSearchParams } from '@/src/hooks/use-url-search-params';
import { KnownPages } from '@/src/knownPages';
import { buttonVariants } from '@/src/components/ui/button';
import { Bar, CardGridOutline, Loading } from '../loading/outlines';
import { PageHeader } from '../PageHeader';
import { canConfigureProjects, useShellInfo } from '../shell/ShellInfo';
import { ProjectStatusPanel, ProjectStatusTabs, useProjectStatus } from './ProjectStatusTabs';

/** Create project, the link: in the projects list's header and its empty state, loaded and loading */
export function CreateProjectLink() {
    const { t } = useAppI18n();
    return (
        <Link href={KnownPages.AppNewProject} className={buttonVariants()}>
            <PlusIcon data-icon="inline-start" />{t("Create project")}</Link>
    );
}

/** The list's empty state (`Empty` with its border) as an outline: its icon, title and one line, then its button where `action` */
function EmptyOutline({ action }: { action: boolean }) {
    return (
        <div aria-hidden="true" className="flex w-full flex-col items-center gap-4 rounded-lg border border-dashed p-12">
            <div className="flex w-full max-w-sm flex-col items-center gap-2">
                <Bar className="mb-2 size-10 rounded-lg" />
                <span className="flex h-7 items-center"><Bar className="h-5 w-40" /></span>
                <span className="flex h-[23px] w-full items-center justify-center"><Bar className="h-4 w-72 max-w-full" /></span>
            </div>
            {action && <Bar className="h-9 w-36 rounded-lg" />}
        </div>
    );
}

/**
 * The projects list while it loads (docs/design/loading-states #4): the page's own header, with what needs no data
 * drawn for real, and outlines only where the projects go.
 *
 * - The title, and Create project for those who may create projects here. The role is the shell's (`useShellInfo`);
 *   the link only opens the page, which authorizes for itself. It follows the loaded page's rule: an empty active
 *   list has its own Create project, so the header's shows on Done only. How many projects are active is the
 *   sidebar's count, which a client filter can only lower.
 * - Active and Done: the loaded page's `ProjectStatusTabs`, inert, with the address's tab current. Their counts are
 *   the sidebar's projects by status; with a client filter in the address only the page knows them, so they wait.
 *   The loaded page mounts its own tabs: their links and counts come from its filtered lists.
 * - The client filter exists only when a project has a client. The shell knows whether one does (`useShellInfo`), so
 *   its place is kept with an outline of its size then: at the end of the tabs' row, under them on a phone, where
 *   the loaded filter goes. Which clients it lists comes with the page.
 * - As many card outlines as the status lists (up to nine, in the grid's own columns), or the empty state's outline
 *   when it lists none.
 */
export function ProjectsLoading() {
    const { t } = useAppI18n();
    const info = useShellInfo();
    const status = useProjectStatus();
    const filtered = useUrlSearchParams().has('client');
    const known = info ? Object.values(info.projects) : undefined;
    const counts = known && {
        active: known.filter(project => project.status === 'active').length,
        done: known.filter(project => project.status === 'done').length
    };
    const canCreate = canConfigureProjects(info);
    const listed = counts?.[status];
    return (
        <>
            <PageHeader
                title={t("Projects")}
                actions={canCreate && (counts && counts.active > 0
                    ? <CreateProjectLink />
                    : <ProjectStatusPanel status="done"><CreateProjectLink /></ProjectStatusPanel>)}>
                <div className="flex flex-wrap items-center gap-3">
                    <div inert aria-hidden="true">
                        <ProjectStatusTabs
                            hrefs={{ active: KnownPages.AppProjects, done: `${KnownPages.AppProjects}?status=done` }}
                            counts={filtered ? undefined : counts} />
                    </div>
                    {/* `ClientFilter`'s trigger: a small select, 14rem wide */}
                    {info?.workspace.clients && <Bar className="ml-auto h-8 w-56 max-w-full rounded-md" />}
                </div>
            </PageHeader>
            <Loading label="Loading projects">
                {listed === 0
                    ? <EmptyOutline action={status === 'active' && canCreate} />
                    // A card with one line under its name: 16 px of padding around the 45 px of its two lines
                    : <CardGridOutline cards={Math.min(listed ?? 3, filtered ? 3 : 9)} className="[&>div]:min-h-[79px]" />}
            </Loading>
        </>
    );
}
