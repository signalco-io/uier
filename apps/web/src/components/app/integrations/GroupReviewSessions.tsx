'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import type { IntegrationProviderId } from '@/src/lib/integrations/model';
import { setGroupSessionsAction } from './actions';
import { SyncOption } from './SyncOption';

export function GroupReviewSessions({ projectId, provider, enabled, mapped }: {
    projectId: string; provider: IntegrationProviderId; enabled: boolean; mapped: boolean;
}) {
    const { t } = useAppI18n();
    const description = provider === 'slack' ? t('Post one Slack thread for each review.')
        : provider === 'notion' ? t('Group feedback pages by review in your Notion database.')
            : t('Create one parent for each review and link its feedback underneath.');
    return <SyncOption id="group-review-sessions" title={t('Group review sessions')} description={description}
        label={t('Group review sessions')} projectId={projectId} provider={provider} enabled={enabled} canEnable={mapped}
        action={setGroupSessionsAction}>
        <p className="m-0">{t('This setting applies to future reviews. Resumed reviews keep their delivery mode.')}</p>
        {provider === 'slack' && <p className="m-0">{t('Replies in a grouped Slack thread stay in Slack.')}</p>}
        {!mapped && <p className="m-0">{t('Map a Notion review session field first.')}</p>}
    </SyncOption>;
}
