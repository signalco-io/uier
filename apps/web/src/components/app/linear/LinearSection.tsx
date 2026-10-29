'use client';

import { useActionState, useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/src/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/src/components/ui/alert-dialog';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/src/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { Spinner } from '@/src/components/ui/spinner';
import type { ActionState } from '@/src/lib/app/actionResult';
import type { getLinearSettings } from '@/src/lib/integrations/linear';
import { DateTime } from '../comments/DateTime';
import { FormMessage } from '../FormMessage';
import { Section } from '../PageHeader';
import { loadLinearDestinationOptionsAction, loadLinearTeamsAction, manageLinearAction, saveLinearDestinationAction } from './actions';

type Settings = Awaited<ReturnType<typeof getLinearSettings>>;
type Options = Extract<NonNullable<Awaited<ReturnType<typeof loadLinearDestinationOptionsAction>>>, { ok: true }>['data'];
type Option = { id: string; name: string; type?: string };

const outcomes: Record<string, string> = {
    connected: 'Linear is connected. Choose a team and workflow states to start syncing.',
    denied: 'The Linear connection was canceled. You can connect again.',
    failed: 'Linear could not complete the connection. Try connecting again.',
    unavailable: 'Linear is unavailable right now. Try again later.'
};

export function LinearSection({ projectId, settings, outcome }: { projectId: string; settings: Settings; outcome?: string }) {
    const notice = outcome && Object.hasOwn(outcomes, outcome) ? outcomes[outcome] : undefined;
    const status = !settings.configured ? 'Unavailable' : !settings.connected ? 'Not connected'
        : settings.status === 'needs_reconnect' ? 'Reconnect needed' : settings.status === 'paused' || settings.pausedUntil ? 'Waiting for Linear'
        : !settings.teamId ? 'Choose a destination' : settings.enabled ? 'Sync on' : 'Sync off';
    return <Section id="linear" title="Linear" description="Create one Linear issue for each shared feedback thread. uier keeps the issue and its discussion up to date."
        actions={<Badge variant="secondary">{status}</Badge>}>
        <div className="flex flex-col gap-5">
            {notice && <p role="status" className="m-0 text-sm text-muted-foreground">{notice}</p>}
            {!settings.configured ? <p className="m-0 text-sm text-muted-foreground">Linear is unavailable on this deployment. A site administrator needs to configure it.</p>
                : <>
                    {settings.organizationName && <p className="m-0 text-sm">Connected organization: {settings.organizationName}.</p>}
                    {(!settings.connected || settings.status === 'needs_reconnect') && <Button asChild className="w-fit">
                        <a href={`/app/linear/connect?project=${encodeURIComponent(projectId)}`}>
                            <ArrowUpRight data-icon="inline-start" />{settings.status === 'needs_reconnect' ? 'Reconnect Linear' : 'Connect Linear'}
                        </a>
                    </Button>}
                    {settings.connected && settings.status !== 'needs_reconnect' && <>
                        <LinearDestination key={`${settings.teamId}:${settings.linearProjectId}:${settings.openStateId}:${settings.doneStateId}:${settings.labelIds.join(',')}:${settings.screenshots}`}
                            projectId={projectId} settings={settings} />
                        {settings.teamId && <p className="m-0 text-sm text-muted-foreground">Destination: {settings.teamName ?? 'Saved team'}{settings.projectName ? ` / ${settings.projectName}` : ''}. Screenshots are {settings.screenshots ? 'on' : 'off'}.</p>}
                    </>}
                </>}
            {settings.lastSyncedAt && <p className="m-0 text-sm text-muted-foreground">Last synced <DateTime value={settings.lastSyncedAt} />.</p>}
            {settings.pausedUntil && <p className="m-0 text-sm text-muted-foreground">Linear requests resume after <DateTime value={settings.pausedUntil} />.</p>}
            {settings.needsReviewCount > 0 && <Alert>
                <AlertTitle>Some threads need review</AlertTitle>
                <AlertDescription>{settings.needsReviewCount}{settings.needsReviewCountCapped ? '+' : ''} threads could not be confirmed in Linear. Check the existing Linear copies before requesting a backfill. uier keeps uncertain issue identities to avoid creating duplicates.</AlertDescription>
            </Alert>}
            {settings.backfill && <p role="status" className="m-0 text-sm text-muted-foreground">
                Backfill: {settings.backfill.queued} of {settings.backfill.total} selected threads queued for delivery.
                {settings.backfill.done && ' Queueing is complete. Delivery continues in the background.'}
            </p>}
            {settings.connected && <LinearManagement projectId={projectId} settings={settings} />}
        </div>
    </Section>;
}

function LinearDestination({ projectId, settings }: { projectId: string; settings: Settings }) {
    const formId = useId();
    const [, startLoad] = useTransition();
    const [teams, loadTeams, loadingTeams] = useActionState(loadLinearTeamsAction, null);
    const [details, loadDetails, loadingDetails] = useActionState(loadLinearDestinationOptionsAction, null);
    const [teamId, setTeamId] = useState(settings.teamId ?? '');
    const choices = teams?.ok ? teams.data.items : [];
    const teamOptions = settings.teamId && !choices.some(item => item.id === settings.teamId)
        ? [{ id: settings.teamId, name: settings.teamName ?? 'Saved team' }, ...choices] : choices;
    const options = details?.ok && details.data.teamId === teamId ? details.data : undefined;
    return <FieldGroup>
        <Field>
            <FieldLabel>Linear teams</FieldLabel>
            <FieldDescription>Load the teams available to the connected Linear app. This only reads your Linear choices.</FieldDescription>
            <form action={loadTeams}>
                <input type="hidden" name="projectId" value={projectId} />
                <Button type="submit" variant="outline" disabled={loadingTeams || loadingDetails}>
                    {loadingTeams ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}Load teams
                </Button>
            </form>
            <FormMessage state={teams} />
            {teams?.ok && teams.data.items.length === 0 && <FieldDescription>No teams are available to this Linear app. Check its access in Linear.</FieldDescription>}
            {teams?.ok && teams.data.truncated && <FieldDescription>Only the first 500 teams are shown. A team outside this list cannot be selected here.</FieldDescription>}
        </Field>
        {teamOptions.length > 0 && <form onSubmit={event => {
            event.preventDefault(); const data = new FormData(event.currentTarget); startLoad(() => loadDetails(data));
        }}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="teamId" value={teamId} />
            <FieldGroup>
                <Field>
                    <FieldLabel htmlFor={`${formId}-team`}>Team</FieldLabel>
                    <Select value={teamId} onValueChange={setTeamId} disabled={loadingDetails}>
                        <SelectTrigger id={`${formId}-team`}><SelectValue placeholder="Choose a team" /></SelectTrigger>
                        <SelectContent><SelectGroup>{teamOptions.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                    <FieldDescription>Load this team’s projects, workflow states and labels before saving.</FieldDescription>
                </Field>
                <Field>
                    <Button className="w-fit" type="submit" variant="outline" disabled={!teamId || loadingDetails || loadingTeams}>
                        {loadingDetails && <Spinner data-icon="inline-start" />}Load team options
                    </Button>
                    <FormMessage state={details} />
                </Field>
            </FieldGroup>
        </form>}
        {options && <LinearDestinationForm key={options.teamId} projectId={projectId} settings={settings} options={options} />}
    </FieldGroup>;
}

function LinearDestinationForm({ projectId, settings, options }: { projectId: string; settings: Settings; options: Options }) {
    const id = useId();
    const [state, save, pending] = useActionState(saveLinearDestinationAction, null);
    const sameTeam = settings.teamId === options.teamId;
    const initialChoice = (items: Option[], value?: string) => sameTeam && items.some(item => item.id === value) ? value! : '';
    const openStates = options.states.items.filter(item => ['triage', 'backlog', 'unstarted', 'started'].includes(item.type ?? ''));
    const doneStates = options.states.items.filter(item => ['completed', 'canceled'].includes(item.type ?? ''));
    const [openState, setOpenState] = useState(() => initialChoice(openStates, settings.openStateId));
    const [doneState, setDoneState] = useState(() => initialChoice(doneStates, settings.doneStateId));
    const [linearProject, setLinearProject] = useState(() => initialChoice(options.projects.items, settings.linearProjectId) || 'none');
    return <form action={save} onReset={event => event.preventDefault()}>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="teamId" value={options.teamId} />
        <input type="hidden" name="linearProjectId" value={linearProject === 'none' ? '' : linearProject} />
        <input type="hidden" name="openStateId" value={openState} />
        <input type="hidden" name="doneStateId" value={doneState} />
        <FieldGroup>
            <Field>
                <FieldLabel htmlFor={`${id}-project`}>Linear project (optional)</FieldLabel>
                <Select value={linearProject} onValueChange={setLinearProject} disabled={pending}>
                    <SelectTrigger id={`${id}-project`}><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup><SelectItem value="none">No Linear project</SelectItem>
                        {options.projects.items.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                    </SelectGroup></SelectContent>
                </Select>
            </Field>
            <StateChoice id={`${id}-open`} label="State for open feedback" choices={openStates} value={openState} onChange={setOpenState} disabled={pending} />
            <StateChoice id={`${id}-done`} label="State for done feedback" choices={doneStates} value={doneState} onChange={setDoneState} disabled={pending} />
            {(!openStates.length || !doneStates.length) && <FieldDescription>This team needs an open workflow state and a completed or canceled state in Linear before it can be saved.</FieldDescription>}
            {options.labels.items.length > 0 && <FieldSet disabled={pending}>
                <FieldLegend variant="label">Labels (optional)</FieldLegend>
                <FieldDescription>Choose up to 20 existing labels for uier issues. Other labels on the issues are kept.</FieldDescription>
                <FieldGroup>
                    {options.labels.items.map(label => <Field key={label.id} orientation="horizontal">
                        <Checkbox id={`${id}-${label.id}`} name="labelId" value={label.id} defaultChecked={sameTeam && settings.labelIds.includes(label.id)} />
                        <FieldLabel htmlFor={`${id}-${label.id}`}>{label.name}</FieldLabel>
                    </Field>)}
                </FieldGroup>
            </FieldSet>}
            <Field orientation="horizontal" data-disabled={pending}>
                <Checkbox id={`${id}-screenshots`} name="screenshots" value="true" defaultChecked={settings.screenshots} disabled={pending} />
                <FieldContent>
                    <FieldLabel htmlFor={`${id}-screenshots`}>Include screenshots</FieldLabel>
                    <FieldDescription>Uploads the current screenshot to Linear. Linear’s copies and retained files follow its own access and retention settings.</FieldDescription>
                </FieldContent>
            </Field>
            {(options.projects.truncated || options.states.truncated || options.labels.truncated) && <FieldDescription>Only the first 500 choices in each list are shown. Missing choices cannot be saved here.</FieldDescription>}
            <FieldDescription>Saving turns sync on for shared feedback. Changing the team or Linear project starts new issue identities. Existing Linear copies stay in their previous destination.</FieldDescription>
            <Field>
                <Button className="w-fit" type="submit" disabled={pending || !openState || !doneState}>
                    {pending && <Spinner data-icon="inline-start" />}Save Linear destination
                </Button>
                <FormMessage state={state} />
            </Field>
        </FieldGroup>
    </form>;
}

function StateChoice({ id, label, choices, value, onChange, disabled }: { id: string; label: string; choices: Option[]; value: string; onChange: (value: string) => void; disabled: boolean }) {
    return <Field data-disabled={disabled}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Select value={value} onValueChange={onChange} disabled={disabled || choices.length === 0}>
            <SelectTrigger id={id}><SelectValue placeholder="Choose a workflow state" /></SelectTrigger>
            <SelectContent><SelectGroup>{choices.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
    </Field>;
}

function LinearManagement({ projectId, settings }: { projectId: string; settings: Settings }) {
    const router = useRouter();
    const [state, setState] = useState<ActionState<{ message: string }>>(null);
    const [pending, startTransition] = useTransition();
    const [confirming, setConfirming] = useState(false);
    function change(operation: 'enable' | 'disable' | 'disconnect' | 'backfill') {
        startTransition(async () => {
            const form = new FormData();
            form.set('projectId', projectId);
            form.set('operation', operation);
            const result = await manageLinearAction(null, form);
            setState(result);
            if (result?.ok) { setConfirming(false); router.refresh(); }
        });
    }
    const canSync = settings.configured && Boolean(settings.teamId) && settings.status === 'connected';
    return <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
            {(settings.enabled || canSync) && <Button type="button" variant="outline" disabled={pending} onClick={() => change(settings.enabled ? 'disable' : 'enable')}>
                {pending && <Spinner data-icon="inline-start" />}{settings.enabled ? 'Turn sync off' : 'Turn sync on'}
            </Button>}
            {canSync && settings.enabled && <Button type="button" variant="outline" disabled={pending || Boolean(settings.backfill && !settings.backfill.done)} onClick={() => change('backfill')}>
                Backfill existing feedback
            </Button>}
            <AlertDialog open={confirming} onOpenChange={setConfirming}>
                <AlertDialogTrigger asChild><Button type="button" variant="outline" disabled={pending}>Disconnect Linear</Button></AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Disconnect Linear from this project?</AlertDialogTitle>
                        <AlertDialogDescription>Stops future sync from this project. Existing issues, comments and files remain in Linear. Other projects keep their connections.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <FormMessage state={state && !state.ok ? state : null} />
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={pending}>Keep connected</AlertDialogCancel>
                        <AlertDialogAction variant="outline" disabled={pending} onClick={event => { event.preventDefault(); change('disconnect'); }}>
                            {pending && <Spinner data-icon="inline-start" />}Disconnect Linear
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
        {canSync && <p className="m-0 text-sm text-muted-foreground">Backfill selects up to 1,000 existing shared threads for this Linear destination. New feedback syncs automatically while sync is on.</p>}
        <FormMessage state={state?.ok ? { ...state, message: state.data.message } : state} />
    </div>;
}
