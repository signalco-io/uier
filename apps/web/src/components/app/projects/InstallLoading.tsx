'use client';

import { useId, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useAppI18n } from '@/src/lib/i18n/client';
import { KnownPageLinks, onboardingSteps, type OnboardingStep } from '@/src/knownPages';
import { cn } from '@/src/lib/utils';
import { Bar, Loading, SectionOutline } from '../loading/outlines';
import { OnboardingStepCard } from './OnboardingStepCard';
import { OnboardingSteps, type OnboardingStepNumber } from './OnboardingSteps';
import { ScriptDescription } from './ScriptDescription';

/** The site is step 1 (creating the project); the install page's steps are 2 to 4 */
const stepNumber = (step: OnboardingStep) => (onboardingSteps.indexOf(step) + 2) as OnboardingStepNumber;

/**
 * Onboarding after the site, as its address says it (`/install?onboarding=1&step=`): the project, whether it is
 * onboarding at all (without `onboarding=1` the page only redirects to Settings → Installation) and the step, the
 * script without one. Read like the page reads them (a repeated parameter is none), from the address the router is
 * going to, so nothing waits for the server.
 */
function useOnboardingAddress() {
    const { projectId } = useParams<{ projectId: string }>();
    const search = useSearchParams();
    const one = (name: string) => {
        const values = search.getAll(name);
        return values.length === 1 ? values[0] : undefined;
    };
    const stepParam = one('step');
    const step: OnboardingStep = onboardingSteps.find(name => name === stepParam) ?? 'script';
    return {
        projectId,
        onboarding: one('onboarding') === '1',
        step,
        href: (name: OnboardingStep) => KnownPageLinks.projectInstall(projectId, { onboarding: true, step: name })
    };
}

/**
 * Onboarding's frame around a step: the step list, which needs only the address (every step after the site is a link
 * once the project exists). It is the install page's shell, outside its data boundary, so the list is there at once,
 * moves to the next step on the click and stays mounted when the step arrives.
 */
export function InstallFrame({ children }: { children: ReactNode }) {
    const { onboarding, step, href } = useOnboardingAddress();
    if (!onboarding)
        return children;
    return (
        <div className="flex max-w-3xl flex-col gap-8">
            <OnboardingSteps current={stepNumber(step)} hrefs={Object.fromEntries(onboardingSteps.map(name => [stepNumber(name), href(name)]))} />
            {children}
        </div>
    );
}

/** A line of text as a bar, on the line's own height */
function Line({ className, height = 'h-5' }: { className: string; height?: string }) {
    return <span className={cn('flex items-center', height)}><Bar className={cn('h-4 max-w-full', className)} /></span>;
}

/**
 * One onboarding step while it loads (docs/design/loading-states #10): the step's own card (`OnboardingStepCard`) with
 * what every project has drawn for real, its title, its explanation and Back, Skip setup and Next as working links,
 * and outlines where the project goes: the script with its code, the platforms' instructions, the site to check. The
 * last step says who can comment and offers Invite or the guest links, all of which the project decides, Finish's
 * emphasis included, so those are outlines too. Each card has one status, around its first outline.
 */
export function InstallStepLoading() {
    const { t } = useAppI18n();
    const id = useId();
    const { projectId, onboarding, step, href } = useOnboardingAddress();
    // The old address of the install guide: the page redirects to Settings → Installation
    if (!onboarding)
        return <Loading label="Loading installation"><SectionOutline /></Loading>;
    const comments = KnownPageLinks.project(projectId);
    if (step === 'check') {
        return (
            <OnboardingStepCard id={id} title={t("Check installation")}
                description={t("Open your site to check that the toolbar loads and connects. Leave the new window open until the check finishes.")}
                back={href('script')} skip={comments} next={{ href: href('invite'), label: t("Next"), primary: false }}>
                {/* `InstallationCheck`: the site to check, then its button */}
                <Loading label="Loading this step" className="flex flex-col gap-3">
                    <div className="flex flex-col gap-2">
                        <Line className="w-24" />
                        <Bar className="h-9 w-full" />
                    </div>
                    <Bar className="h-9 w-40 rounded-lg" />
                </Loading>
            </OnboardingStepCard>
        );
    }
    if (step === 'invite') {
        return (
            <OnboardingStepCard id={id} title={t("Invite a reviewer")} description={<span aria-hidden="true"><Line className="w-96" /></span>} back={href('check')}>
                <Loading label="Loading this step" className="flex flex-col gap-6">
                    <Line className="w-full" />
                    <Bar className="h-9 w-24 rounded-lg" />
                </Loading>
            </OnboardingStepCard>
        );
    }
    return (
        <OnboardingStepCard id={id} title={t("Add the script")} description={<ScriptDescription />}
            skip={comments} next={{ href: href('check'), label: t("Next") }}>
            {/* `ScriptSnippet`: the script's two lines of code, then Advanced */}
            <Loading label="Loading this step" className="flex flex-col gap-3">
                <Bar className="h-[62px] w-full rounded-lg" />
                <Line className="w-44" height="h-7" />
            </Loading>
            <div className="flex flex-col gap-3">
                <h3 className="m-0 text-sm font-medium">{t("Where to add it")}</h3>
                {/* `PlatformSteps`: the platforms' tabs, the first one's two steps, then Advanced */}
                <div aria-hidden="true" className="flex flex-col gap-3">
                    <Bar className="h-[34px] w-96 max-w-full rounded-lg" />
                    <div className="flex flex-col gap-1">
                        <Line className="w-3/4" />
                        <Line className="w-1/2" />
                    </div>
                    <Line className="w-48" height="h-7" />
                </div>
            </div>
        </OnboardingStepCard>
    );
}

/**
 * The install page's loading state as a whole, for the project's own loading state: entering a project on its install
 * page shows what the page's shell shows, so nothing changes when the project arrives before the step does.
 */
export function InstallLoading() {
    return <InstallFrame><InstallStepLoading /></InstallFrame>;
}
