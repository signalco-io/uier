'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useActionState, useId, useOptimistic, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { cn } from 'cn';
import { Alert, AlertDescription } from '@/src/components/ui/alert';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Badge } from '@/src/components/ui/badge';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/src/components/ui/alert-dialog';
import { Spinner } from '@/src/components/ui/spinner';
import { KnownPages } from '@/src/knownPages';
import type { ActionState } from '@/src/lib/app/actionResult';
import type { getSlackSettings } from '@/src/lib/integrations/slack/settings';
import { BackfillDetail, ConnectionSwitch } from '../integrations/ConnectionControls';
import { ChangeDestinationButton, DestinationPanel, useDestinationForm } from '../integrations/DestinationForm';
import { IntegrationDetail, IntegrationDetails } from '../integrations/IntegrationDetails';
import { IntegrationTitle } from '../integrations/IntegrationLogo';
import { MoreOptions } from '../integrations/MoreOptions';
import { slackStatus } from '../integrations/projectIntegrations';
import { Section } from '../PageHeader';
import { FormMessage } from '../FormMessage';
import { DateTime } from '../comments/DateTime';
import { loadSlackChannelsAction, manageSlackAction, saveSlackDestinationAction } from './actions';

type Settings = Awaited<ReturnType<typeof getSlackSettings>>;
type Operation = 'enable' | 'disable' | 'disconnect' | 'test' | 'backfill';
const outcomes: Record<string, string> = { connected: 'Slack is connected. Invite the uier app to a channel, then choose it here.',
    denied: 'The Slack connection was canceled. You can connect again.', failed: 'Slack could not complete the connection. Try connecting again.',
    unavailable: 'Slack is unavailable right now. Try again later.' };

/**
 * Slack for a project, in the order people need it: the status badge, where feedback goes, the one
 * switch people change, then the rare actions under More options. Without a connection it is one button.
 */
export function SlackSection({ projectId, settings, outcome }: { projectId: string; settings: Settings; outcome?: string }) {
    const { t } = useAppI18n();
    const connection = settings.connection;
    const status = slackStatus(settings);
    const connectHref = `${KnownPages.AppSlackConnect}?project=${encodeURIComponent(projectId)}`;
    return <Section id="slack" title={<IntegrationTitle provider="slack" name="Slack" />} description={t("A channel message for each shared feedback thread.")}
        actions={<Badge variant="secondary">{t(status)}</Badge>}>
        <div className="flex flex-col gap-5">
            {outcome && Object.hasOwn(outcomes, outcome) && <p role="status" className="m-0 text-sm text-muted-foreground">{outcomes[outcome]}</p>}
            {!settings.configured && <p className="m-0 text-sm text-muted-foreground">{t("Slack is unavailable on this deployment. A site administrator needs to configure and approve its distribution.")}</p>}
            {connection ? <SlackConnection projectId={projectId} settings={settings} connectHref={connectHref} />
                : settings.configured && <a href={connectHref} className={cn(buttonVariants(), 'w-fit')}>{t("Connect Slack")}<ArrowUpRight data-icon="inline-end" /></a>}
        </div>
    </Section>;
}

function SlackConnection({ projectId, settings, connectHref }: { projectId: string; settings: Settings; connectHref: string }) {
    const { t } = useAppI18n();
    const router = useRouter();
    const connection = settings.connection!;
    const connected = settings.configured && connection.status === 'connected';
    const active = connected && Boolean(connection.channelName);

    // The channel form: open until a channel is chosen, then behind Change channel
    const form = useDestinationForm(Boolean(connection.channelName));
    const [, startLoad] = useTransition();
    const [channels, load, loading] = useActionState(loadSlackChannelsAction, null);
    const [saved, save, saving] = useActionState(async (previous: ActionState, data: FormData) => {
        const response = await saveSlackDestinationAction(previous, data);
        // The form leaves the page with the focus in it, so closing it moves the focus (`useDestinationForm`)
        if (response?.ok) form.close();
        return response;
    }, null);
    const showForm = connected && form.open;
    function toggleForm() {
        if (saving) return;
        if (form.editing) return form.close();
        form.edit();
        // Asking to change the channel is the request to read the workspace's channels
        const data = new FormData(); data.set('projectId', projectId);
        startLoad(() => load(data));
    }

    // On or off, a test message, a backfill and disconnecting
    const [pending, start] = useTransition();
    const [operation, setOperation] = useState<Operation | null>(null);
    const [result, setResult] = useState<ActionState<{ message: string }>>(null);
    const [dialog, setDialog] = useState<'disconnect' | 'backfill' | null>(null);
    const [enabled, setEnabled] = useOptimistic(connection.enabled);
    function change(next: Operation) {
        setOperation(next);
        start(async () => {
            const toggled = next === 'enable' || next === 'disable';
            if (toggled) setEnabled(next === 'enable');
            const form = new FormData(); form.set('projectId', projectId); form.set('operation', next);
            if (next === 'backfill') form.set('confirmBackfill', 'true');
            const response = await manageSlackAction(null, form);
            // The switch and the badge show on and off themselves; say only what nothing else shows
            setResult(response?.ok && toggled ? null : response);
            if (response?.ok) { setDialog(null); router.refresh(); }
        });
    }
    // A connection that was disconnected here has nothing left to manage until it is connected again
    const disconnected = connection.status === 'needs_reconnect' && connection.statusCode === 'disconnected';
    const summaries = connection.replySummaries && connection.statusSummaries ? 'Replies and status changes'
        : connection.replySummaries ? 'Replies' : connection.statusSummaries ? 'Status changes' : 'Off';

    return <>
        {connection.statusCode === 'rate_limit_requires_review' && <Alert role="status">
            <AlertDescription>{t("Slack’s request limit needs a site administrator’s review. Notifications stay paused until it is cleared.")}</AlertDescription>
        </Alert>}
        {connection.needsReviewCount > 0 && <Alert role="status">
            <AlertDescription>{connection.needsReviewCount}{connection.needsReviewCountCapped ? '+' : ''} {t("deliveries need an administrator’s review. An unknown send is held to avoid duplicate notifications.")}</AlertDescription>
        </Alert>}

        <IntegrationDetails ref={form.details}>
            <IntegrationDetail term={t("Workspace")}>{connection.teamName || t('Slack workspace')}</IntegrationDetail>
            {connection.channelName && <>
                <IntegrationDetail term={t("Channel")} action={connected && <ChangeDestinationButton form={form} onClick={toggleForm}>{t("Change channel")}</ChangeDestinationButton>}>
                    #{connection.channelName}
                </IntegrationDetail>
                <IntegrationDetail term={t("Summaries")}>{t(summaries)}</IntegrationDetail>
            </>}
            {connection.lastSyncedAt && <IntegrationDetail term={t("Last delivery")}><DateTime value={connection.lastSyncedAt} /></IntegrationDetail>}
            <BackfillDetail backfill={connection.backfill} />
        </IntegrationDetails>

        {settings.configured && connection.status === 'needs_reconnect' && <a href={connectHref} className={cn(buttonVariants(), 'w-fit')}>
            {t("Reconnect Slack")}<ArrowUpRight data-icon="inline-end" />
        </a>}

        {showForm && <DestinationPanel form={form}>
            <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                    {!connection.channelName && <p className="m-0 text-sm font-medium">{t("Choose a channel")}</p>}
                    <p className="m-0 text-sm text-muted-foreground">{t("Only channels where the uier app is a member are available. Direct messages and Slack Connect channels are excluded.")}</p>
                </div>
                <form action={load}><input type="hidden" name="projectId" value={projectId} />
                    <Button className="w-fit" variant={channels?.ok || connection.channelName ? "outline" : "default"} type="submit" disabled={loading || saving}>
                        {loading ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}{t("Load channels")}</Button>
                </form>
                <FormMessage state={channels} />
                {channels?.ok && channels.data.items.length === 0 && <p className="m-0 text-sm text-muted-foreground">{t("Invite the uier app to a channel in Slack, then load channels again.")}</p>}
            </div>
            {channels?.ok && channels.data.items.length > 0 && <SlackChannelForm key={connection.channelName ?? ''} projectId={projectId} settings={settings}
                channels={channels.data} save={save} saving={saving} error={saved && !saved.ok ? saved : null} onCancel={connection.channelName ? form.close : undefined} />}
        </DestinationPanel>}
        {!showForm && <FormMessage state={saved} />}

        {(connection.enabled || active) && <ConnectionSwitch label={t("Notifications")} description={t("Pause notifications without disconnecting. Existing messages stay.")}
            checked={enabled} disabled={pending} onCheckedChange={on => change(on ? 'enable' : 'disable')} />}

        {active && connection.enabled && <Button type="button" variant="outline" className="w-fit" disabled={pending} onClick={() => change('test')}>
            {pending && operation === 'test' && <Spinner data-icon="inline-start" />}{t("Send a test notification")}
        </Button>}
        <FormMessage state={result?.ok ? { ...result, message: result.data.message } : result} />

        {!disconnected && <MoreOptions>
            <div className="flex flex-wrap gap-2">
                {active && connection.enabled && <Button type="button" variant="outline" disabled={pending || Boolean(connection.backfill && !connection.backfill.done)}
                    onClick={() => setDialog('backfill')}>{t("Send existing feedback to Slack")}</Button>}
                {settings.configured && connection.status !== 'needs_reconnect' && <a href={connectHref} className={buttonVariants({ variant: 'outline' })}>
                    {t("Reconnect Slack")}<ArrowUpRight data-icon="inline-end" />
                </a>}
                <AlertDialog open={dialog !== null} onOpenChange={open => { if (!open) setDialog(null); }}>
                    <AlertDialogTrigger render={<Button type="button" variant="outline" disabled={pending} onClick={() => setDialog('disconnect')} />}>{t("Disconnect Slack")}</AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader><AlertDialogTitle>{dialog === 'backfill' ? t("Send existing feedback to Slack?") : t("Disconnect Slack from this project?")}</AlertDialogTitle>
                            <AlertDialogDescription>{dialog === 'backfill'
                                ? t("Queues up to 100 recent shared threads for this channel. This can create many Slack notifications. Already known messages are kept current.")
                                : t("Stops future notifications from this project. Existing Slack messages remain. Other projects keep their connections.")}</AlertDialogDescription></AlertDialogHeader>
                        <FormMessage state={result && !result.ok ? result : null} />
                        <AlertDialogFooter><AlertDialogCancel disabled={pending}>{t("Cancel")}</AlertDialogCancel>
                            <AlertDialogAction variant={dialog === 'backfill' ? "default" : "outline"} disabled={pending} onClick={() => change(dialog === 'backfill' ? 'backfill' : 'disconnect')}>
                                {pending && <Spinner data-icon="inline-start" />}{dialog === 'backfill' ? t("Send existing feedback") : t("Disconnect Slack")}
                            </AlertDialogAction></AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
            <p className="m-0 text-sm text-muted-foreground">{t("Delivery runs in the background. Changes between runs may be combined. Human Slack replies stay in Slack. To stop channel access, remove the app in Slack.")}</p>
        </MoreOptions>}
    </>;
}

/** The channel and its summaries, saved together; the saved channel is chosen again when the list has it */
function SlackChannelForm({ projectId, settings, channels, save, saving, error, onCancel }: {
    projectId: string;
    settings: Settings;
    channels: { items: { id: string; name: string; private: boolean }[]; truncated: boolean };
    save: (form: FormData) => void;
    saving: boolean;
    error: ActionState;
    onCancel?: () => void;
}) {
    const { t } = useAppI18n();
    const id = useId();
    const connection = settings.connection!;
    const [channelId, setChannelId] = useState(() => channels.items.find(channel => channel.name === connection.channelName)?.id ?? '');
    const channelItems = channels.items.map(channel => ({ value: channel.id, label: `#${channel.name}${channel.private ? ' (private)' : ''}` }));
    return <form action={save} onReset={event => event.preventDefault()}>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="channelId" value={channelId} />
        <FieldGroup>
            <Field data-disabled={saving}>
                <FieldLabel htmlFor={`${id}-channel`}>{t("Channel")}</FieldLabel>
                <Select items={channelItems} value={channelId} onValueChange={value => value !== null && setChannelId(value)} disabled={saving}>
                    <SelectTrigger id={`${id}-channel`}><SelectValue placeholder={t("Choose a channel")} /></SelectTrigger>
                    <SelectContent><SelectGroup>{channelItems.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
                {channels.truncated && <FieldDescription>{t("The channel list is capped. Choices outside this list cannot be selected here.")}</FieldDescription>}
            </Field>
            <Field orientation="horizontal">
                <Checkbox id={`${id}-replies`} name="replySummaries" value="true" defaultChecked={connection.replySummaries} disabled={saving} />
                <FieldContent><FieldLabel htmlFor={`${id}-replies`}>{t("Notify about new replies")}</FieldLabel>
                    <FieldDescription>{t("Send a short reply count in the Slack thread. Edits and deleted replies do not create alerts.")}</FieldDescription></FieldContent>
            </Field>
            <Field orientation="horizontal">
                <Checkbox id={`${id}-status`} name="statusSummaries" value="true" defaultChecked={connection.statusSummaries} disabled={saving} />
                <FieldContent><FieldLabel htmlFor={`${id}-status`}>{t("Notify about status changes")}</FieldLabel>
                    <FieldDescription>{t("Send the current open or done status in the Slack thread.")}</FieldDescription></FieldContent>
            </Field>
            <Field orientation="horizontal">
                <Checkbox id={`${id}-confirm`} name="confirmDestination" value="true" required disabled={saving} />
                <FieldContent><FieldLabel htmlFor={`${id}-confirm`}>{t("Allow shared feedback in this channel")}</FieldLabel>
                    <FieldDescription>{t("Everyone with channel access can read shared excerpts. New destinations start with new feedback; old Slack copies remain. Screenshots stay in uier.")}</FieldDescription></FieldContent>
            </Field>
            <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={saving || !channelId}>{saving && <Spinner data-icon="inline-start" />}{t("Save Slack channel")}</Button>
                    {onCancel && <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>{t("Cancel")}</Button>}
                </div>
                <FormMessage state={error} />
            </div>
        </FieldGroup>
    </form>;
}
