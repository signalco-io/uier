'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import { useActionState, useId, useState } from 'react';
import { PlusIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/src/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Spinner } from '@/src/components/ui/spinner';
import { Textarea } from '@/src/components/ui/textarea';
import { MAX_CLIENT_DESCRIPTION_LENGTH, MAX_CLIENT_NAME_LENGTH } from '../../../lib/app/limits';
import { FormMessage } from '../FormMessage';
import { createClientAction } from './actions';

export type ClientProjectOption = { id: string; name: string; done: boolean; client?: string };

/**
 * Add client (admins, the Clients tab): its name, the projects it is for and an optional description.
 * A client shows through its projects, so it needs one; its icon and colour are in Edit afterwards.
 */
export function ClientCreateDialog({ projects }: { projects: ClientProjectOption[] }) {
    const { t } = useAppI18n();
    const [open, setOpen] = useState(false);
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button />}>
                <PlusIcon data-icon="inline-start" />{t("Add client")}</DialogTrigger>
            <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto">
                {/* The content unmounts when closed, so every opening starts empty */}
                <ClientCreateForm projects={projects} onAdded={() => setOpen(false)} />
            </DialogContent>
        </Dialog>
    );
}

function ClientCreateForm({ projects, onAdded }: { projects: ClientProjectOption[]; onAdded: () => void }) {
    const { t } = useAppI18n();
    const id = useId();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    // The only project is the client's project
    const [selected, setSelected] = useState<string[]>(() => projects.length === 1 ? [projects[0]!.id] : []);
    const [state, formAction, pending] = useActionState<Awaited<ReturnType<typeof createClientAction>>, FormData>(async (previous, formData) => {
        const result = await createClientAction(previous, formData);
        if (result?.ok) {
            toast.success(t("{value0} is added.", { value0: result.data.name }));
            onAdded();
        }
        return result;
    }, null);
    const toggle = (projectId: string, checked: boolean) =>
        setSelected(current => checked ? [...new Set([...current, projectId])] : current.filter(other => other !== projectId));

    return (
        <form action={formAction} className="flex flex-col gap-6">
            <DialogHeader>
                <DialogTitle>{t("Add client")}</DialogTitle>
                <DialogDescription>{t("Who the projects are for. Everyone who can open one of them sees the client.")}</DialogDescription>
            </DialogHeader>
            {selected.map(projectId => <input key={projectId} type="hidden" name="project" value={projectId} />)}
            <FieldGroup>
                <Field>
                    <FieldLabel htmlFor={`${id}-name`}>{t("Client name")}</FieldLabel>
                    <Input
                        id={`${id}-name`}
                        name="name"
                        value={name}
                        onChange={event => setName(event.target.value)}
                        required
                        autoComplete="off"
                        maxLength={MAX_CLIENT_NAME_LENGTH} />
                </Field>
                <FieldSet>
                    <FieldLegend variant="label">{t("Projects")}</FieldLegend>
                    <FieldDescription>{t("A project moves to this client from any client it has now.")}</FieldDescription>
                    <FieldGroup data-slot="checkbox-group" className="max-h-48 gap-3 overflow-y-auto rounded-lg border p-3">
                        {projects.map(project => (
                            <Field key={project.id} orientation="horizontal">
                                <Checkbox
                                    id={`${id}-project-${project.id}`}
                                    checked={selected.includes(project.id)}
                                    onCheckedChange={checked => toggle(project.id, checked === true)} />
                                <FieldLabel htmlFor={`${id}-project-${project.id}`} className="font-normal">
                                    {project.name}
                                    {(project.done || project.client) && ' '}
                                    {(project.done || project.client) && (
                                        <span className="text-muted-foreground">
                                            {[project.done && t("Done"), project.client && t("Client: {value0}", { value0: project.client })].filter(Boolean).join(' · ')}
                                        </span>
                                    )}
                                </FieldLabel>
                            </Field>
                        ))}
                    </FieldGroup>
                </FieldSet>
                <Field>
                    <FieldLabel htmlFor={`${id}-description`}>{t("Description (optional)")}</FieldLabel>
                    <Textarea
                        id={`${id}-description`}
                        name="description"
                        value={description}
                        onChange={event => setDescription(event.target.value)}
                        maxLength={MAX_CLIENT_DESCRIPTION_LENGTH}
                        rows={2} />
                </Field>
            </FieldGroup>
            <FormMessage state={state} />
            <DialogFooter>
                <DialogClose render={<Button type="button" variant="outline" />}>{t("Cancel")}</DialogClose>
                <Button type="submit" disabled={pending || !selected.length}>
                    {pending && <Spinner data-icon="inline-start" />}{t("Add client")}</Button>
            </DialogFooter>
        </form>
    );
}
