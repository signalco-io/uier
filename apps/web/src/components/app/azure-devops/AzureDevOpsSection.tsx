'use client';

import { useActionState, useId, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/src/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/src/components/ui/alert-dialog';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { Spinner } from '@/src/components/ui/spinner';
import type { ActionState } from '@/src/lib/app/actionResult';
import type { getAzureDevOpsSettings } from '@/src/lib/integrations/azure-devops';
import { doneCategories, openCategories, type AzureDevOpsProjectOptions } from '@/src/lib/integrations/azure-devops/model';
import { DateTime } from '../comments/DateTime';
import { FormMessage } from '../FormMessage';
import { Section } from '../PageHeader';
import { loadAzureDevOpsOrganizationsAction, loadAzureDevOpsProjectOptionsAction, loadAzureDevOpsProjectsAction,
    manageAzureDevOpsAction, saveAzureDevOpsDestinationAction } from './actions';

type Settings = Awaited<ReturnType<typeof getAzureDevOpsSettings>>;
type Option = { id: string; name: string };
/** Area paths are trimmed, so a leading space can never collide with one. */
const DEFAULT_AREA = ' default';

const outcomes: Record<string, string> = {
    connected: 'Azure DevOps is connected. Choose an organization, project and work item type to start syncing.',
    denied: 'The Azure DevOps connection was canceled. You can connect again.',
    failed: 'Azure DevOps could not complete the connection. Try connecting again.',
    unavailable: 'Azure DevOps is unavailable right now. Try again later.'
};

export function AzureDevOpsSection({ projectId, settings, outcome }: { projectId: string; settings: Settings; outcome?: string }) {
    const notice = outcome && Object.hasOwn(outcomes, outcome) ? outcomes[outcome] : undefined;
    const status = !settings.configured ? 'Unavailable' : !settings.connected ? 'Not connected'
        : settings.status === 'needs_reconnect' ? 'Reconnect needed' : settings.status === 'paused' || settings.pausedUntil ? 'Waiting for Azure DevOps'
        : !settings.azureProjectId ? 'Choose a destination' : settings.enabled ? 'Sync on' : 'Sync off';
    return <Section id="azure-devops" title="Azure DevOps" description="Create one Azure Boards work item for each shared feedback thread. uier keeps its description, discussion and state up to date."
        actions={<Badge variant="secondary">{status}</Badge>}>
        <div className="flex flex-col gap-5">
            {notice && <p role="status" className="m-0 text-sm text-muted-foreground">{notice}</p>}
            {!settings.configured ? <p className="m-0 text-sm text-muted-foreground">Azure DevOps is unavailable on this deployment. A site administrator needs to configure it.</p>
                : <>
                    {settings.accountName && <p className="m-0 text-sm">Connected as {settings.accountName}. Work items are created and updated as this account.</p>}
                    {(!settings.connected || settings.status === 'needs_reconnect') && <Button asChild className="w-fit">
                        <a href={`/app/azure-devops/connect?project=${encodeURIComponent(projectId)}`}>
                            <ArrowUpRight data-icon="inline-start" />{settings.status === 'needs_reconnect' ? 'Reconnect Azure DevOps' : 'Connect Azure DevOps'}
                        </a>
                    </Button>}
                    {settings.connected && settings.status !== 'needs_reconnect' && <>
                        <AzureDevOpsDestination key={`${settings.organization}:${settings.azureProjectId}:${settings.workItemType}:${settings.openState}:${settings.doneState}:${settings.areaPath}`}
                            projectId={projectId} settings={settings} />
                        {settings.azureProjectId && <p className="m-0 text-sm text-muted-foreground">
                            Destination: {settings.organization} / {settings.azureProjectName ?? 'Saved project'}, {settings.workItemType} work items
                            {settings.areaPath ? ` in ${settings.areaPath}` : ''}. Open feedback is {settings.openState}, done feedback is {settings.doneState}.
                        </p>}
                    </>}
                </>}
            {settings.lastSyncedAt && <p className="m-0 text-sm text-muted-foreground">Last synced <DateTime value={settings.lastSyncedAt} />.</p>}
            {settings.pausedUntil && <p className="m-0 text-sm text-muted-foreground">Azure DevOps requests resume after <DateTime value={settings.pausedUntil} />.</p>}
            {settings.status === 'paused' && settings.statusCode && <p className="m-0 text-sm text-muted-foreground">
                {settings.statusCode === 'work_item_rejected' ? 'Azure DevOps rejected a work item. Check the type’s required fields and rules, then turn sync on again.'
                    : 'Sync is paused. Check the destination and the connected account’s access in Azure DevOps, then turn sync on again.'}
            </p>}
            {settings.needsReviewCount > 0 && <Alert>
                <AlertTitle>Some threads need review</AlertTitle>
                <AlertDescription>{settings.needsReviewCount}{settings.needsReviewCountCapped ? '+' : ''} threads could not be confirmed in Azure DevOps. A work item may have been deleted or moved there, or a removal could not finish. Check the existing work items before requesting a backfill.</AlertDescription>
            </Alert>}
            {settings.backfill && <p role="status" className="m-0 text-sm text-muted-foreground">
                Backfill: {settings.backfill.queued} of {settings.backfill.total} selected threads queued for delivery.
                {settings.backfill.done && ' Queueing is complete. Delivery continues in the background.'}
            </p>}
            {settings.connected && <AzureDevOpsManagement projectId={projectId} settings={settings} />}
        </div>
    </Section>;
}

function AzureDevOpsDestination({ projectId, settings }: { projectId: string; settings: Settings }) {
    const formId = useId();
    const [, startLoad] = useTransition();
    const [organizations, loadOrganizations, loadingOrganizations] = useActionState(loadAzureDevOpsOrganizationsAction, null);
    const [projects, loadProjects, loadingProjects] = useActionState(loadAzureDevOpsProjectsAction, null);
    const [options, loadOptions, loadingOptions] = useActionState(loadAzureDevOpsProjectOptionsAction, null);
    const [organization, setOrganization] = useState(settings.organization ?? '');
    const [azureProject, setAzureProject] = useState(settings.azureProjectId ?? '');
    const loading = loadingOrganizations || loadingProjects || loadingOptions;
    const organizationChoices = organizations?.ok ? organizations.data.items.map(item => ({ id: item.name, name: item.name })) : [];
    const organizationOptions: Option[] = settings.organization && !organizationChoices.some(item => item.id === settings.organization)
        ? [{ id: settings.organization, name: settings.organization }, ...organizationChoices] : organizationChoices;
    const loadedProjects = projects?.ok && projects.data.organization === organization ? projects.data.projects : undefined;
    const projectChoices = loadedProjects?.items ?? [];
    const projectOptions: Option[] = settings.azureProjectId && settings.organization === organization && !projectChoices.some(item => item.id === settings.azureProjectId)
        ? [{ id: settings.azureProjectId, name: settings.azureProjectName ?? 'Saved project' }, ...projectChoices] : projectChoices;
    const loadedOptions = options?.ok && options.data.organization === organization && options.data.projectId === azureProject ? options.data : undefined;
    const submit = (load: (data: FormData) => void) => (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault(); const data = new FormData(event.currentTarget); startLoad(() => load(data));
    };
    return <FieldGroup>
        <Field>
            <FieldLabel>Azure DevOps organizations</FieldLabel>
            <FieldDescription>Load the organizations the connected account belongs to. This only reads your Azure DevOps choices.</FieldDescription>
            <form action={loadOrganizations}>
                <input type="hidden" name="projectId" value={projectId} />
                <Button type="submit" variant="outline" disabled={loading}>
                    {loadingOrganizations ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}Load organizations
                </Button>
            </form>
            <FormMessage state={organizations} />
            {organizations?.ok && organizations.data.items.length === 0 && <FieldDescription>The connected account belongs to no Azure DevOps organization.</FieldDescription>}
            {organizations?.ok && organizations.data.truncated && <FieldDescription>Only the first 500 organizations are shown.</FieldDescription>}
        </Field>
        {organizationOptions.length > 0 && <form onSubmit={submit(loadProjects)}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="organization" value={organization} />
            <FieldGroup>
                <Field>
                    <FieldLabel htmlFor={`${formId}-organization`}>Organization</FieldLabel>
                    <Select value={organization} onValueChange={setOrganization} disabled={loading}>
                        <SelectTrigger id={`${formId}-organization`}><SelectValue placeholder="Choose an organization" /></SelectTrigger>
                        <SelectContent><SelectGroup>{organizationOptions.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                </Field>
                <Field>
                    <Button className="w-fit" type="submit" variant="outline" disabled={!organization || loading}>
                        {loadingProjects && <Spinner data-icon="inline-start" />}Load projects
                    </Button>
                    <FormMessage state={projects} />
                    {loadedProjects?.items.length === 0 && <FieldDescription>No projects in this organization are available to the connected account.</FieldDescription>}
                    {loadedProjects?.truncated && <FieldDescription>Only the first 500 projects are shown.</FieldDescription>}
                </Field>
            </FieldGroup>
        </form>}
        {projectOptions.length > 0 && <form onSubmit={submit(loadOptions)}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="organization" value={organization} />
            <input type="hidden" name="azureProjectId" value={azureProject} />
            <FieldGroup>
                <Field>
                    <FieldLabel htmlFor={`${formId}-project`}>Project</FieldLabel>
                    <Select value={azureProject} onValueChange={setAzureProject} disabled={loading}>
                        <SelectTrigger id={`${formId}-project`}><SelectValue placeholder="Choose a project" /></SelectTrigger>
                        <SelectContent><SelectGroup>{projectOptions.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                    <FieldDescription>Load this project’s work item types, states and area paths before saving.</FieldDescription>
                </Field>
                <Field>
                    <Button className="w-fit" type="submit" variant="outline" disabled={!azureProject || loading}>
                        {loadingOptions && <Spinner data-icon="inline-start" />}Load project options
                    </Button>
                    <FormMessage state={options} />
                </Field>
            </FieldGroup>
        </form>}
        {loadedOptions && <AzureDevOpsDestinationForm key={`${loadedOptions.organization}:${loadedOptions.projectId}`}
            projectId={projectId} settings={settings} options={loadedOptions} />}
    </FieldGroup>;
}

function AzureDevOpsDestinationForm({ projectId, settings, options }: { projectId: string; settings: Settings; options: AzureDevOpsProjectOptions }) {
    const id = useId();
    const [state, save, pending] = useActionState(saveAzureDevOpsDestinationAction, null);
    const sameProject = settings.organization === options.organization && settings.azureProjectId === options.projectId;
    const [type, setType] = useState(() => sameProject && options.types.some(item => item.name === settings.workItemType) ? settings.workItemType! : '');
    const states = options.types.find(item => item.name === type)?.states ?? [];
    const openStates = states.filter(item => openCategories.includes(item.category));
    const doneStates = states.filter(item => doneCategories.includes(item.category));
    const saved = (choices: { name: string }[], value?: string) => sameProject && type === settings.workItemType && choices.some(item => item.name === value) ? value! : '';
    const [openState, setOpenState] = useState(() => saved(openStates, settings.openState));
    const [doneState, setDoneState] = useState(() => saved(doneStates, settings.doneState));
    const [area, setArea] = useState(() => sameProject && settings.areaPath && options.areaPaths.includes(settings.areaPath) ? settings.areaPath : DEFAULT_AREA);
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
            <Choice id={`${id}-type`} label="Work item type" placeholder="Choose a work item type" choices={options.types.map(item => item.name)}
                value={type} onChange={chooseType} disabled={pending} />
            {options.types.length === 0 && <FieldDescription>This project has no work item types available on its boards.</FieldDescription>}
            {type && <>
                <Choice id={`${id}-open`} label="State for open feedback" placeholder="Choose a state" choices={openStates.map(item => item.name)}
                    value={openState} onChange={setOpenState} disabled={pending} />
                <Choice id={`${id}-done`} label="State for done feedback" placeholder="Choose a state" choices={doneStates.map(item => item.name)}
                    value={doneState} onChange={setDoneState} disabled={pending} />
                {(!openStates.length || !doneStates.length) && <FieldDescription>This type needs a proposed or in progress state and a resolved or completed state before it can be saved.</FieldDescription>}
            </>}
            <Field data-disabled={pending}>
                <FieldLabel htmlFor={`${id}-area`}>Area path (optional)</FieldLabel>
                <Select value={area} onValueChange={setArea} disabled={pending}>
                    <SelectTrigger id={`${id}-area`}><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup><SelectItem value={DEFAULT_AREA}>Project default</SelectItem>
                        {options.areaPaths.map(path => <SelectItem key={path} value={path}>{path}</SelectItem>)}
                    </SelectGroup></SelectContent>
                </Select>
                <FieldDescription>A team’s board shows work items in its own area paths.</FieldDescription>
            </Field>
            {options.truncated && <FieldDescription>Only the first 500 choices in each list are shown. Missing choices cannot be saved here.</FieldDescription>}
            <FieldDescription>Saving turns sync on for shared feedback. uier sets the state when the feedback’s status changes and keeps state changes made on your board. Changing the organization, project or type starts new work items. Existing work items stay where they are.</FieldDescription>
            <Field>
                <Button className="w-fit" type="submit" disabled={pending || !type || !openState || !doneState}>
                    {pending && <Spinner data-icon="inline-start" />}Save Azure DevOps destination
                </Button>
                <FormMessage state={state} />
            </Field>
        </FieldGroup>
    </form>;
}

function Choice({ id, label, placeholder, choices, value, onChange, disabled }: { id: string; label: string; placeholder: string; choices: string[];
    value: string; onChange: (value: string) => void; disabled: boolean }) {
    return <Field data-disabled={disabled}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Select value={value} onValueChange={onChange} disabled={disabled || choices.length === 0}>
            <SelectTrigger id={id}><SelectValue placeholder={placeholder} /></SelectTrigger>
            <SelectContent><SelectGroup>{choices.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
    </Field>;
}

function AzureDevOpsManagement({ projectId, settings }: { projectId: string; settings: Settings }) {
    const router = useRouter();
    const [state, setState] = useState<ActionState<{ message: string }>>(null);
    const [pending, startTransition] = useTransition();
    const [confirming, setConfirming] = useState(false);
    function change(operation: 'enable' | 'disable' | 'disconnect' | 'backfill') {
        startTransition(async () => {
            const form = new FormData();
            form.set('projectId', projectId);
            form.set('operation', operation);
            const result = await manageAzureDevOpsAction(null, form);
            setState(result);
            if (result?.ok) { setConfirming(false); router.refresh(); }
        });
    }
    const canSync = settings.configured && Boolean(settings.azureProjectId) && settings.status !== 'needs_reconnect';
    return <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
            {(settings.enabled || canSync) && <Button type="button" variant="outline" disabled={pending}
                onClick={() => change(settings.enabled && settings.status !== 'paused' ? 'disable' : 'enable')}>
                {pending && <Spinner data-icon="inline-start" />}{settings.enabled && settings.status !== 'paused' ? 'Turn sync off' : 'Turn sync on'}
            </Button>}
            {canSync && settings.enabled && settings.status === 'connected' && <Button type="button" variant="outline"
                disabled={pending || Boolean(settings.backfill && !settings.backfill.done)} onClick={() => change('backfill')}>
                Backfill existing feedback
            </Button>}
            <AlertDialog open={confirming} onOpenChange={setConfirming}>
                <AlertDialogTrigger asChild><Button type="button" variant="outline" disabled={pending}>Disconnect Azure DevOps</Button></AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Disconnect Azure DevOps from this project?</AlertDialogTitle>
                        <AlertDialogDescription>Stops future sync from this project and deletes its stored Azure DevOps credentials. Existing work items remain in Azure DevOps. To withdraw uier’s access completely, remove it from your Microsoft account’s apps.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <FormMessage state={state && !state.ok ? state : null} />
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={pending}>Keep connected</AlertDialogCancel>
                        <AlertDialogAction variant="outline" disabled={pending} onClick={event => { event.preventDefault(); change('disconnect'); }}>
                            {pending && <Spinner data-icon="inline-start" />}Disconnect Azure DevOps
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
        {canSync && <p className="m-0 text-sm text-muted-foreground">Backfill selects up to 1,000 existing shared threads for this Azure DevOps destination. New feedback syncs automatically while sync is on.</p>}
        <FormMessage state={state?.ok ? { ...state, message: state.data.message } : state} />
    </div>;
}
