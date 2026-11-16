'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import type { IntegrationProviderId } from '@/src/lib/integrations/model';
import { setTwoWaySyncAction } from './actions';
import { SyncOption } from './SyncOption';

export function TwoWaySync({ projectId, provider, enabled, canEnable, needsMapping }: {
    projectId: string; provider: IntegrationProviderId; enabled: boolean; canEnable: boolean; needsMapping: boolean;
}) {
    const { t } = useAppI18n();
    return <SyncOption id="two-way-sync" title={t("Two-way status sync")} description={t("Keep Open and Done in sync in both directions.")}
        label={t("Enable two-way status sync")} projectId={projectId} provider={provider} enabled={enabled} canEnable={canEnable} action={setTwoWaySyncAction}>
        <p className="m-0">{t("When on, closing or reopening the linked item also updates the feedback in uier. Changes are checked in the background, usually every five minutes. Pending uier changes take precedence.")}</p>
        {needsMapping && <p className="m-0">{t("Load the Notion fields above and map a Status or Select field to Open and Done before enabling this option.")}</p>}
    </SyncOption>;
}
