import { workspaceStatusWorkflow } from '@/src/lib/app/statusWorkflows';
import { WorkspaceStatusWorkflowForm } from './WorkspaceStatusWorkflowForm';

import { getAppI18n } from '@/src/lib/i18n/server';
import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import { workspaceFeedbackTypes } from '@/src/lib/app/feedbackTypes';
import { WorkspaceFeedbackTypesForm } from './WorkspaceFeedbackTypesForm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { KnownPages } from '@/src/knownPages';
import { WorkspaceTabHeader } from '@/src/components/app/workspace/WorkspaceTabHeader';
import { requireAdminContext } from '@/src/lib/app/context';
import { PUBLIC_WORKSPACE_ID } from '@/src/lib/comments/publicProjectPolicy';
import { workspaceAiTitles } from '@/src/lib/titles/settings';
import { WorkspaceAiTitlesForm } from './WorkspaceAiTitlesForm';
import { WorkspaceNameForm } from './WorkspaceNameForm';
import { WorkspaceDomainsSection } from './WorkspaceDomainsSection';
import { workspaceRewriteInstructions } from '@/src/lib/rewrite/settings';
import { WorkspaceRewriteInstructionsForm } from './WorkspaceRewriteInstructionsForm';
import { workspaceToolbarLanguage } from '@/src/lib/app/toolbarLanguage';
import { WorkspaceToolbarLanguageForm } from './WorkspaceToolbarLanguageForm';

export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getAppI18n();
    return { title: t("Workspace settings") };
}

/** The current workspace's own settings, for its admins (the uier workspace is managed by uier) */
async function WorkspaceSettingsPageContent() {
    const { t } = await getAppI18n();
    const context = await requireAdminContext();
    if (context.workspace.id === PUBLIC_WORKSPACE_ID)
        redirect(KnownPages.AppProjects);

    return (
        <div className="flex max-w-3xl flex-col">
            <WorkspaceTabHeader description={t("Settings for everyone in this workspace.")} />
            <div className="flex flex-col gap-6">
                <WorkspaceNameForm name={context.workspace.name} />
                <WorkspaceToolbarLanguageForm language={workspaceToolbarLanguage(context.workspace)} />
                <WorkspaceAiTitlesForm enabled={workspaceAiTitles(context.workspace)} />
                <WorkspaceRewriteInstructionsForm instructions={workspaceRewriteInstructions(context.workspace)} />
                <WorkspaceFeedbackTypesForm types={workspaceFeedbackTypes(context.workspace)} />
                <WorkspaceStatusWorkflowForm workflow={workspaceStatusWorkflow(context.workspace)} />
                <WorkspaceDomainsSection context={context} />
            </div>
        </div>
    );
}

export default function WorkspaceSettingsPage() {
    return <Suspense fallback={<PageLoading title="Loading settings" />}><WorkspaceSettingsPageContent /></Suspense>;
}
