
import { getAppI18n } from '@/src/lib/i18n/server';
import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import type { PropsWithChildren } from 'react';
import { requireAppContext } from '@/src/lib/app/context';
import { PageHeader } from '@/src/components/app/PageHeader';
import { LinkTabs } from '@/src/components/app/LinkTabs';
import { workspaceTabs } from '@/src/components/app/workspace/workspaceTabs';

/**
 * The workspace area: the workspace's name above its tabs (Users, Teams, Clients, Usage, Activity and
 * Settings for admins; Clients and Usage for everyone else). A team's and a person's own pages open from the tabs, without them.
 */
async function WorkspaceTabsLayoutContent({ children }: PropsWithChildren) {
    const { t } = await getAppI18n();
    const context = await requireAppContext();
    return (
        <>
            <PageHeader title={context.workspace.name}>
                <LinkTabs label={t("Workspace")} match="path" tabs={workspaceTabs(context).map(tab => ({ ...tab, label: t(tab.label) }))} />
            </PageHeader>
            {children}
        </>
    );
}

export default function WorkspaceTabsLayout(props: Parameters<typeof WorkspaceTabsLayoutContent>[0]) {
    return <Suspense fallback={<PageLoading title="Loading workspace" />}><WorkspaceTabsLayoutContent {...props} /></Suspense>;
}
