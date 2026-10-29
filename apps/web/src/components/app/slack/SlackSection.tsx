'use client';

import { useActionState, useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
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
import { Section } from '../PageHeader';
import { FormMessage } from '../FormMessage';
import { DateTime } from '../comments/DateTime';
import { loadSlackChannelsAction, manageSlackAction, saveSlackDestinationAction } from './actions';

type Settings = Awaited<ReturnType<typeof getSlackSettings>>;
const outcomes: Record<string, string> = { connected: 'Slack is connected. Invite the uier app to a channel, then choose it here.',
    denied: 'The Slack connection was canceled. You can connect again.', failed: 'Slack could not complete the connection. Try connecting again.',
    unavailable: 'Slack is unavailable right now. Try again later.' };

export function SlackSection({ projectId, settings, outcome }: { projectId: string; settings: Settings; outcome?: string }) {
    const connection = settings.connection;
    const status = !settings.configured ? 'Unavailable' : !connection ? 'Not connected'
        : connection.status === 'needs_reconnect' ? 'Reconnect needed' : connection.status === 'paused' ? 'Waiting for Slack'
        : !connection.channelName ? 'Choose a channel' : connection.enabled ? 'Notifications on' : 'Notifications off';
    return <Section id="slack" title="Slack" description="Send shared feedback to one Slack channel. Existing messages stay current. Optional summaries cover new replies and status changes."
        actions={<Badge variant="secondary">{status}</Badge>}>
        <div className="flex flex-col gap-5">
            {outcome && Object.hasOwn(outcomes, outcome) && <p role="status" className="m-0 text-sm text-muted-foreground">{outcomes[outcome]}</p>}
            {!settings.configured && <p className="m-0 text-sm text-muted-foreground">Slack is unavailable on this deployment. A site administrator needs to configure and approve its distribution.</p>}
            {connection && <>
                <p className="m-0 text-sm text-muted-foreground">Workspace: {connection.teamName || 'Slack workspace'}.
                    {connection.channelName && <> Channel: #{connection.channelName}.</>}</p>
                {connection.lastSyncedAt && <p className="m-0 text-sm text-muted-foreground">Last delivery <DateTime value={connection.lastSyncedAt} />.</p>}
                {connection.statusCode === 'rate_limit_requires_review' && <p role="status" className="m-0 text-sm text-muted-foreground">Slack’s request limit needs a site administrator’s review. Notifications stay paused until it is cleared.</p>}
                {connection.needsReviewCount > 0 && <p role="status" className="m-0 text-sm text-muted-foreground">{connection.needsReviewCount}{connection.needsReviewCountCapped ? '+' : ''} deliveries need an administrator’s review. An unknown send is held to avoid duplicate notifications.</p>}
                {connection.backfill && <p className="m-0 text-sm text-muted-foreground">Backfill: {connection.backfill.queued} of {connection.backfill.total} selected threads queued for delivery. {connection.backfill.done ? 'Queueing is complete.' : 'Queueing continues in the background.'}</p>}
            </>}
            {settings.configured && <>
                <Button asChild variant="outline" className="w-fit"><a href={`${KnownPages.AppSlackConnect}?project=${encodeURIComponent(projectId)}`}>
                    {connection ? 'Reconnect Slack' : 'Connect Slack'}<ArrowUpRight data-icon="inline-end" />
                </a></Button>
                {connection?.status === 'connected' && <SlackDestination projectId={projectId} settings={settings} />}
            </>}
            {connection && <SlackManagement projectId={projectId} settings={settings} />}
        </div>
    </Section>;
}

function SlackDestination({ projectId, settings }: { projectId: string; settings: Settings }) {
    const id = useId();
    const [channels, load, loading] = useActionState(loadSlackChannelsAction, null);
    const [state, save, saving] = useActionState(saveSlackDestinationAction, null);
    const [channelId, setChannelId] = useState('');
    return <FieldGroup>
        <Field>
            <FieldLabel>Slack channels</FieldLabel>
            <FieldDescription>Only channels where the uier app is a member are available. Direct messages and Slack Connect channels are excluded.</FieldDescription>
            <form action={load}><input type="hidden" name="projectId" value={projectId} />
                <Button className="w-fit" variant="outline" type="submit" disabled={loading || saving}>
                    {loading ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}Load channels
                </Button>
            </form>
            <FormMessage state={channels} />
            {channels?.ok && channels.data.items.length === 0 && <FieldDescription>Invite the uier app to a channel in Slack, then load channels again.</FieldDescription>}
        </Field>
        {channels?.ok && channels.data.items.length > 0 && <form action={save} onReset={event => event.preventDefault()}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="channelId" value={channelId} />
            <FieldGroup>
                <Field data-disabled={saving}>
                    <FieldLabel htmlFor={`${id}-channel`}>Channel</FieldLabel>
                    <Select value={channelId} onValueChange={setChannelId} disabled={saving}>
                        <SelectTrigger id={`${id}-channel`}><SelectValue placeholder="Choose a channel" /></SelectTrigger>
                        <SelectContent><SelectGroup>{channels.data.items.map(channel => <SelectItem key={channel.id} value={channel.id}>
                            #{channel.name}{channel.private ? ' (private)' : ''}
                        </SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                    {channels.data.truncated && <FieldDescription>The channel list is capped. Choices outside this list cannot be selected here.</FieldDescription>}
                </Field>
                <Field orientation="horizontal">
                    <Checkbox id={`${id}-replies`} name="replySummaries" value="true" defaultChecked={settings.connection?.replySummaries} disabled={saving} />
                    <FieldContent><FieldLabel htmlFor={`${id}-replies`}>Notify about new replies</FieldLabel>
                        <FieldDescription>Send a short reply count in the Slack thread. Edits and deleted replies do not create alerts.</FieldDescription></FieldContent>
                </Field>
                <Field orientation="horizontal">
                    <Checkbox id={`${id}-status`} name="statusSummaries" value="true" defaultChecked={settings.connection?.statusSummaries} disabled={saving} />
                    <FieldContent><FieldLabel htmlFor={`${id}-status`}>Notify about status changes</FieldLabel>
                        <FieldDescription>Send the current open or done status in the Slack thread.</FieldDescription></FieldContent>
                </Field>
                <Field orientation="horizontal">
                    <Checkbox id={`${id}-confirm`} name="confirmDestination" value="true" required disabled={saving} />
                    <FieldContent><FieldLabel htmlFor={`${id}-confirm`}>Allow shared feedback in this channel</FieldLabel>
                        <FieldDescription>Everyone with channel access can read shared excerpts. New destinations start with new feedback; old Slack copies remain. Screenshots stay in uier.</FieldDescription></FieldContent>
                </Field>
                <Field><Button className="w-fit" type="submit" disabled={saving || !channelId}>
                    {saving && <Spinner data-icon="inline-start" />}Save Slack channel
                </Button><FormMessage state={state} /></Field>
            </FieldGroup>
        </form>}
    </FieldGroup>;
}

function SlackManagement({ projectId, settings }: { projectId: string; settings: Settings }) {
    const router = useRouter();
    const [pending, start] = useTransition();
    const [result, setResult] = useState<ActionState<{ message: string }>>(null);
    const [dialog, setDialog] = useState<'disconnect' | 'backfill' | null>(null);
    const connection = settings.connection!;
    const active = settings.configured && connection.status === 'connected' && Boolean(connection.channelName);
    function change(operation: 'enable' | 'disable' | 'disconnect' | 'test' | 'backfill') {
        start(async () => {
            const form = new FormData(); form.set('projectId', projectId); form.set('operation', operation);
            if (operation === 'backfill') form.set('confirmBackfill', 'true');
            const response = await manageSlackAction(null, form); setResult(response);
            if (response?.ok) { setDialog(null); router.refresh(); }
        });
    }
    return <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
            {(connection.enabled || active) && <Button type="button" variant="outline" disabled={pending} onClick={() => change(connection.enabled ? 'disable' : 'enable')}>
                {pending && <Spinner data-icon="inline-start" />}{connection.enabled ? 'Turn Slack notifications off' : 'Turn Slack notifications on'}
            </Button>}
            {active && connection.enabled && <>
                <Button type="button" variant="outline" disabled={pending} onClick={() => change('test')}>Send a test notification</Button>
                <Button type="button" variant="outline" disabled={pending || Boolean(connection.backfill && !connection.backfill.done)} onClick={() => setDialog('backfill')}>Send existing feedback to Slack</Button>
            </>}
            <AlertDialog open={dialog !== null} onOpenChange={open => { if (!open) setDialog(null); }}>
                <AlertDialogTrigger asChild><Button type="button" variant="outline" disabled={pending} onClick={() => setDialog('disconnect')}>Disconnect Slack</Button></AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>{dialog === 'backfill' ? 'Send existing feedback to Slack?' : 'Disconnect Slack from this project?'}</AlertDialogTitle>
                        <AlertDialogDescription>{dialog === 'backfill'
                            ? 'Queues up to 100 recent shared threads for this channel. This can create many Slack notifications. Already known messages are kept current.'
                            : 'Stops future notifications from this project. Existing Slack messages remain. Other projects keep their connections.'}</AlertDialogDescription></AlertDialogHeader>
                    <FormMessage state={result && !result.ok ? result : null} />
                    <AlertDialogFooter><AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                        <AlertDialogAction variant={dialog === 'backfill' ? 'default' : 'outline'} disabled={pending} onClick={event => { event.preventDefault(); change(dialog === 'backfill' ? 'backfill' : 'disconnect'); }}>
                            {pending && <Spinner data-icon="inline-start" />}{dialog === 'backfill' ? 'Send existing feedback' : 'Disconnect Slack'}
                        </AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
        <FormMessage state={result?.ok ? { ...result, message: result.data.message } : result} />
        <p className="m-0 text-sm text-muted-foreground">Delivery runs in the background. Changes between runs may be combined. Human Slack replies stay in Slack. To stop channel access, remove the app in Slack.</p>
    </div>;
}
