'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import { useNewProjectMode } from './NewProjectMode';
import { PageHeader } from '../PageHeader';
import { OnboardingSteps } from './OnboardingSteps';

/** Instructions need only the shared layout's language, not the workspace's client suggestions. */
export function NewProjectHeader() {
    const { t } = useAppI18n();
    const { mode } = useNewProjectMode();
    return <PageHeader
        title={<span data-testid="new-project-heading">{t('Create a project')}</span>}
        description={t('Set up a website for review or start with files.')}>
        {mode === 'website' && <OnboardingSteps current={1} className="mt-2" />}
    </PageHeader>;
}
