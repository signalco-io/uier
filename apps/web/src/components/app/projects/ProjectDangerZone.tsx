'use client';

import { useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/src/components/ui/alert-dialog';
import { Button } from '@/src/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { Spinner } from '@/src/components/ui/spinner';
import { KnownPageLinks, KnownPages } from '../../../knownPages';
import { destructiveTextClassName } from '../PageHeader';
import type { ProjectStatus } from '../../../lib/app/model';
import { deleteProjectAction, transferProjectAction, setProjectStatusAction } from './actions';
import type { TransferPreview, TransferTarget } from '../../../lib/app/projectTransfer';

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
