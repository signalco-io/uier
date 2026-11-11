'use client';

import { useActionState, useId } from 'react';
import Link from 'next/link';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSeparator } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { KnownPages } from '../../../knownPages';
import { Section } from '../PageHeader';
import { SaveFooter, useSettingsDraft } from '../SettingsSave';
import { MAX_PROJECT_NAME_LENGTH } from '../../../lib/app/limits';
import { ClientNameInput } from './ClientNameInput';
import { updateProjectGeneralAction } from './actions';
import { projectAiTitleModes, type ProjectAiTitleMode } from '../../../lib/titles/settings';
import type { ProjectSetting, ProjectSettingMode } from '../../../lib/app/inheritedSettings';
import { ProjectRewriteInstructionsFields } from './ProjectRewriteInstructionsFields';
import { keepValues } from './keepFormValues';

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
