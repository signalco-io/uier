'use client';

import { startTransition, useActionState, useId, useOptimistic, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ChevronRightIcon, PlusIcon, XIcon } from 'lucide-react';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger
} from '@/src/components/ui/alert-dialog';
import { Button } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/src/components/ui/collapsible';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet } from '@/src/components/ui/field';
import { Textarea } from '@/src/components/ui/textarea';
import { Input } from '@/src/components/ui/input';
import { RadioGroup } from '@/src/components/ui/radio-group';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { Spinner } from '@/src/components/ui/spinner';
import { Switch } from '@/src/components/ui/switch';
import { KnownPageLinks, KnownPages, projectAccessAnchor } from '../../../knownPages';
import { ChoiceCard } from '../ChoiceCard';
import { FormMessage } from '../FormMessage';
import { destructiveTextClassName, Section } from '../PageHeader';
import { SaveFooter, useSettingsDraft } from '../SettingsSave';
import { MAX_PROJECT_BRIEF_LENGTH, MAX_PROJECT_NAME_LENGTH, MAX_PROJECT_URLS } from '../../../lib/app/limits';
import type { ProjectAccess, ProjectStatus } from '../../../lib/app/model';
import type { ProjectEnvironment } from '../../../lib/app/environments';
import { ClientNameInput } from './ClientNameInput';
import { AccessIcon, displayUrl, projectAccessLabels } from './projectLabels';
import { hasSchemelessLocal, sameSiteAs, savedSiteRows, shareOptions, sharedWith, shareWith, siteRowsPayload, type SiteRow } from './siteRows';
import {
    deleteProjectAction,
    transferProjectAction,
    setProjectEmailsMutedAction,
    setProjectStatusAction,
    updateProjectEmailExcerptsAction,
    updateProjectGeneralAction,
    updateProjectReviewAction,
    updateProjectSitesAction
} from './actions';
import { pageStatePolicy, type PageStatePolicy } from '@uier/toolbar/page-state';
import type { QueryFieldSuggestion } from '../../../lib/app/pageStateSuggestions';
import type { TransferPreview, TransferTarget } from '../../../lib/app/projectTransfer';
import { projectAiTitleModes, type ProjectAiTitleMode } from '../../../lib/titles/settings';
import type { ProjectSetting, ProjectSettingMode } from '../../../lib/app/inheritedSettings';
import { ProjectRewriteInstructionsFields } from './ProjectRewriteInstructionsFields';

/** React resets a form after its action; the fields here are controlled, so keep what they show */
const keepValues = (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
};

/** General: the project's name, client, AI thread titles and rewrite guidance, one save */
export function ProjectGeneralForm({ projectId, name, clientName, clients, aiTitles, workspaceAiTitles, rewriteInstructions, workspaceRewriteInstructions }: {
    projectId: string;
    name: string;
    clientName?: string;
    clients: string[];
    /** The project's own choice, or the workspace's setting */
    aiTitles: ProjectAiTitleMode;
    /** The workspace's setting, which `workspace` follows */
    workspaceAiTitles: boolean;
    rewriteInstructions?: ProjectSetting<string>;
    workspaceRewriteInstructions: string;
}) {
    const formId = useId();
    const [state, formAction, pending] = useActionState(updateProjectGeneralAction, null);
    const { draft, dirty, update, discard } = useSettingsDraft({ name, clientName: clientName ?? '', aiTitles,
        rewriteMode: (rewriteInstructions?.mode ?? 'workspace') as ProjectSettingMode, rewriteInstructions: rewriteInstructions?.value ?? '' }, state);
    const aiTitleOptions = [
        { value: 'workspace', label: `Workspace setting (${workspaceAiTitles ? 'on' : 'off'})` },
        { value: 'on', label: 'On' },
        { value: 'off', label: 'Off' }
    ] satisfies { value: ProjectAiTitleMode; label: string }[];
    return (
        <Section
            id="general"
            title="General"
            stickyFooter
            footer={<SaveFooter formId={formId} state={state} pending={pending} dirty={dirty} onDiscard={discard} />}>
            <form id={formId} action={formAction} onResetCapture={keepValues}>
                <input type="hidden" name="projectId" value={projectId} />
                <FieldGroup>
                    <Field>
                        <FieldLabel htmlFor={`${formId}-name`}>Project name</FieldLabel>
                        <Input
                            id={`${formId}-name`}
                            name="name"
                            value={draft.name}
                            onChange={(event) => update(current => ({ ...current, name: event.target.value }))}
                            required
                            maxLength={MAX_PROJECT_NAME_LENGTH}
                            className="max-w-md" />
                        <FieldDescription>Shown in the app and in invitations.</FieldDescription>
                    </Field>
                    <Field>
                        <FieldLabel htmlFor={`${formId}-client`}>Client name (optional)</FieldLabel>
                        <ClientNameInput id={`${formId}-client`} value={draft.clientName}
                            onValueChange={value => update(current => ({ ...current, clientName: value }))} clients={clients} className="max-w-md" />
                        <FieldDescription>
                            Who the project is for. Edit a client&apos;s name, icon and colour on <Link href={KnownPages.AppClients} className="underline underline-offset-4 hover:text-foreground">Clients</Link>.
                        </FieldDescription>
                    </Field>
                    <Field>
                        <FieldLabel htmlFor={`${formId}-ai-titles`}>Thread titles</FieldLabel>
                        <input type="hidden" name="aiTitles" value={draft.aiTitles} />
                        <Select value={draft.aiTitles} items={aiTitleOptions}
                            onValueChange={value => update(current => ({ ...current, aiTitles: projectAiTitleModes.find(mode => mode === value) ?? 'workspace' }))}>
                            <SelectTrigger id={`${formId}-ai-titles`} className="w-full max-w-md">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {aiTitleOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                        <FieldDescription>
                            A short title for each thread, written by Claude Haiku from its first message and shown in place of the first line. Change the workspace setting in <Link href={KnownPages.AppSettings} className="underline underline-offset-4 hover:text-foreground">Workspace settings</Link>.
                        </FieldDescription>
                    </Field>
                    <FieldSeparator />
                    <ProjectRewriteInstructionsFields mode={draft.rewriteMode} value={draft.rewriteInstructions} workspace={workspaceRewriteInstructions} disabled={pending}
                        onModeChange={rewriteMode => update(current => ({ ...current, rewriteMode }))}
                        onValueChange={rewriteInstructions => update(current => ({ ...current, rewriteInstructions }))} />
                </FieldGroup>
            </form>
        </Section>
    );
}

/** Review: who can comment, the brief and, under Advanced, the page state; one save */
export function ProjectReviewForm({ projectId, access, brief, policy, suggestions, guestLinks }: {
    projectId: string;
    access: ProjectAccess;
    /** The saved access's guest links, shown under Who can comment while it stays chosen */
    guestLinks?: ReactNode;
    brief?: string;
    policy?: PageStatePolicy;
    suggestions: QueryFieldSuggestion[];
}) {
    const formId = useId();
    const [state, formAction, pending] = useActionState(updateProjectReviewAction, null);
    const saved = pageStatePolicy(policy);
    const { draft, dirty, update, discard } = useSettingsDraft({
        access,
        brief: brief ?? '',
        queryParameters: saved.queryParameters.join(', '),
        hashRouting: saved.hashRouting
    }, state);
    const entered = draft.queryParameters.split(/[,\s]+/).filter(Boolean);
    const available = suggestions.filter(suggestion => !entered.includes(suggestion.key));
    // Open while the page state is set up, so what applies is in sight
    const [advanced, setAdvanced] = useState(saved.queryParameters.length > 0 || saved.hashRouting);

    return (
        <Section
            id="review"
            title="Review"
            stickyFooter
            footer={<SaveFooter formId={formId} state={state} pending={pending} dirty={dirty} onDiscard={discard} />}>
            <form id={formId} action={formAction} onResetCapture={keepValues}>
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="access" value={draft.access} />
                <input type="hidden" name="queryParameters" value={draft.queryParameters} />
                <input type="hidden" name="hashRouting" value={String(draft.hashRouting)} />
                <FieldGroup>
                    {/* The header's access label links here */}
                    <FieldSet id={projectAccessAnchor} className="scroll-mt-6">
                        <FieldLegend variant="label">Who can comment</FieldLegend>
                        <FieldDescription>Who can see and leave comments with the toolbar on your site.</FieldDescription>
                        <RadioGroup value={draft.access} onValueChange={(next) => update(current => ({ ...current, access: next as ProjectAccess }))} aria-label="Who can comment">
                            {(['invited', 'guests', 'disabled'] as const).map(option => (
                                <ChoiceCard
                                    key={option}
                                    id={`${formId}-${option}`}
                                    value={option}
                                    title={projectAccessLabels[option].label}
                                    description={projectAccessLabels[option].description}
                                    icon={<AccessIcon access={option} aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />} />
                            ))}
                        </RadioGroup>
                        {guestLinks && draft.access === 'guests' && guestLinks}
                    </FieldSet>
                    <FieldSeparator />
                    <Field>
                        <FieldLabel htmlFor={`${formId}-brief`}>Review brief</FieldLabel>
                        <Textarea id={`${formId}-brief`} name="brief" value={draft.brief} onChange={event => update(current => ({ ...current, brief: event.target.value }))}
                            maxLength={MAX_PROJECT_BRIEF_LENGTH} rows={5} placeholder="What should reviewers look at?" aria-describedby={`${formId}-readers`} />
                        <FieldDescription id={`${formId}-readers`}>
                            {draft.access === 'disabled'
                                ? 'Hidden while comments are off.'
                                : draft.access === 'invited' ? 'Invited people read it in the toolbar.' : 'Anyone with the review link reads it in the toolbar.'}
                            {' '}Plain text, up to {MAX_PROJECT_BRIEF_LENGTH} characters.
                        </FieldDescription>
                    </Field>
                    <FieldSeparator />
                    <Collapsible open={advanced} onOpenChange={setAdvanced} className="flex flex-col gap-4">
                        <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="group/advanced h-auto self-start px-0 py-1 text-muted-foreground hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent aria-expanded:text-foreground dark:hover:bg-transparent" />}>
                            <ChevronRightIcon data-icon="inline-start" className="transition-transform group-data-panel-open/advanced:rotate-90" />
                            Advanced
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                            <FieldSet>
                                <FieldLegend variant="label">Page state</FieldLegend>
                                <FieldDescription>Comments belong to the page path. Add the parts of the address that change what is on the page, so comments stay with that view.</FieldDescription>
                                <FieldGroup>
                                    <Field>
                                        <FieldLabel htmlFor={`${formId}-query`}>Meaningful query fields</FieldLabel>
                                        <Input id={`${formId}-query`} value={draft.queryParameters} onChange={event => update(current => ({ ...current, queryParameters: event.target.value }))}
                                            placeholder="category, sort, tab" className="font-mono text-[13px] md:text-[13px]" />
                                        <FieldDescription>Up to 12 names, separated by commas. Tracking, identity and credential fields are left out, and so are values that look like emails, URLs or tokens.</FieldDescription>
                                        {available.length > 0 && <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Query fields seen in recent comments">
                                            <span className="text-sm text-muted-foreground">Seen in recent comments:</span>
                                            {available.map(suggestion => <Button key={suggestion.key} variant="outline" size="xs"
                                                title={`On ${suggestion.comments} recent ${suggestion.comments === 1 ? 'comment' : 'comments'}`}
                                                onClick={() => update(current => ({ ...current, queryParameters: [...entered, suggestion.key].join(', ') }))}>
                                                <PlusIcon data-icon="inline-start" /><span className="font-mono">{suggestion.key}</span>
                                            </Button>)}
                                        </div>}
                                    </Field>
                                    <Field orientation="horizontal">
                                        <Checkbox id={`${formId}-hash`} checked={draft.hashRouting} onCheckedChange={value => update(current => ({ ...current, hashRouting: value === true }))} />
                                        <FieldLabel htmlFor={`${formId}-hash`}>Use hash routes (#/page or #!/page)</FieldLabel>
                                    </Field>
                                </FieldGroup>
                            </FieldSet>
                        </CollapsibleContent>
                    </Collapsible>
                </FieldGroup>
            </form>
        </Section>
    );
}

/** The columns of the site addresses table: address, label, shared with, remove */
const siteColumns = '@xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.25fr)_2.25rem]';

/**
 * Environments: the site addresses as one table. Each address has a label and the other addresses
 * it shares feedback with; addresses on one origin are one site and share both. One save.
 */
export function ProjectSitesForm({ projectId, urls, environments }: { projectId: string; urls: string[]; environments: ProjectEnvironment[] }) {
    const formId = useId();
    const [state, formAction, pending] = useActionState(updateProjectSitesAction, null);
    const { draft: rows, dirty, update, discard } = useSettingsDraft(savedSiteRows(urls, environments), state);
    const setRow = (index: number, change: Partial<SiteRow>) => update(current => current.map((row, i) => i === index ? { ...row, ...change } : row));
    const name = (row: SiteRow, index: number) => row.url.trim() ? displayUrl(row.url.trim()) : `address ${index + 1}`;

    const addRow = () => {
        // The new row is rendered at once, so focus can move into its address field
        flushSync(() => update(current => [...current, { url: '', label: '', group: null }]));
        const fields = document.getElementById(formId)?.querySelectorAll<HTMLInputElement>('input[inputmode="url"]');
        fields?.[fields.length - 1]?.focus();
    };
    const removeRow = (index: number) => update(current => shareWith(current, index, null).filter((_, i) => i !== index));

    return (
        <Section
            id="addresses"
            title="Site addresses"
            description="The toolbar works only on these addresses, the main site first. Each site keeps its own feedback unless it shares it."
            stickyFooter
            footer={<SaveFooter formId={formId} state={state} pending={pending} dirty={dirty} onDiscard={discard} />}>
            <form id={formId} action={formAction} onResetCapture={keepValues} className="flex flex-col gap-4">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="sites" value={JSON.stringify(siteRowsPayload(rows, environments))} />
                {/* A table where the card is wide enough, otherwise a card per address */}
                <div className="@container flex flex-col gap-3">
                    <div aria-hidden="true" className={`hidden gap-2 text-sm font-medium @xl:grid ${siteColumns}`}>
                        <span>Address</span>
                        <span>Label</span>
                        <span>Shares feedback with</span>
                    </div>
                    {rows.map((row, index) => {
                        const sameSite = sameSiteAs(rows, index);
                        const options = shareOptions(rows, index);
                        const shared = sharedWith(rows, index);
                        // From the rows, not the Select's value: right after a row is removed that value can still be an old index
                        const sharedLabel = shared[0] === undefined
                            ? 'No other address'
                            : `${displayUrl(rows[shared[0]]!.url.trim())}${shared.length > 1 ? ` and ${shared.length - 1} more` : ''}`;
                        return (
                            // Stacked on small screens, with the column names over the fields
                            <div key={index} className={`grid grid-cols-[minmax(0,1fr)_2.25rem] gap-x-2 gap-y-3 rounded-lg border p-3 @xl:items-center @xl:gap-y-0 @xl:rounded-none @xl:border-0 @xl:p-0 ${siteColumns}`}>
                                <div className="flex min-w-0 flex-col gap-1.5">
                                    <label htmlFor={`${formId}-url-${index}`} aria-hidden="true" className="text-xs text-muted-foreground @xl:hidden">Address</label>
                                    <Input
                                        id={`${formId}-url-${index}`}
                                        aria-label={index === 0 ? 'Main site address' : `Address ${index + 1}`}
                                        value={row.url}
                                        onChange={event => setRow(index, { url: event.target.value })}
                                        required={index === 0}
                                        inputMode="url"
                                        autoComplete="url"
                                        spellCheck={false}
                                        placeholder={index === 0 ? 'example.com' : 'staging.example.com'}
                                        className="font-mono text-[13px] md:text-[13px]" />
                                </div>
                                <div className="col-start-2 row-start-1 self-end @xl:col-start-4">
                                    {index > 0
                                        ? <Button variant="ghost" size="icon" aria-label={`Remove address ${index + 1}`} onClick={() => removeRow(index)}><XIcon /></Button>
                                        : <span aria-hidden="true" className="block size-9" />}
                                </div>
                                {sameSite >= 0 ? (
                                    <p className="col-span-2 m-0 text-sm text-muted-foreground @xl:col-span-2 @xl:col-start-2 @xl:row-start-1">
                                        Same site as {displayUrl(rows[sameSite]!.url.trim())}, with its label and feedback.
                                    </p>
                                ) : (
                                    <>
                                        <div className="col-span-2 flex min-w-0 flex-col gap-1.5 @xl:col-span-1 @xl:col-start-2 @xl:row-start-1">
                                            <label htmlFor={`${formId}-label-${index}`} aria-hidden="true" className="text-xs text-muted-foreground @xl:hidden">Label</label>
                                            <Input
                                                id={`${formId}-label-${index}`}
                                                aria-label={`Label for ${name(row, index)}`}
                                                value={row.label}
                                                maxLength={60}
                                                onChange={event => setRow(index, { label: event.target.value })}
                                                placeholder={index === 0 ? 'Production' : 'Staging'} />
                                        </div>
                                        <div className="col-span-2 flex min-w-0 flex-col gap-1.5 @xl:col-span-1 @xl:col-start-3 @xl:row-start-1">
                                            <label htmlFor={`${formId}-share-${index}`} aria-hidden="true" className="text-xs text-muted-foreground @xl:hidden">Shares feedback with</label>
                                            <Select
                                                value={shared[0] === undefined ? 'none' : String(shared[0])}
                                                onValueChange={value => update(current => shareWith(current, index, value && value !== 'none' ? Number(value) : null))}
                                                disabled={options.length === 0}>
                                                <SelectTrigger id={`${formId}-share-${index}`} aria-label={`${name(row, index)} shares feedback with`} className="w-full">
                                                    <SelectValue>{sharedLabel}</SelectValue>
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectGroup>
                                                        <SelectItem value="none">No other address</SelectItem>
                                                        {options.map(({ row: option, other }) => (
                                                            <SelectItem key={other} value={String(other)}>{displayUrl(option.url.trim())}</SelectItem>
                                                        ))}
                                                    </SelectGroup>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>
                {rows.length < MAX_PROJECT_URLS && (
                    <Button variant="outline" size="sm" className="self-start" onClick={addRow}>
                        <PlusIcon data-icon="inline-start" />
                        Add address
                    </Button>
                )}
                <div className="flex flex-col gap-1">
                    {hasSchemelessLocal(rows) && <FieldDescription>Local addresses use HTTP by default. Include https:// for local HTTPS.</FieldDescription>}
                    <FieldDescription>Share feedback only between copies of one site, such as example.com and www.example.com: their comments show on the same pages. Removing an address keeps its comments.</FieldDescription>
                </div>
            </form>
        </Section>
    );
}

export function ProjectStatusButton({ projectId, status }: { projectId: string; status: ProjectStatus }) {
    const [pending, startTransition] = useTransition();
    const next: ProjectStatus = status === 'done' ? 'active' : 'done';

    // The action revalidates the app, which brings the new status
    const handleClick = () => startTransition(async () => {
        const result = await setProjectStatusAction(projectId, next);
        if (result && !result.ok)
            toast.error(result.error);
    });

    return (
        <Button variant="outline" disabled={pending} onClick={handleClick}>
            {pending && <Spinner data-icon="inline-start" />}
            {status === 'done' ? 'Reopen project' : 'Mark as done'}
        </Button>
    );
}

/** Deletes the project once its name is typed; the server checks the admin role and the name again */
export function DeleteProjectButton({ projectId, name }: { projectId: string; name: string }) {
    const router = useRouter();
    const inputId = useId();
    const input = useRef<HTMLInputElement>(null);
    const [open, setOpen] = useState(false);
    const [confirmation, setConfirmation] = useState('');
    const [pending, startTransition] = useTransition();
    const confirmed = confirmation.trim() === name;

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!confirmed || pending) return;
        startTransition(async () => {
            const result = await deleteProjectAction(projectId, confirmation);
            if (result && !result.ok) {
                toast.error(result.error);
                return;
            }
            toast.success(`${name} was deleted.`);
            router.push(KnownPages.AppProjects);
        });
    };

    return (
        <AlertDialog open={open} onOpenChange={next => {
            if (pending) return;
            setOpen(next);
            if (!next) setConfirmation('');
        }}>
            {/* Outlined like the row above; the variant's tinted fill leaves its red text under 4.5:1 */}
            <AlertDialogTrigger render={<Button variant="outline" className={destructiveTextClassName} />}>Delete project</AlertDialogTrigger>
            {/* Opens on the name field: typing it is the only way on */}
            <AlertDialogContent initialFocus={input}>
                <form className="contents" onSubmit={handleSubmit}>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Its comments, screenshots, review links, access and integration settings are deleted, and the toolbar stops working on its sites. Copies already sent to Notion, GitHub, Linear, Azure DevOps or Slack stay there. This can&apos;t be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <Field>
                        <FieldLabel htmlFor={inputId}>Type the project name to confirm</FieldLabel>
                        <Input ref={input} id={inputId} value={confirmation} onChange={event => setConfirmation(event.target.value)}
                            placeholder={name} autoComplete="off" spellCheck={false} disabled={pending} />
                    </Field>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                        <Button type="submit" variant="outline" className={destructiveTextClassName} disabled={!confirmed || pending}>
                            {pending && <Spinner data-icon="inline-start" />}
                            Delete project
                        </Button>
                    </AlertDialogFooter>
                </form>
            </AlertDialogContent>
        </AlertDialog>
    );
}

/** "a", "a and b", "a, b and c" */
const listText = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What a transfer leaves in this workspace, one sentence each */
export function transferStaysBehind({ integrations, people, teams, invitations }: TransferPreview) {
    return [
        integrations.length ? `${listText(integrations)} ${integrations.length === 1 ? 'is' : 'are'} disconnected. Connect again in the new workspace; items already sent stay where they are.` : '',
        people ? `${count(people, 'other person', 'other people')} here lose access, unless they also have it in the new workspace.` : '',
        teams ? `${count(teams, 'team', 'teams')} here no longer ${teams === 1 ? 'includes' : 'include'} it.` : '',
        invitations ? `${count(invitations, 'pending invitation no longer includes', 'pending invitations no longer include')} it.` : '',
        'Access tokens and connected apps of this workspace lose access to it.'
    ].filter(Boolean);
}

/**
 * Moves the project to another workspace the person administers, once its name is typed; the server
 * checks both roles and the name again. Afterwards the app opens the project in that workspace.
 */
export function TransferProjectButton({ projectId, name, targets, preview }: { projectId: string; name: string; targets: TransferTarget[]; preview: TransferPreview }) {
    const router = useRouter();
    const formId = useId();
    const input = useRef<HTMLInputElement>(null);
    const [open, setOpen] = useState(false);
    const [workspaceId, setWorkspaceId] = useState(targets.length === 1 ? targets[0]!.id : '');
    const [confirmation, setConfirmation] = useState('');
    const [pending, startTransition] = useTransition();
    const target = targets.find(option => option.id === workspaceId);
    const confirmed = Boolean(target) && confirmation.trim() === name;

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!confirmed || !target || pending) return;
        startTransition(async () => {
            const result = await transferProjectAction(projectId, target.id, confirmation);
            if (result && !result.ok) {
                toast.error(result.error);
                return;
            }
            toast.success(`${name} is in ${target.name} now.`);
            router.push(KnownPageLinks.project(projectId));
        });
    };

    return (
        <AlertDialog open={open} onOpenChange={next => {
            if (pending) return;
            setOpen(next);
            if (!next) setConfirmation('');
        }}>
            <AlertDialogTrigger render={<Button variant="outline" disabled={!targets.length} />}>Transfer project</AlertDialogTrigger>
            {/* With one workspace to choose, typing the name is the only step left */}
            <AlertDialogContent initialFocus={targets.length === 1 ? input : undefined} className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
                <form className="contents" onSubmit={handleSubmit}>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Transfer {name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            It moves with its comments, replies, screenshots, read state, review links and settings.{preview.client ? ` Its client, ${preview.client}, becomes that workspace's client with the same name.` : ''} Its address in the app stays the same. In the new workspace, admins and people with access to all projects can open it.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <FieldGroup>
                        <Field>
                            <FieldLabel htmlFor={`${formId}-workspace`}>Workspace</FieldLabel>
                            <Select value={workspaceId} onValueChange={value => setWorkspaceId(typeof value === 'string' ? value : '')} disabled={pending}
                                items={targets.map(option => ({ value: option.id, label: option.name }))}>
                                <SelectTrigger id={`${formId}-workspace`} className="w-full">
                                    <SelectValue placeholder="Choose a workspace" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {targets.map(option => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </Field>
                        <div className="flex flex-col gap-1.5">
                            <h3 id={`${formId}-behind`} className="m-0 text-sm font-medium">Stays in this workspace</h3>
                            <ul aria-labelledby={`${formId}-behind`} className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                                {transferStaysBehind(preview).map(line => <li key={line}>{line}</li>)}
                            </ul>
                        </div>
                        <Field>
                            <FieldLabel htmlFor={`${formId}-name`}>Type the project name to confirm</FieldLabel>
                            <Input ref={input} id={`${formId}-name`} value={confirmation} onChange={event => setConfirmation(event.target.value)}
                                placeholder={name} autoComplete="off" spellCheck={false} disabled={pending} />
                        </Field>
                    </FieldGroup>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                        <Button type="submit" disabled={!confirmed || pending}>
                            {pending && <Spinner data-icon="inline-start" />}
                            Transfer project
                        </Button>
                    </AlertDialogFooter>
                </form>
            </AlertDialogContent>
        </AlertDialog>
    );
}

/**
 * A person's own emails from a project, on or off at once (off mutes the project: no emails, also
 * not for threads they follow). Labelled by `label`, or named `ariaLabel` beside other text.
 */
export function ProjectEmailsSwitch({ projectId, muted, label, ariaLabel }: { projectId: string; muted: boolean; label?: string; ariaLabel?: string }) {
    const id = useId();
    const [optimisticMuted, setOptimisticMuted] = useOptimistic(muted);
    const [pending, startTransition] = useTransition();

    // The action revalidates the app; until then the switch shows the new setting
    const handleChange = (on: boolean) => startTransition(async () => {
        setOptimisticMuted(!on);
        const result = await setProjectEmailsMutedAction(projectId, !on);
        if (result && !result.ok)
            toast.error(result.error);
    });

    const control = <Switch id={id} checked={!optimisticMuted} onCheckedChange={handleChange} disabled={pending} aria-label={ariaLabel} />;
    return label
        ? (
            <Field orientation="horizontal" className="w-auto">
                {control}
                <FieldLabel htmlFor={id}>{label}</FieldLabel>
            </Field>
        )
        : control;
}

/** Whether project emails carry comment excerpts, on or off at once; the server action requires an admin */
export function ProjectEmailExcerptsSwitch({ projectId, enabled }: { projectId: string; enabled: boolean }) {
    const id = useId();
    const [state, action, pending] = useActionState(updateProjectEmailExcerptsAction, null);
    const [optimistic, setOptimistic] = useOptimistic(enabled);

    const handleChange = (on: boolean) => startTransition(() => {
        setOptimistic(on);
        const formData = new FormData();
        formData.set('projectId', projectId);
        formData.set('emailCommentExcerpts', String(on));
        action(formData);
    });

    return (
        <FieldGroup>
            <Field orientation="horizontal">
                <Switch id={id} checked={optimistic} onCheckedChange={handleChange} disabled={pending} aria-describedby={`${id}-description`} />
                <FieldContent>
                    <FieldLabel htmlFor={id}>Include comment excerpts</FieldLabel>
                    <FieldDescription id={`${id}-description`}>Up to 160 characters of each comment, sent to every recipient, verified guests included. Off by default.</FieldDescription>
                </FieldContent>
            </Field>
            <FormMessage state={state} />
        </FieldGroup>
    );
}
