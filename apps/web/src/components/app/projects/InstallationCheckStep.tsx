'use client';
import { useAppI18n } from '@/src/lib/i18n/client';


import { useState } from 'react';
import { InstallationCheck } from './InstallationCheck';
import { OnboardingStepCard } from './OnboardingStepCard';

/**
 * Onboarding's installation check: Check installation is the step's primary button until the site is
 * confirmed, then Next is. Next never waits for the check: a private or unfinished site can be checked later.
 */
export function InstallationCheckStep({ projectId, publicId, urls, back, skip, next }: {
    projectId: string;
    publicId: string;
    urls: string[];
    back: string;
    skip: string;
    next: string;
}) {
    const { t } = useAppI18n();
    const [confirmed, setConfirmed] = useState(false);
    return (
        <OnboardingStepCard
            id="check-installation"
            title={t("Check installation")}
            description={t("Open your site to check that the toolbar loads and connects. Leave the new window open until the check finishes.")}
            back={back}
            skip={skip}
            next={{ href: next, label: 'Next', primary: confirmed }}>
            <InstallationCheck key={urls.join('\0')} bare projectId={projectId} publicId={publicId} urls={urls}
                onResultChange={result => setConfirmed(result === 'success')} />
        </OnboardingStepCard>
    );
}
