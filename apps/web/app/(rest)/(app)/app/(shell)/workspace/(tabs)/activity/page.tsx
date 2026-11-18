
import { getAppI18n } from '@/src/lib/i18n/server';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { KnownPages } from '@/src/knownPages';
import { listAccessEvents } from '@/src/lib/app/teams';
import { listInvitations } from '@/src/lib/app/invitations';
import { AccessActivity } from '@/src/components/app/teams/Activity';
import { activityNames } from '@/src/components/app/teams/activityNames';
import { requireTeamAdmin, managementData } from '@/src/components/app/teams/management';
import { ActivityLoading } from '@/src/components/app/workspace/WorkspaceLoading';
import { WorkspaceTabIntro } from '@/src/components/app/workspace/WorkspaceTabIntro';

export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getAppI18n();
    return { title: t("Activity") };
}

/** Who changed access in the workspace: invitations, removals, teams and grants (admins; kept 180 days) */
async function ActivityPageContent({ searchParams }: PageProps<'/app/workspace/activity'>) {
    const context = await requireTeamAdmin();
    const { after } = await searchParams;
    const [data, invitations, history] = await Promise.all([
        managementData(context),
        listInvitations(context.workspace.id),
        listAccessEvents(context.workspace.id, typeof after === 'string' ? after : undefined)
    ]);
    const names = await activityNames(context.workspace.id, history.events, data, invitations);
    return (
        <AccessActivity
            events={history.events}
            names={names}
            next={history.next ? `${KnownPages.AppActivity}?${new URLSearchParams({ after: history.next })}` : undefined} />
    );
}

/** The tab's line needs no data, so it is outside the boundary: there at once, and it stays while the changes load */
export default function ActivityPage(props: Parameters<typeof ActivityPageContent>[0]) {
    return (
        <>
            <WorkspaceTabIntro manages description="Who changed access to this workspace and its projects. Only admins see it; it is kept for 180 days." />
            <Suspense fallback={<ActivityLoading />}><ActivityPageContent {...props} /></Suspense>
        </>
    );
}
