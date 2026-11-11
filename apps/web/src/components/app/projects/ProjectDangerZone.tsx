'use client';

import { pluralText } from '../teams/pluralText';
import type { AppTranslator } from '@/src/lib/i18n/types';
import { useAppI18n } from '@/src/lib/i18n/client';
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
    const { t } = useAppI18n();
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
            {status === 'done' ? t("Reopen project") : t("Mark as done")}
        </Button>
    );
}

/** Deletes the project once its name is typed; the server checks the admin role and the name again */
export function DeleteProjectButton({ projectId, name }: { projectId: string; name: string }) {
    const { t } = useAppI18n();
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
            toast.success(t("{value0} was deleted.", { value0: name }));
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
            <AlertDialogTrigger render={<Button variant="outline" className={destructiveTextClassName} />}>{t("Delete project")}</AlertDialogTrigger>
            {/* Opens on the name field: typing it is the only way on */}
            <AlertDialogContent initialFocus={input}>
                <form className="contents" onSubmit={handleSubmit}>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t("Delete")}{' '}{name}?</AlertDialogTitle>
                        <AlertDialogDescription>{t("Its comments, screenshots, review links, access and integration settings are deleted, and the toolbar stops working on its sites. Copies already sent to Notion, GitHub, Linear, Azure DevOps or Slack stay there. This can't be undone.")}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <Field>
                        <FieldLabel htmlFor={inputId}>{t("Type the project name to confirm")}</FieldLabel>
                        <Input ref={input} id={inputId} value={confirmation} onChange={event => setConfirmation(event.target.value)}
                            placeholder={name} autoComplete="off" spellCheck={false} disabled={pending} />
                    </Field>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={pending}>{t("Cancel")}</AlertDialogCancel>
                        <Button type="submit" variant="outline" className={destructiveTextClassName} disabled={!confirmed || pending}>
                            {pending && <Spinner data-icon="inline-start" />}{t("Delete project")}</Button>
                    </AlertDialogFooter>
                </form>
            </AlertDialogContent>
        </AlertDialog>
    );
}

const english: AppTranslator = (message, values) => message.replace(/\{(\w+)\}/g, (match, key: string) => String(values?.[key] ?? match));

/** What a transfer leaves in this workspace, with names kept in the language they were written. */
export function transferStaysBehind({ integrations, people, teams, invitations }: TransferPreview, t: AppTranslator = english, language = 'en') {
    const integrationsList = new Intl.ListFormat(language, { style: 'long', type: 'conjunction' }).format(integrations);
    return [
        integrations.length ? t(integrations.length === 1
            ? '{items} is disconnected. Connect again in the new workspace; items already sent stay where they are.'
            : '{items} are disconnected. Connect again in the new workspace; items already sent stay where they are.', { items: integrationsList }) : '',
        people ? pluralText(t, language, people, '{count} other person here loses access, unless they also have it in the new workspace.', '{count} other people here lose access, unless they also have it in the new workspace.') : '',
        teams ? pluralText(t, language, teams, '{count} team here no longer includes it.', '{count} teams here no longer include it.') : '',
        invitations ? pluralText(t, language, invitations, '{count} pending invitation no longer includes it.', '{count} pending invitations no longer include it.') : '',
        t('Access tokens and connected apps of this workspace lose access to it.')
    ].filter(Boolean);
}

/**
 * Moves the project to another workspace the person administers, once its name is typed; the server
 * checks both roles and the name again. Afterwards the app opens the project in that workspace.
 */
export function TransferProjectButton({ projectId, name, targets, preview }: { projectId: string; name: string; targets: TransferTarget[]; preview: TransferPreview }) {
    const { t, language } = useAppI18n();
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
            toast.success(t("{value0} is in {value1} now.", { value0: name, value1: target.name }));
            router.push(KnownPageLinks.project(projectId));
        });
    };

    return (
        <AlertDialog open={open} onOpenChange={next => {
            if (pending) return;
            setOpen(next);
            if (!next) setConfirmation('');
        }}>
            <AlertDialogTrigger render={<Button variant="outline" disabled={!targets.length} />}>{t("Transfer project")}</AlertDialogTrigger>
            {/* With one workspace to choose, typing the name is the only step left */}
            <AlertDialogContent initialFocus={targets.length === 1 ? input : undefined} className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
                <form className="contents" onSubmit={handleSubmit}>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t("Transfer")}{' '}{name}?</AlertDialogTitle>
                        <AlertDialogDescription>{t("It moves with its comments, replies, screenshots, read state, review links and settings.")}{preview.client ? t(" Its client, {value0}, becomes that workspace's client with the same name.", { value0: preview.client }) : ''}{' '}{t("Its address in the app stays the same. In the new workspace, admins and people with access to all projects can open it.")}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <FieldGroup>
                        <Field>
                            <FieldLabel htmlFor={`${formId}-workspace`}>{t("Workspace")}</FieldLabel>
                            <Select value={workspaceId} onValueChange={value => setWorkspaceId(typeof value === 'string' ? value : '')} disabled={pending}
                                items={targets.map(option => ({ value: option.id, label: option.name }))}>
                                <SelectTrigger id={`${formId}-workspace`} className="w-full">
                                    <SelectValue placeholder={t("Choose a workspace")} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {targets.map(option => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </Field>
                        <div className="flex flex-col gap-1.5">
                            <h3 id={`${formId}-behind`} className="m-0 text-sm font-medium">{t("Stays in this workspace")}</h3>
                            <ul aria-labelledby={`${formId}-behind`} className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                                {transferStaysBehind(preview, t, language).map(line => <li key={line}>{line}</li>)}
                            </ul>
                        </div>
                        <Field>
                            <FieldLabel htmlFor={`${formId}-name`}>{t("Type the project name to confirm")}</FieldLabel>
                            <Input ref={input} id={`${formId}-name`} value={confirmation} onChange={event => setConfirmation(event.target.value)}
                                placeholder={name} autoComplete="off" spellCheck={false} disabled={pending} />
                        </Field>
                    </FieldGroup>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={pending}>{t("Cancel")}</AlertDialogCancel>
                        <Button type="submit" disabled={!confirmed || pending}>
                            {pending && <Spinner data-icon="inline-start" />}{t("Transfer project")}</Button>
                    </AlertDialogFooter>
                </form>
            </AlertDialogContent>
        </AlertDialog>
    );
}
