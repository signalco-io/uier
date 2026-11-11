'use client';
import { useAppI18n } from '@/src/lib/i18n/client';


import type { ReactNode } from 'react';
import { useUrlSearchParams } from '@/src/hooks/use-url-search-params';
import type { ProjectStatus } from '@/src/lib/app/model';
import { LinkTabs } from '../LinkTabs';

/** The projects list's status from the address (`?status=done`), current during the click that changes it */
export function useProjectStatus(): ProjectStatus {
    return useUrlSearchParams().get('status') === 'done' ? 'done' : 'active';
}

/**
 * The projects list's Active and Done. The page holds both lists, so a tab only changes the address:
 * the other list shows at once, with no request and no spinner, and Back, Forward and reload keep it.
 */
export function ProjectStatusTabs({ hrefs, counts }: { hrefs: Record<ProjectStatus, string>; counts: Record<ProjectStatus, number> }) {
    const { t } = useAppI18n();
    const status = useProjectStatus();
    return (
        <LinkTabs
            label={t("Project status")}
            variant="segmented"
            tabs={[
                { href: hrefs.active, label: 'Active', count: counts.active, current: status === 'active', query: { status: undefined } },
                { href: hrefs.done, label: 'Done', count: counts.done, current: status === 'done', query: { status: 'done' } }
            ]} />
    );
}

/** What the page shows for one status (its list, its actions); rendered for both, shown while its tab is current */
export function ProjectStatusPanel({ status, children }: { status: ProjectStatus; children: ReactNode }) {
    return <div hidden={useProjectStatus() !== status}>{children}</div>;
}
