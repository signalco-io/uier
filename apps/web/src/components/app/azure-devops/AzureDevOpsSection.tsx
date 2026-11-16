'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useActionState, useId, useState, useTransition, type FormEvent } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/src/components/ui/alert';
import { Badge } from '@/src/components/ui/badge';
import { cn } from 'cn';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { Spinner } from '@/src/components/ui/spinner';
import type { ActionState } from '@/src/lib/app/actionResult';
import type { getAzureDevOpsSettings } from '@/src/lib/integrations/azure-devops';
import { doneCategories, openCategories, type AzureDevOpsProjectOptions } from '@/src/lib/integrations/azure-devops/model';
import { DateTime } from '../comments/DateTime';
import { FormMessage } from '../FormMessage';
import { BackfillDetail, ConnectionControls, ConnectionNote } from '../integrations/ConnectionControls';
import { ChangeDestinationButton, DestinationPanel, useDestinationForm } from '../integrations/DestinationForm';
import { IntegrationDetail, IntegrationDetails } from '../integrations/IntegrationDetails';
import { IntegrationTitle } from '../integrations/IntegrationLogo';
import { azureDevOpsStatus } from '../integrations/projectIntegrations';
import { Section } from '../PageHeader';
import { loadAzureDevOpsOrganizationsAction, loadAzureDevOpsProjectOptionsAction, loadAzureDevOpsProjectsAction,
    manageAzureDevOpsAction, saveAzureDevOpsDestinationAction } from './actions';

type Settings = Awaited<ReturnType<typeof getAzureDevOpsSettings>>;
type Organizations = Awaited<ReturnType<typeof loadAzureDevOpsOrganizationsAction>>;
type Projects = Awaited<ReturnType<typeof loadAzureDevOpsProjectsAction>>;
type LoadedOptions = Awaited<ReturnType<typeof loadAzureDevOpsProjectOptionsAction>>;
type Option = { id: string; name: string };
/** Area paths are trimmed, so a leading space can never collide with one. */
const DEFAULT_AREA = ' default';

const outcomes: Record<string, string> = {
    connected: 'Azure DevOps is connected. Choose an organization, project and work item type to start syncing.',
    denied: 'The Azure DevOps connection was canceled. You can connect again.',
    failed: 'Azure DevOps could not complete the connection. Try connecting again.',
    unavailable: 'Azure DevOps is unavailable right now. Try again later.'
};

/**
 * Azure DevOps for a project, in the order of Slack's card: the status badge, where work items go, the Sync
 * switch, then the rare actions under More options. Without a connection it is one button.
 */
export function AzureDevOpsSection({ projectId, settings, outcome }: { projectId: string; settings: Settings; outcome?: string }) {
    const { t } = useAppI18n();
    const notice = outcome && Object.hasOwn(outcomes, outcome) ? outcomes[outcome] : undefined;
    const status = azureDevOpsStatus(settings);
    const connectHref = `/app/azure-devops/connect?project=${encodeURIComponent(projectId)}`;
    return <Section id="azure-devops" title={<IntegrationTitle provider="azure-devops" name="Azure DevOps" />} description={t("Create one Azure Boards work item for each shared feedback thread. uier keeps its description, discussion and state up to date.")}
        actions={<Badge variant="secondary">{t(status)}</Badge>}>
        <div className="flex flex-col gap-5">
            {notice && !(outcome === 'connected' && settings.azureProjectId) && <p role="status" className="m-0 text-sm text-muted-foreground">{notice}</p>}
            {!settings.configured && <p className="m-0 text-sm text-muted-foreground">{t("Azure DevOps is unavailable on this deployment. A site administrator needs to configure it.")}</p>}
            {settings.connected ? <AzureDevOpsConnection projectId={projectId} settings={settings} connectHref={connectHref} />
                : settings.configured && <a href={connectHref} className={cn(buttonVariants(), 'w-fit')}>
                    {settings.status === 'needs_reconnect' ? t("Reconnect Azure DevOps") : t("Connect Azure DevOps")}<ArrowUpRight data-icon="inline-end" />
                </a>}
        </div>
    </Section>;
}

function AzureDevOpsConnection({ projectId, settings, connectHref }: { projectId: string; settings: Settings; connectHref: string }) {
    const { t } = useAppI18n();
    const needsReconnect = settings.status === 'needs_reconnect';
    const usable = settings.configured && !needsReconnect;
    const canSync = usable && Boolean(settings.azureProjectId);
    // Paused sync is switched on again, which also clears what paused it
    const running = settings.enabled && settings.status !== 'paused';

    // The destination form: open until a project is saved, then behind Change destination
    const form = useDestinationForm(Boolean(settings.azureProjectId));
    const [, startLoad] = useTransition();
    const [organizations, loadOrganizations, loadingOrganizations] = useActionState(loadAzureDevOpsOrganizationsAction, null);
    const [projects, loadProjects, loadingProjects] = useActionState(loadAzureDevOpsProjectsAction, null);
    const [options, loadOptions, loadingOptions] = useActionState(loadAzureDevOpsProjectOptionsAction, null);
    const [saved, save, saving] = useActionState(async (previous: ActionState, data: FormData) => {
        const response = await saveAzureDevOpsDestinationAction(previous, data);
        if (response?.ok) form.close();
        return response;
    }, null);
    function toggleForm() {
        if (saving) return;
        if (form.editing) return form.close();
        form.edit();
        // Asking to change the destination is the request to read the organizations and the saved project's choices
        const project = new FormData(); project.set('projectId', projectId);
        project.set('organization', settings.organization!); project.set('azureProjectId', settings.azureProjectId!);
        startLoad(() => { loadOrganizations(project); loadProjects(project); loadOptions(project); });
    }

    return <>
        {settings.status === 'paused' && settings.statusCode && <Alert role="status">
            <AlertDescription>{settings.statusCode === 'work_item_rejected' ? t("Azure DevOps rejected a work item. Check the type’s required fields and rules, then turn sync on again.")
                : t("Sync is paused. Check the destination and the connected account’s access in Azure DevOps, then turn sync on again.")}</AlertDescription>
        </Alert>}
        {settings.needsReviewCount > 0 && <Alert>
            <AlertTitle>{t("Some threads need review")}</AlertTitle>
            <AlertDescription>{settings.needsReviewCount}{settings.needsReviewCountCapped ? '+' : ''} {t("threads could not be confirmed in Azure DevOps. A work item may have been deleted or moved there, or a removal could not finish. Check the existing work items before requesting a backfill.")}</AlertDescription>
        </Alert>}

        <IntegrationDetails ref={form.details}>
            {settings.accountName && <IntegrationDetail term={t("Connected as")}>{settings.accountName}</IntegrationDetail>}
            {settings.azureProjectId && <>
                <IntegrationDetail term={t("Destination")} action={usable && <ChangeDestinationButton form={form} onClick={toggleForm}>{t("Change destination")}</ChangeDestinationButton>}>
                    {settings.organization} / {settings.azureProjectName ?? t('Saved project')}
                </IntegrationDetail>
                <IntegrationDetail term={t("Work items")}>{settings.workItemType}{settings.areaPath ? t(" in {value1}", { value1: settings.areaPath }) : ''}</IntegrationDetail>
                <IntegrationDetail term={t("States")}>{settings.openState} / {settings.doneState}</IntegrationDetail>
            </>}
            {usable && <IntegrationDetail term={t("Pull requests")} action={!settings.pullRequestAccess && <a href={`${connectHref}&pullRequests=1`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                {t("Show pull request state")}<ArrowUpRight data-icon="inline-end" /></a>}>
                {settings.pullRequestAccess ? t("Shown with their state") : t("Plain links")}
            </IntegrationDetail>}
            {settings.lastSyncedAt && <IntegrationDetail term={t("Last synced")}><DateTime value={settings.lastSyncedAt} /></IntegrationDetail>}
            {settings.pausedUntil && <IntegrationDetail term={t("Requests resume")}><DateTime value={settings.pausedUntil} /></IntegrationDetail>}
            <BackfillDetail backfill={settings.backfill} />
        </IntegrationDetails>

        {settings.configured && needsReconnect && <a href={connectHref} className={cn(buttonVariants(), 'w-fit')}>{t("Reconnect Azure DevOps")}<ArrowUpRight data-icon="inline-end" /></a>}

        {usable && form.open && <DestinationPanel form={form}>
            <AzureDevOpsDestination projectId={projectId} settings={settings} organizations={organizations} loadOrganizations={loadOrganizations} loadingOrganizations={loadingOrganizations}
                projects={projects} loadProjects={loadProjects} loadingProjects={loadingProjects} options={options} loadOptions={loadOptions} loadingOptions={loadingOptions}
                save={save} saving={saving} error={saved && !saved.ok ? saved : null} onCancel={settings.azureProjectId ? form.close : undefined} />
        </DestinationPanel>}
        {!form.open && <FormMessage state={saved} />}

        <ConnectionControls projectId={projectId} manage={manageAzureDevOpsAction}
            sync={settings.enabled || canSync ? { checked: running } : undefined}
            backfill={canSync && settings.enabled && settings.status === 'connected' ? { label: t("Backfill existing feedback"), queueing: Boolean(settings.backfill && !settings.backfill.done) } : undefined}
            disconnect={{ label: t("Disconnect Azure DevOps"), title: t("Disconnect Azure DevOps from this project?"),
                description: t("Stops future sync from this project and deletes its stored Azure DevOps credentials. Existing work items remain in Azure DevOps. To withdraw uier’s access completely, remove it from your Microsoft account’s apps.") }}>
            {canSync && <ConnectionNote>{t("Backfill selects up to 1,000 existing shared threads for this Azure DevOps destination. New feedback syncs automatically while sync is on.")}</ConnectionNote>}
            <ConnectionNote>{t("Work items are created and updated as the connected account.")}</ConnectionNote>
            {usable && !settings.pullRequestAccess && <ConnectionNote>{t("Pull requests stay plain links. Reconnect with code read access to show their state.")}</ConnectionNote>}
        </ConnectionControls>
    </>;
}

/** The organization, its project, then that project's choices. The lists are read from Azure DevOps only when asked for */
function AzureDevOpsDestination({ projectId, settings, organizations, loadOrganizations, loadingOrganizations, projects, loadProjects, loadingProjects,
    options, loadOptions, loadingOptions, save, saving, error, onCancel }: {
    projectId: string;
    settings: Settings;
    organizations: Organizations;
    loadOrganizations: (form: FormData) => void;
    loadingOrganizations: boolean;
    projects: Projects;
    loadProjects: (form: FormData) => void;
    loadingProjects: boolean;
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
    const [organization, setOrganization] = useState(settings.organization ?? '');
    const [azureProject, setAzureProject] = useState(settings.azureProjectId ?? '');
    const loading = loadingOrganizations || loadingProjects || loadingOptions || saving;
    const organizationChoices = organizations?.ok ? organizations.data.items.map(item => ({ id: item.name, name: item.name })) : [];
    const organizationOptions: Option[] = settings.organization && !organizationChoices.some(item => item.id === settings.organization)
        ? [{ id: settings.organization, name: settings.organization }, ...organizationChoices] : organizationChoices;
    const loadedProjects = projects?.ok && projects.data.organization === organization ? projects.data.projects : undefined;
    const projectChoices = loadedProjects?.items ?? [];
    const projectOptions: Option[] = settings.azureProjectId && settings.organization === organization && !projectChoices.some(item => item.id === settings.azureProjectId)
        ? [{ id: settings.azureProjectId, name: settings.azureProjectName ?? t('Saved project') }, ...projectChoices] : projectChoices;
    const loadedOptions = options?.ok && options.data.organization === organization && options.data.projectId === azureProject ? options.data : undefined;
    const submit = (load: (data: FormData) => void) => (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault(); const data = new FormData(event.currentTarget); startLoad(() => load(data));
    };
    return <FieldGroup>
        <Field>
            <FieldLabel>{t("Azure DevOps organizations")}</FieldLabel>
            <FieldDescription>{t("Load the organizations the connected account belongs to. This only reads your Azure DevOps choices.")}</FieldDescription>
            <form action={loadOrganizations}>
                <input type="hidden" name="projectId" value={projectId} />
                <Button type="submit" variant={organizations?.ok || settings.azureProjectId ? "outline" : "default"} disabled={loading}>
                    {loadingOrganizations ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}{t("Load organizations")}{' '}</Button>
            </form>
            <FormMessage state={organizations} />
            {organizations?.ok && organizations.data.items.length === 0 && <FieldDescription>{t("The connected account belongs to no Azure DevOps organization.")}</FieldDescription>}
            {organizations?.ok && organizations.data.truncated && <FieldDescription>{t("Only the first 500 organizations are shown.")}</FieldDescription>}
        </Field>
        {organizationOptions.length > 0 && <form onSubmit={submit(loadProjects)}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="organization" value={organization} />
            <FieldGroup>
                <Field>
                    <FieldLabel htmlFor={`${formId}-organization`}>{t("Organization")}</FieldLabel>
                    <Select items={organizationOptions.map(item => ({ value: item.id, label: item.name }))} value={organization} onValueChange={value => value !== null && setOrganization(value)} disabled={loading}>
                        <SelectTrigger id={`${formId}-organization`}><SelectValue placeholder={t("Choose an organization")} /></SelectTrigger>
                        <SelectContent><SelectGroup>{organizationOptions.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                </Field>
                <div className="flex flex-col items-start gap-3">
                    <Button type="submit" variant="outline" disabled={!organization || loading}>
                        {loadingProjects && <Spinner data-icon="inline-start" />}{t("Load projects")}{' '}</Button>
                    <FormMessage state={projects} />
                    {loadedProjects?.items.length === 0 && <FieldDescription>{t("No projects in this organization are available to the connected account.")}</FieldDescription>}
                    {loadedProjects?.truncated && <FieldDescription>{t("Only the first 500 projects are shown.")}</FieldDescription>}
                </div>
            </FieldGroup>
        </form>}
        {projectOptions.length > 0 && <form onSubmit={submit(loadOptions)}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="organization" value={organization} />
            <input type="hidden" name="azureProjectId" value={azureProject} />
            <FieldGroup>
                <Field>
                    <FieldLabel htmlFor={`${formId}-project`}>{t("Project")}</FieldLabel>
                    <Select items={projectOptions.map(item => ({ value: item.id, label: item.name }))} value={azureProject} onValueChange={value => value !== null && setAzureProject(value)} disabled={loading}>
                        <SelectTrigger id={`${formId}-project`}><SelectValue placeholder={t("Choose a project")} /></SelectTrigger>
                        <SelectContent><SelectGroup>{projectOptions.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                    <FieldDescription>{t("Load this project’s work item types, states and area paths before saving.")}</FieldDescription>
                </Field>
                <div className="flex flex-col items-start gap-3">
                    <Button type="submit" variant="outline" disabled={!azureProject || loading}>
                        {loadingOptions && <Spinner data-icon="inline-start" />}{t("Load project options")}{' '}</Button>
                    <FormMessage state={options} />
                </div>
            </FieldGroup>
        </form>}
        {loadedOptions ? <AzureDevOpsDestinationForm key={`${loadedOptions.organization}:${loadedOptions.projectId}`}
            projectId={projectId} settings={settings} options={loadedOptions} save={save} pending={saving} error={error} onCancel={onCancel} />
            : onCancel && <Button type="button" variant="ghost" className="w-fit" disabled={saving} onClick={onCancel}>{t("Cancel")}</Button>}
    </FieldGroup>;
}

/** The saved choices come back in the form when its project is the saved one */
function AzureDevOpsDestinationForm({ projectId, settings, options, save, pending, error, onCancel }: {
    projectId: string; settings: Settings; options: AzureDevOpsProjectOptions; save: (form: FormData) => void; pending: boolean; error: ActionState; onCancel?: () => void;
}) {
    const { t } = useAppI18n();
    const id = useId();
    const sameProject = settings.organization === options.organization && settings.azureProjectId === options.projectId;
    const [type, setType] = useState(() => sameProject && options.types.some(item => item.name === settings.workItemType) ? settings.workItemType! : '');
    const states = options.types.find(item => item.name === type)?.states ?? [];
    const openStates = states.filter(item => openCategories.includes(item.category));
    const doneStates = states.filter(item => doneCategories.includes(item.category));
    const saved = (choices: { name: string }[], value?: string) => sameProject && type === settings.workItemType && choices.some(item => item.name === value) ? value! : '';
    const [openState, setOpenState] = useState(() => saved(openStates, settings.openState));
    const [doneState, setDoneState] = useState(() => saved(doneStates, settings.doneState));
    const [area, setArea] = useState(() => sameProject && settings.areaPath && options.areaPaths.includes(settings.areaPath) ? settings.areaPath : DEFAULT_AREA);
    const areaItems = [{ value: DEFAULT_AREA, label: t("Project default") }, ...options.areaPaths.map(path => ({ value: path, label: path }))];
    function chooseType(value: string) { setType(value); setOpenState(''); setDoneState(''); }
    return <form action={save} onReset={event => event.preventDefault()}>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="organization" value={options.organization} />
        <input type="hidden" name="azureProjectId" value={options.projectId} />
        <input type="hidden" name="workItemType" value={type} />
        <input type="hidden" name="openState" value={openState} />
        <input type="hidden" name="doneState" value={doneState} />
        <input type="hidden" name="areaPath" value={area === DEFAULT_AREA ? '' : area} />
        <FieldGroup>
            <Choice id={`${id}-type`} label={t("Work item type")} placeholder={t("Choose a work item type")} choices={options.types.map(item => item.name)}
                value={type} onChange={chooseType} disabled={pending} />
            {options.types.length === 0 && <FieldDescription>{t("This project has no work item types available on its boards.")}</FieldDescription>}
            {type && <>
                <Choice id={`${id}-open`} label={t("State for open feedback")} placeholder={t("Choose a state")} choices={openStates.map(item => item.name)}
                    value={openState} onChange={setOpenState} disabled={pending} />
                <Choice id={`${id}-done`} label={t("State for done feedback")} placeholder={t("Choose a state")} choices={doneStates.map(item => item.name)}
                    value={doneState} onChange={setDoneState} disabled={pending} />
                {(!openStates.length || !doneStates.length) && <FieldDescription>{t("This type needs a proposed or in progress state and a resolved or completed state before it can be saved.")}</FieldDescription>}
            </>}
            <Field data-disabled={pending}>
                <FieldLabel htmlFor={`${id}-area`}>{t("Area path (optional)")}</FieldLabel>
                <Select items={areaItems} value={area} onValueChange={value => value !== null && setArea(value)} disabled={pending}>
                    <SelectTrigger id={`${id}-area`}><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup>{areaItems.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
                <FieldDescription>{t("A team’s board shows work items in its own area paths.")}</FieldDescription>
            </Field>
            {options.truncated && <FieldDescription>{t("Only the first 500 choices in each list are shown. Missing choices cannot be saved here.")}</FieldDescription>}
            <FieldDescription>{t("Saving turns sync on for shared feedback. uier sets the state when the feedback’s status changes and keeps state changes made on your board. Changing the organization, project or type starts new work items. Existing work items stay where they are.")}</FieldDescription>
            <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={pending || !type || !openState || !doneState}>
                        {pending && <Spinner data-icon="inline-start" />}{t("Save Azure DevOps destination")}{' '}</Button>
                    {onCancel && <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>{t("Cancel")}</Button>}
                </div>
                <FormMessage state={error} />
            </div>
        </FieldGroup>
    </form>;
}

function Choice({ id, label, placeholder, choices, value, onChange, disabled }: { id: string; label: string; placeholder: string; choices: string[];
    value: string; onChange: (value: string) => void; disabled: boolean }) {
    return <Field data-disabled={disabled}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Select value={value} onValueChange={next => next !== null && onChange(next)} disabled={disabled || choices.length === 0}>
            <SelectTrigger id={id}><SelectValue placeholder={placeholder} /></SelectTrigger>
            <SelectContent><SelectGroup>{choices.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
    </Field>;
}
