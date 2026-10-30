'use client';

import { useActionState, useId, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { PlusIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Textarea } from '@/src/components/ui/textarea';
import { Input } from '@/src/components/ui/input';
import { RadioGroup } from '@/src/components/ui/radio-group';
import { Spinner } from '@/src/components/ui/spinner';
import { KnownPages } from '../../../knownPages';
import { ChoiceCard } from '../ChoiceCard';
import { FormMessage } from '../FormMessage';
import { Section } from '../PageHeader';
import { MAX_PROJECT_BRIEF_LENGTH, MAX_PROJECT_NAME_LENGTH } from '../../../lib/app/limits';
import type { ProjectAccess, ProjectStatus } from '../../../lib/app/model';
import { ClientNameInput } from './ClientNameInput';
import { UrlListInput } from './UrlListInput';
import { AccessIcon, projectAccessLabels } from './projectLabels';
import { updateProjectBriefAction, setProjectStatusAction, updateProjectAccessAction, updateProjectClientNameAction, updateProjectNameAction, updateProjectUrlsAction } from './actions';
import { updateProjectEmailExcerptsAction, updateProjectEnvironmentsAction, updateProjectPageStateAction } from './actions';
import { updateNotificationAction } from '../comments/notificationActions';
import { pageStatePolicy, type PageStatePolicy } from '@uier/toolbar/page-state';
import type { QueryFieldSuggestion } from '../../../lib/app/pageStateSuggestions';

/** The footer of a settings card: the outcome on the left, the submit button (of the form `formId`) on the right */
function SaveFooter({ formId, state, pending }: { formId: string; state: Parameters<typeof FormMessage>[0]['state']; pending: boolean }) {
    return (
        <>
            <FormMessage state={state} className="mr-auto" />
            <Button type="submit" form={formId} disabled={pending}>
                {pending && <Spinner data-icon="inline-start" />}
                Save
            </Button>
        </>
    );
}

export function ProjectNameForm({ projectId, name }: { projectId: string; name: string }) {
    const formId = useId();
    const [state, formAction, pending] = useActionState(updateProjectNameAction, null);
    const [value, setValue] = useState(name);
    return (
        <Section
            id="general"
            title="General"
            description="The name shows in the app and in invitations."
            footer={<SaveFooter formId={formId} state={state} pending={pending} />}>
            <form id={formId} action={formAction}>
                <input type="hidden" name="projectId" value={projectId} />
                <Field>
                    <FieldLabel htmlFor={`${formId}-name`}>Project name</FieldLabel>
                    <Input
                        id={`${formId}-name`}
                        name="name"
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        required
                        maxLength={MAX_PROJECT_NAME_LENGTH}
                        className="max-w-md" />
                </Field>
            </form>
        </Section>
    );
}

/** The client name, suggesting the existing `clients` */
export function ProjectClientNameForm({ projectId, clientName, clients }: { projectId: string; clientName?: string; clients: string[] }) {
    const formId = useId();
    const [state, formAction, pending] = useActionState(updateProjectClientNameAction, null);
    const [value, setValue] = useState(clientName ?? '');
    return (
        <Section id="client" title="Client"
            description={<>An optional name for the client this project is for. Leave it blank to remove it. Rename a client or change its icon and colour on the <Link href={KnownPages.AppClients} className="underline underline-offset-4 hover:text-foreground">Clients page</Link>.</>}
            footer={<SaveFooter formId={formId} state={state} pending={pending} />}>
            <form id={formId} action={formAction}>
                <input type="hidden" name="projectId" value={projectId} />
                <Field>
                    <FieldLabel htmlFor={`${formId}-client`}>Client name (optional)</FieldLabel>
                    <ClientNameInput id={`${formId}-client`} value={value} onValueChange={setValue} clients={clients} className="max-w-md" />
                </Field>
            </form>
        </Section>
    );
}

export function ProjectBriefForm({ projectId, brief, access }: { projectId: string; brief?: string; access: ProjectAccess }) {
    const formId = useId();
    const [state, action, pending] = useActionState(updateProjectBriefAction, null);
    const [value, setValue] = useState(brief ?? '');
    return <Section id="brief" title="Review brief" description="Tell reviewers what to review. Plain text only. Leave it blank to remove it."
        footer={<SaveFooter formId={formId} state={state} pending={pending} />}>
        <form id={formId} action={action}>
            <input type="hidden" name="projectId" value={projectId} />
            <Field>
                <FieldLabel htmlFor={`${formId}-brief`}>Review instructions</FieldLabel>
                <Textarea id={`${formId}-brief`} name="brief" value={value} onChange={event => setValue(event.target.value)} maxLength={MAX_PROJECT_BRIEF_LENGTH} rows={5} aria-describedby={`${formId}-readers`} />
                <FieldDescription id={`${formId}-readers`}>
                    {access === 'disabled' ? 'The brief is hidden from reviewers while comments are off.' : access === 'invited' ? 'Only invited people who can comment can read this brief.' : 'Anyone with the review link who can comment can read this brief.'} Up to {MAX_PROJECT_BRIEF_LENGTH} characters.
                </FieldDescription>
            </Field>
        </form>
    </Section>;
}

export function ProjectAccessForm({ projectId, access }: { projectId: string; access: ProjectAccess }) {
    const formId = useId();
    const [state, formAction, pending] = useActionState(updateProjectAccessAction, null);
    const [value, setValue] = useState<ProjectAccess>(access);
    return (
        <Section
            id="access"
            title="Who can comment"
            description="Who can see and leave comments with the toolbar on your site."
            footer={<SaveFooter formId={formId} state={state} pending={pending} />}>
            <form id={formId} action={formAction}>
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="access" value={value} />
                <RadioGroup value={value} onValueChange={(next) => setValue(next as ProjectAccess)} aria-label="Who can comment">
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
            </form>
        </Section>
    );
}

export function ProjectUrlsForm({ projectId, urls }: { projectId: string; urls: string[] }) {
    const formId = useId();
    const [state, formAction, pending] = useActionState(updateProjectUrlsAction, null);
    return (
        <Section
            id="addresses"
            title="Site addresses"
            description="The main site first, then staging or preview addresses. The toolbar works only on these."
            footer={<SaveFooter formId={formId} state={state} pending={pending} />}>
            <form id={formId} action={formAction}>
                <input type="hidden" name="projectId" value={projectId} />
                {/* Remounted with the saved (normalized) addresses */}
                <UrlListInput key={urls.join(' ')} defaultUrls={urls} hideLegend />
            </form>
        </Section>
    );
}

export function ProjectStatusButton({ projectId, status }: { projectId: string; status: ProjectStatus }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const next: ProjectStatus = status === 'done' ? 'active' : 'done';

    const handleClick = () => startTransition(async () => {
        const result = await setProjectStatusAction(projectId, next);
        if (result && !result.ok) {
            toast.error(result.error);
            return;
        }
        router.refresh();
    });

    return (
        <Button variant="outline" disabled={pending} onClick={handleClick}>
            {pending && <Spinner data-icon="inline-start" />}
            {status === 'done' ? 'Reopen project' : 'Mark as done'}
        </Button>
    );
}

/** The person's own emails from the project: muting stops all of them, also of threads they follow */
export function ProjectEmailsButton({ projectId, muted }: { projectId: string; muted: boolean }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();

    const handleClick = () => startTransition(async () => {
        const result = await updateNotificationAction(projectId, undefined, !muted);
        if (result && !result.ok) {
            toast.error(result.error);
            return;
        }
        router.refresh();
    });

    return (
        <Button variant="outline" disabled={pending} onClick={handleClick}>
            {pending && <Spinner data-icon="inline-start" />}
            {muted ? 'Unmute project emails' : 'Mute project emails'}
        </Button>
    );
}

export function ProjectPageStateForm({ projectId, policy, suggestions }: { projectId: string; policy?: PageStatePolicy; suggestions: QueryFieldSuggestion[] }) {
    const initial = pageStatePolicy(policy);
    const formId = useId();
    const [query, setQuery] = useState(initial.queryParameters.join(', '));
    const entered = query.split(/[,\s]+/).filter(Boolean);
    const available = suggestions.filter(suggestion => !entered.includes(suggestion.key));
    const [hash, setHash] = useState(initial.hashRouting);
    const [state, action, pending] = useActionState(updateProjectPageStateAction, null);
    return <Section id="page-state" title="Page state" description="Keep comments with the view being reviewed. By default, only the page path matters."
        footer={<SaveFooter formId={formId} state={state} pending={pending} />}>
        <form id={formId} action={action} onResetCapture={event => { event.preventDefault(); event.stopPropagation(); }}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="hashRouting" value={String(hash)} />
            <FieldGroup>
                <Field>
                    <FieldLabel htmlFor={`${formId}-query`}>Meaningful query fields</FieldLabel>
                    <Input id={`${formId}-query`} name="queryParameters" value={query} onChange={event => setQuery(event.target.value)} placeholder="category, sort, tab" />
                    <FieldDescription>Up to 12 names, separated by commas. Tracking, identity and credential fields are excluded. Use short route values; emails, URLs and token-like values are not saved.</FieldDescription>
                    {available.length > 0 && <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Query fields seen in recent comments">
                        <span className="text-sm text-muted-foreground">Seen in recent comments:</span>
                        {available.map(suggestion => <Button key={suggestion.key} type="button" variant="outline" size="xs"
                            title={`On ${suggestion.comments} recent ${suggestion.comments === 1 ? 'comment' : 'comments'}`}
                            onClick={() => setQuery([...entered, suggestion.key].join(', '))}>
                            <PlusIcon data-icon="inline-start" /><span className="font-mono">{suggestion.key}</span>
                        </Button>)}
                    </div>}
                </Field>
                <Field orientation="horizontal">
                    <Checkbox id={`${formId}-hash`} checked={hash} onCheckedChange={value => setHash(value === true)} />
                    <FieldLabel htmlFor={`${formId}-hash`}>Use hash routes (#/page or #!/page)</FieldLabel>
                </Field>
                <p className="m-0 text-sm text-muted-foreground">Existing comments keep their original view. Older path-only comments remain on that base page and in the site inbox.</p>
            </FieldGroup>
        </form>
    </Section>;
}


export function ProjectEnvironmentsForm({ projectId, environments }: { projectId: string; environments: import('../../../lib/app/environments').ProjectEnvironment[] }) {
    const formId = useId();
    const [values, setValues] = useState(environments.map(item => ({ ...item, label: item.label === item.origin ? '' : item.label, group: item.group ?? '' })));
    const [state, action, pending] = useActionState(updateProjectEnvironmentsAction, null);
    return <Section id="environments" title="Environments" description="Each origin has separate feedback. Use the same alias group only for equivalent sites that should share feedback."
        footer={<SaveFooter formId={formId} state={state} pending={pending} />}>
        <form id={formId} action={action} onResetCapture={event => { event.preventDefault(); event.stopPropagation(); }}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="environments" value={JSON.stringify(values)} />
            <FieldGroup>
                {values.map((item, index) => <fieldset key={item.origin} className="flex flex-col gap-3 rounded-xl border p-4">
                    <legend className="max-w-full truncate px-1 font-mono text-xs">{item.origin}</legend>
                    <Field><FieldLabel htmlFor={`${formId}-${index}-label`}>Environment label for {item.origin}</FieldLabel>
                        <Input id={`${formId}-${index}-label`} value={item.label} maxLength={60} onChange={event => setValues(current => current.map((value, i) => i === index ? { ...value, label: event.target.value } : value))} placeholder="Production, staging or preview" /></Field>
                    <Field><FieldLabel htmlFor={`${formId}-${index}-group`}>Alias group for {item.origin}</FieldLabel>
                        <Input id={`${formId}-${index}-group`} value={item.group} maxLength={60} onChange={event => setValues(current => current.map((value, i) => i === index ? { ...value, group: event.target.value } : value))} placeholder="Leave empty to isolate" /></Field>
                </fieldset>)}
                <FieldDescription>Addresses on the same origin share feedback. Grouped aliases share matching page views. Original sources and links stay unchanged. Removed addresses and feedback without a recorded source remain in the history filters.</FieldDescription>
            </FieldGroup>
        </form>
    </Section>;
}

/** Project email content policy; the server action independently requires an admin. */
export function ProjectEmailExcerptsForm({ projectId, enabled }: { projectId: string; enabled: boolean }) {
    const formId = useId();
    const [value, setValue] = useState(enabled);
    const [state, action, pending] = useActionState(updateProjectEmailExcerptsAction, null);
    return <form id={formId} action={action} className="flex flex-col gap-4"
        onResetCapture={event => { event.preventDefault(); event.stopPropagation(); }}>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="emailCommentExcerpts" value={String(value)} />
        <FieldGroup>
            <Field orientation="horizontal">
                <Checkbox id={`${formId}-excerpts`} checked={value} onCheckedChange={checked => setValue(checked === true)}
                    aria-describedby={`${formId}-description`} />
                <FieldContent>
                    <FieldLabel htmlFor={`${formId}-excerpts`}>Include comment excerpts</FieldLabel>
                    <FieldDescription id={`${formId}-description`}>Short comment excerpts go to every recipient, verified guests included. Off by default. Only workspace admins can change this.</FieldDescription>
                </FieldContent>
            </Field>
        </FieldGroup>
        <div className="flex items-center justify-end gap-3"><SaveFooter formId={formId} state={state} pending={pending} /></div>
    </form>;
}
