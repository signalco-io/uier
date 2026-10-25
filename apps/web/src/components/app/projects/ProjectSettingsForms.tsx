'use client';

import { useActionState, useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { RadioGroup } from '@/src/components/ui/radio-group';
import { Spinner } from '@/src/components/ui/spinner';
import { ChoiceCard } from '../ChoiceCard';
import { FormMessage } from '../FormMessage';
import { Section } from '../PageHeader';
import { MAX_PROJECT_NAME_LENGTH } from '../../../lib/app/limits';
import type { ProjectAccess, ProjectStatus } from '../../../lib/app/model';
import { UrlListInput } from './UrlListInput';
import { AccessIcon, projectAccessLabels } from './projectLabels';
import { setProjectStatusAction, updateProjectAccessAction, updateProjectNameAction, updateProjectUrlsAction } from './actions';
import { updateProjectPageStateAction } from './actions';
import { pageStatePolicy, type PageStatePolicy } from '@uier/toolbar/page-state';

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
                <FieldGroup>
                    {/* Remounted with the saved (normalized) addresses */}
                    <UrlListInput key={urls.join(' ')} defaultUrls={urls} />
                </FieldGroup>
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

export function ProjectPageStateForm({ projectId, policy }: { projectId: string; policy?: PageStatePolicy }) {
    const initial = pageStatePolicy(policy);
    const formId = useId();
    const [query, setQuery] = useState(initial.queryParameters.join(', '));
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
