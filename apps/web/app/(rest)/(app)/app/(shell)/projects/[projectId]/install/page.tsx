
import { getAppI18n } from '@/src/lib/i18n/server';
import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { KnownPageLinks, onboardingSteps, type OnboardingStep } from '@/src/knownPages';
import { requireAppContext } from '@/src/lib/app/context';
import { getVisibleProject } from '@/src/lib/app/projects';
import { appBaseUrl } from '@/src/lib/app/request';
import { BrowserExtensionNote } from '@/src/components/app/projects/BrowserExtensionGuide';
import { InstallationCheckStep } from '@/src/components/app/projects/InstallationCheckStep';
import { PlatformSteps, ScriptDescription, ScriptSnippet } from '@/src/components/app/projects/InstallGuide';
import { InviteReviewerStep } from '@/src/components/app/projects/InviteReviewerStep';
import { OnboardingStepCard } from '@/src/components/app/projects/OnboardingStepCard';
import { OnboardingSteps, type OnboardingStepNumber } from '@/src/components/app/projects/OnboardingSteps';

export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getAppI18n();
    return { title: t("Install") };
}

/**
 * Onboarding after the site (`?onboarding=1`, right after creating the project): one step per screen,
 * `?step=` the script (the default), `check` or `invite`, with Back, Skip setup and Next; Finish and Skip
 * setup open the project's comments. Without `onboarding`, this is the old address of the install guide
 * (the toolbar still links here): it moved to Settings → Installation.
 */
async function InstallProjectPageContent({ params, searchParams }: PageProps<'/app/projects/[projectId]/install'>) {
    const { t } = await getAppI18n();
    const { projectId } = await params;
    const { onboarding, step: stepParam } = await searchParams;
    if (onboarding !== '1')
        redirect(KnownPageLinks.projectInstall(projectId));
    const context = await requireAppContext();
    const project = await getVisibleProject(context, projectId);
    if (!project)
        notFound();

    const step: OnboardingStep = onboardingSteps.find(name => name === stepParam) ?? 'script';
    const href = (name: OnboardingStep) => KnownPageLinks.projectInstall(project.id, { onboarding: true, step: name });
    const comments = KnownPageLinks.project(project.id);
    // The site is step 1 (creating the project); these are 2 to 4
    const number = (name: OnboardingStep) => (onboardingSteps.indexOf(name) + 2) as OnboardingStepNumber;

    return (
        <div className="flex max-w-3xl flex-col gap-8">
            <OnboardingSteps current={number(step)} hrefs={Object.fromEntries(onboardingSteps.map(name => [number(name), href(name)]))} />
            {step === 'script' && (
                <OnboardingStepCard id="add-script" title={t("Add the script")} description={<ScriptDescription />}
                    skip={comments} next={{ href: href('check'), label: t("Next") }}>
                    <ScriptSnippet baseUrl={await appBaseUrl()} publicId={project.publicId} />
                    <div className="flex flex-col gap-3">
                        <h3 className="m-0 text-sm font-medium">{t("Where to add it")}</h3>
                        <PlatformSteps baseUrl={await appBaseUrl()} publicId={project.publicId} />
                    </div>
                    <BrowserExtensionNote />
                </OnboardingStepCard>
            )}
            {step === 'check' && (
                <InstallationCheckStep projectId={project.id} publicId={project.publicId} urls={project.urls}
                    back={href('script')} skip={comments} next={href('invite')} />
            )}
            {step === 'invite' && (
                <InviteReviewerStep projectId={project.id} publicId={project.publicId} access={project.access} urls={project.urls}
                    isAdmin={context.isAdmin} back={href('check')} />
            )}
        </div>
    );
}

export default function InstallProjectPage(props: Parameters<typeof InstallProjectPageContent>[0]) {
    return <Suspense fallback={<PageLoading title="Loading install" />}><InstallProjectPageContent {...props} /></Suspense>;
}
