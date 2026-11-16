'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useActionState, useId, useState, useTransition } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/src/components/ui/alert';
import { Badge } from '@/src/components/ui/badge';
import { cn } from 'cn';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/src/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { Spinner } from '@/src/components/ui/spinner';
import type { ActionState } from '@/src/lib/app/actionResult';
import type { getLinearSettings } from '@/src/lib/integrations/linear';
import { DateTime } from '../comments/DateTime';
import { FormMessage } from '../FormMessage';
import { BackfillDetail, ConnectionControls, ConnectionNote } from '../integrations/ConnectionControls';
import { ChangeDestinationButton, DestinationPanel, useDestinationForm } from '../integrations/DestinationForm';
import { IntegrationDetail, IntegrationDetails } from '../integrations/IntegrationDetails';
import { IntegrationTitle } from '../integrations/IntegrationLogo';
import { linearStatus } from '../integrations/projectIntegrations';
import { Section } from '../PageHeader';
import { loadLinearDestinationOptionsAction, loadLinearTeamsAction, manageLinearAction, saveLinearDestinationAction } from './actions';

type Settings = Awaited<ReturnType<typeof getLinearSettings>>;
type Teams = Awaited<ReturnType<typeof loadLinearTeamsAction>>;
type LoadedOptions = Awaited<ReturnType<typeof loadLinearDestinationOptionsAction>>;
type Options = Extract<NonNullable<LoadedOptions>, { ok: true }>['data'];
type Option = { id: string; name: string; type?: string };

const outcomes: Record<string, string> = {
    connected: 'Linear is connected. Choose a team and workflow states to start syncing.',
    denied: 'The Linear connection was canceled. You can connect again.',
    failed: 'Linear could not complete the connection. Try connecting again.',
    unavailable: 'Linear is unavailable right now. Try again later.'
};

/**
 * Linear for a project, in the order of Slack's card: the status badge, where issues go, the Sync switch,
 * then the rare actions under More options. Without a connection it is one button.
 */
export function LinearSection({ projectId, settings, outcome }: { projectId: string; settings: Settings; outcome?: string }) {
    const { t } = useAppI18n();
    const notice = outcome && Object.hasOwn(outcomes, outcome) ? outcomes[outcome] : undefined;
    const status = linearStatus(settings);
    const connectHref = `/app/linear/connect?project=${encodeURIComponent(projectId)}`;
    return <Section id="linear" title={<IntegrationTitle provider="linear" name="Linear" />} description={t("Create one Linear issue for each shared feedback thread. uier keeps the issue and its discussion up to date.")}
        actions={<Badge variant="secondary">{t(status)}</Badge>}>
        <div className="flex flex-col gap-5">
            {notice && !(outcome === 'connected' && settings.teamId) && <p role="status" className="m-0 text-sm text-muted-foreground">{notice}</p>}
            {!settings.configured && <p className="m-0 text-sm text-muted-foreground">{t("Linear is unavailable on this deployment. A site administrator needs to configure it.")}</p>}
            {settings.connected ? <LinearConnection projectId={projectId} settings={settings} connectHref={connectHref} />
                : settings.configured && <a href={connectHref} className={cn(buttonVariants(), 'w-fit')}>
                    {settings.status === 'needs_reconnect' ? t("Reconnect Linear") : t("Connect Linear")}<ArrowUpRight data-icon="inline-end" />
                </a>}
        </div>
    </Section>;
}

function LinearConnection({ projectId, settings, connectHref }: { projectId: string; settings: Settings; connectHref: string }) {
    const { t } = useAppI18n();
    const needsReconnect = settings.status === 'needs_reconnect';
    const usable = settings.configured && !needsReconnect;
    const canSync = settings.configured && Boolean(settings.teamId) && settings.status === 'connected';

    // The destination form: open until a team is saved, then behind Change destination
    const form = useDestinationForm(Boolean(settings.teamId));
    const [, startLoad] = useTransition();
    const [teams, loadTeams, loadingTeams] = useActionState(loadLinearTeamsAction, null);
    const [options, loadOptions, loadingOptions] = useActionState(loadLinearDestinationOptionsAction, null);
    const [saved, save, saving] = useActionState(async (previous: ActionState, data: FormData) => {
        const response = await saveLinearDestinationAction(previous, data);
        if (response?.ok) form.close();
        return response;
    }, null);
    function toggleForm() {
        if (saving) return;
        if (form.editing) return form.close();
        form.edit();
        // Asking to change the destination is the request to read the teams and the saved team's choices
        const team = new FormData(); team.set('projectId', projectId); team.set('teamId', settings.teamId!);
        startLoad(() => { loadTeams(team); loadOptions(team); });
    }

    return <>
        {settings.needsReviewCount > 0 && <Alert>
            <AlertTitle>{t("Some threads need review")}</AlertTitle>
            <AlertDescription>{settings.needsReviewCount}{settings.needsReviewCountCapped ? '+' : ''} {t("threads could not be confirmed in Linear. Check the existing Linear copies before requesting a backfill. uier keeps uncertain issue identities to avoid creating duplicates.")}</AlertDescription>
        </Alert>}

        <IntegrationDetails ref={form.details}>
            {settings.organizationName && <IntegrationDetail term={t("Organization")}>{settings.organizationName}</IntegrationDetail>}
            {settings.teamId && <>
                <IntegrationDetail term={t("Destination")} action={usable && <ChangeDestinationButton form={form} onClick={toggleForm}>{t("Change destination")}</ChangeDestinationButton>}>
                    {settings.teamName ?? t('Saved team')}{settings.projectName ? t(" / {value1}", { value1: settings.projectName }) : ''}
                </IntegrationDetail>
                <IntegrationDetail term={t("Screenshots")}>{settings.screenshots ? t("On") : t("Off")}</IntegrationDetail>
            </>}
            {settings.lastSyncedAt && <IntegrationDetail term={t("Last synced")}><DateTime value={settings.lastSyncedAt} /></IntegrationDetail>}
            {settings.pausedUntil && <IntegrationDetail term={t("Requests resume")}><DateTime value={settings.pausedUntil} /></IntegrationDetail>}
            <BackfillDetail backfill={settings.backfill} />
        </IntegrationDetails>

        {settings.configured && needsReconnect && <a href={connectHref} className={cn(buttonVariants(), 'w-fit')}>{t("Reconnect Linear")}<ArrowUpRight data-icon="inline-end" /></a>}

        {usable && form.open && <DestinationPanel form={form}>
            <LinearDestination projectId={projectId} settings={settings} teams={teams} loadTeams={loadTeams} loadingTeams={loadingTeams}
                options={options} loadOptions={loadOptions} loadingOptions={loadingOptions}
                save={save} saving={saving} error={saved && !saved.ok ? saved : null} onCancel={settings.teamId ? form.close : undefined} />
        </DestinationPanel>}
        {!form.open && <FormMessage state={saved} />}

        <ConnectionControls projectId={projectId} manage={manageLinearAction}
            sync={settings.enabled || canSync ? { checked: settings.enabled } : undefined}
            backfill={canSync && settings.enabled ? { label: t("Backfill existing feedback"), queueing: Boolean(settings.backfill && !settings.backfill.done) } : undefined}
            disconnect={{ label: t("Disconnect Linear"), title: t("Disconnect Linear from this project?"),
                description: t("Stops future sync from this project. Existing issues, comments and files remain in Linear. Other projects keep their connections.") }}>
            {canSync && <ConnectionNote>{t("Backfill selects up to 1,000 existing shared threads for this Linear destination. New feedback syncs automatically while sync is on.")}</ConnectionNote>}
        </ConnectionControls>
    </>;
}

/** The team, then that team's choices. The lists are read from Linear only when asked for */
function LinearDestination({ projectId, settings, teams, loadTeams, loadingTeams, options: loaded, loadOptions, loadingOptions, save, saving, error, onCancel }: {
    projectId: string;
    settings: Settings;
    teams: Teams;
    loadTeams: (form: FormData) => void;
    loadingTeams: boolean;
    options: LoadedOptions;
    loadOptions: (form: FormData) => void;
    loadingOptions: boolean;
    save: (form: FormData) => void;
    saving: boolean;
    error: ActionState;
    onCancel?: () => void;
}) {
    const { t } = useAppI18n();
    const formId = useId();
    const [, startLoad] = useTransition();
    const [teamId, setTeamId] = useState(settings.teamId ?? '');
    const choices = teams?.ok ? teams.data.items : [];
    const teamOptions = settings.teamId && !choices.some(item => item.id === settings.teamId)
        ? [{ id: settings.teamId, name: settings.teamName ?? t('Saved team') }, ...choices] : choices;
    const options = loaded?.ok && loaded.data.teamId === teamId ? loaded.data : undefined;
    const busy = loadingTeams || loadingOptions || saving;
    return <FieldGroup>
        <Field>
            <FieldLabel>{t("Linear teams")}</FieldLabel>
            <FieldDescription>{t("Load the teams available to the connected Linear app. This only reads your Linear choices.")}</FieldDescription>
            <form action={loadTeams}>
                <input type="hidden" name="projectId" value={projectId} />
                <Button type="submit" variant={teams?.ok || settings.teamId ? "outline" : "default"} disabled={busy}>
                    {loadingTeams ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}{t("Load teams")}{' '}</Button>
            </form>
            <FormMessage state={teams} />
            {teams?.ok && teams.data.items.length === 0 && <FieldDescription>{t("No teams are available to this Linear app. Check its access in Linear.")}</FieldDescription>}
            {teams?.ok && teams.data.truncated && <FieldDescription>{t("Only the first 500 teams are shown. A team outside this list cannot be selected here.")}</FieldDescription>}
        </Field>
        {teamOptions.length > 0 && <form onSubmit={event => {
            event.preventDefault(); const data = new FormData(event.currentTarget); startLoad(() => loadOptions(data));
        }}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="teamId" value={teamId} />
            <FieldGroup>
                <Field>
                    <FieldLabel htmlFor={`${formId}-team`}>{t("Team")}</FieldLabel>
                    <Select items={teamOptions.map(item => ({ value: item.id, label: item.name }))} value={teamId} onValueChange={value => value !== null && setTeamId(value)} disabled={loadingOptions || saving}>
                        <SelectTrigger id={`${formId}-team`}><SelectValue placeholder={t("Choose a team")} /></SelectTrigger>
                        <SelectContent><SelectGroup>{teamOptions.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                    <FieldDescription>{t("Load this team’s projects, workflow states and labels before saving.")}</FieldDescription>
                </Field>
                <div className="flex flex-col items-start gap-3">
                    <Button type="submit" variant="outline" disabled={!teamId || busy}>
                        {loadingOptions && <Spinner data-icon="inline-start" />}{t("Load team options")}{' '}</Button>
                    <FormMessage state={loaded} />
                </div>
            </FieldGroup>
        </form>}
        {options ? <LinearDestinationForm key={options.teamId} projectId={projectId} settings={settings} options={options} save={save} pending={saving} error={error} onCancel={onCancel} />
            : onCancel && <Button type="button" variant="ghost" className="w-fit" disabled={saving} onClick={onCancel}>{t("Cancel")}</Button>}
    </FieldGroup>;
}

/** The saved choices come back in the form when its team is the saved one */
function LinearDestinationForm({ projectId, settings, options, save, pending, error, onCancel }: {
    projectId: string; settings: Settings; options: Options; save: (form: FormData) => void; pending: boolean; error: ActionState; onCancel?: () => void;
}) {
    const { t } = useAppI18n();
    const id = useId();
    const sameTeam = settings.teamId === options.teamId;
    const initialChoice = (items: Option[], value?: string) => sameTeam && items.some(item => item.id === value) ? value! : '';
    const openStates = options.states.items.filter(item => ['triage', 'backlog', 'unstarted', 'started'].includes(item.type ?? ''));
    const doneStates = options.states.items.filter(item => ['completed', 'canceled'].includes(item.type ?? ''));
    const [openState, setOpenState] = useState(() => initialChoice(openStates, settings.openStateId));
    const [doneState, setDoneState] = useState(() => initialChoice(doneStates, settings.doneStateId));
    const [linearProject, setLinearProject] = useState(() => initialChoice(options.projects.items, settings.linearProjectId) || 'none');
    const projectItems = [{ value: 'none', label: t("No Linear project") }, ...options.projects.items.map(item => ({ value: item.id, label: item.name }))];
    return <form action={save} onReset={event => event.preventDefault()}>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="teamId" value={options.teamId} />
        <input type="hidden" name="linearProjectId" value={linearProject === 'none' ? '' : linearProject} />
        <input type="hidden" name="openStateId" value={openState} />
        <input type="hidden" name="doneStateId" value={doneState} />
        <FieldGroup>
            <Field>
                <FieldLabel htmlFor={`${id}-project`}>{t("Linear project (optional)")}</FieldLabel>
                <Select items={projectItems} value={linearProject} onValueChange={value => value !== null && setLinearProject(value)} disabled={pending}>
                    <SelectTrigger id={`${id}-project`}><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup>{projectItems.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
            </Field>
            <StateChoice id={`${id}-open`} label={t("State for open feedback")} choices={openStates} value={openState} onChange={setOpenState} disabled={pending} />
            <StateChoice id={`${id}-done`} label={t("State for done feedback")} choices={doneStates} value={doneState} onChange={setDoneState} disabled={pending} />
            {(!openStates.length || !doneStates.length) && <FieldDescription>{t("This team needs an open workflow state and a completed or canceled state in Linear before it can be saved.")}</FieldDescription>}
            {options.labels.items.length > 0 && <FieldSet disabled={pending}>
                <FieldLegend variant="label">{t("Labels (optional)")}</FieldLegend>
                <FieldDescription>{t("Choose up to 20 existing labels for uier issues. Other labels on the issues are kept.")}</FieldDescription>
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
                    <FieldLabel htmlFor={`${id}-screenshots`}>{t("Include screenshots")}</FieldLabel>
                    <FieldDescription>{t("Uploads the current screenshot to Linear. Linear’s copies and retained files follow its own access and retention settings.")}</FieldDescription>
                </FieldContent>
            </Field>
            {(options.projects.truncated || options.states.truncated || options.labels.truncated) && <FieldDescription>{t("Only the first 500 choices in each list are shown. Missing choices cannot be saved here.")}</FieldDescription>}
            <FieldDescription>{t("Saving turns sync on for shared feedback. Changing the team or Linear project starts new issue identities. Existing Linear copies stay in their previous destination.")}</FieldDescription>
            <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={pending || !openState || !doneState}>
                        {pending && <Spinner data-icon="inline-start" />}{t("Save Linear destination")}{' '}</Button>
                    {onCancel && <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>{t("Cancel")}</Button>}
                </div>
                <FormMessage state={error} />
            </div>
        </FieldGroup>
    </form>;
}

function StateChoice({ id, label, choices, value, onChange, disabled }: { id: string; label: string; choices: Option[]; value: string; onChange: (value: string) => void; disabled: boolean }) {
    const { t } = useAppI18n();
    return <Field data-disabled={disabled}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Select items={choices.map(item => ({ value: item.id, label: item.name }))} value={value} onValueChange={next => next !== null && onChange(next)} disabled={disabled || choices.length === 0}>
            <SelectTrigger id={id}><SelectValue placeholder={t("Choose a workflow state")} /></SelectTrigger>
            <SelectContent><SelectGroup>{choices.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
    </Field>;
}
