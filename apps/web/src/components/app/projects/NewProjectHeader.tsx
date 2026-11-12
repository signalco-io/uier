'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import { PageHeader } from '../PageHeader';
import { OnboardingSteps } from './OnboardingSteps';

/** Instructions need only the shared layout's language, not the workspace's client suggestions. */
export function NewProjectHeader() {
    const { t } = useAppI18n();
    return <PageHeader
        title={<span data-testid="new-project-heading">{t('Create a project')}</span>}
        description={t('Tell uier which site you want to review. Then add the script and invite a reviewer.')}>
        <OnboardingSteps current={1} className="mt-2" />
    </PageHeader>;
}
