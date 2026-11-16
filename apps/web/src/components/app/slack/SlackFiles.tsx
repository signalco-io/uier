'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { cn } from 'cn';
import { buttonVariants } from '@/src/components/ui/button';
import { KnownPages } from '@/src/knownPages';
import { SyncOption } from '../integrations/SyncOption';
import { setSlackFilesAction } from './actions';

/**
 * Sending a thread's screenshots and recordings to its Slack thread. Off until an admin allows file
 * uploads in Slack (its own reconnect, which keeps the channel) and turns the switch on.
 */
export function SlackFiles({ projectId, enabled, canEnable, needsPermission }: {
    projectId: string; enabled: boolean; canEnable: boolean; needsPermission: boolean;
}) {
    const { t } = useAppI18n();
    return <SyncOption id="slack-files" title={t("Screenshots and recordings")} description={t("Share each thread’s files in its Slack thread.")}
        label={t("Send screenshots and recordings")} projectId={projectId} provider="slack" enabled={enabled}
        canEnable={canEnable && !needsPermission} action={setSlackFilesAction}>
        <p className="m-0">{t("Each file is posted in the message’s Slack thread. A synced reply’s files follow that reply. Everyone with channel access can open them. A file that is replaced or deleted in uier is removed from Slack too.")}</p>
        <p className="m-0">{t("Starts with the next change to a thread. Files already in Slack stay when this is turned off.")}</p>
        {needsPermission && <p className="m-0">{t("Slack asks you to allow file uploads first. Your channel and settings are kept.")}</p>}
        {needsPermission && <a className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')} href={`${KnownPages.AppSlackConnect}?project=${encodeURIComponent(projectId)}&files=1`}>{t("Allow Slack file uploads")}</a>}
    </SyncOption>;
}
