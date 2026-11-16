'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { cn } from 'cn';
import { buttonVariants } from '@/src/components/ui/button';
import type { IntegrationProviderId } from '@/src/lib/integrations/model';
import { setReplySyncAction } from './actions';
import { SyncOption } from './SyncOption';

export function ReplySync({ projectId, provider, enabled, canEnable, needsPermissions }: {
    projectId: string; provider: IntegrationProviderId; enabled: boolean; canEnable: boolean; needsPermissions: boolean;
}) {
    const { t } = useAppI18n();
    return <SyncOption id="reply-sync" title={t("Reply sync")} description={t("Keep the conversation together in uier and your connected tool.")}
        label={t("Sync replies in both directions")} projectId={projectId} provider={provider} enabled={enabled}
        canEnable={canEnable && !needsPermissions} action={setReplySyncAction}>
        <p className="m-0">{t("Starts with replies added after enabling. Changes sync in the background. Existing feedback text and status settings are kept separate.")}</p>
        {provider === 'notion' && <p className="m-0">{t("The Notion connection needs read and insert comment capabilities. Replies on the linked page are included; comments attached to individual content blocks are not.")}</p>}
        {needsPermissions && <p className="m-0">{t("Reconnect Slack to allow reading replies in this connection’s public and private channels.")}</p>}
        {provider === 'slack' && needsPermissions && <a className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')} href={`/app/slack/connect?project=${encodeURIComponent(projectId)}&replies=1`}>{t("Allow Slack reply access")}</a>}
    </SyncOption>;
}
