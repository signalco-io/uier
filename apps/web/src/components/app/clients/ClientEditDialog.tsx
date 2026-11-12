'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import { useActionState, useId, useState } from 'react';
import { PencilIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/src/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/src/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Spinner } from '@/src/components/ui/spinner';
import { Textarea } from '@/src/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { type ClientColor, type ClientIcon } from '../../../lib/app/clientAppearance';
import type { ClientSummary } from '../../../lib/app/clients';
import { MAX_CLIENT_DESCRIPTION_LENGTH, MAX_CLIENT_NAME_LENGTH } from '../../../lib/app/limits';
import { FormMessage } from '../FormMessage';
import { ClientAvatarEditor } from './ClientAvatarEditor';
import { updateClientAction } from './actions';

/** Edit a client (admins): its name, which every project of the client follows, description, icon and colour */
export function ClientEditDialog({ client, workspaceId, className }: { client: ClientSummary; workspaceId: string; className?: string }) {
    const { t } = useAppI18n();
    const [open, setOpen] = useState(false);
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <Tooltip>
                <TooltipTrigger render={<DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("Edit {value0}", { value0: client.name })} className={className} />} />}>
                    <PencilIcon />
                </TooltipTrigger>
                <TooltipContent>{t("Edit client")}</TooltipContent>
            </Tooltip>
            <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto">
                {/* The content unmounts when closed, so every opening starts from the saved client */}
                <ClientForm client={client} workspaceId={workspaceId} onSaved={() => setOpen(false)} />
            </DialogContent>
        </Dialog>
    );
}

function ClientForm({ client, workspaceId, onSaved }: { client: ClientSummary; workspaceId: string; onSaved: () => void }) {
    const { t } = useAppI18n();
    const id = useId();
    const [uploading, setUploading] = useState(false);
    const [name, setName] = useState(client.name);
    const [description, setDescription] = useState(client.description ?? '');
    const [icon, setIcon] = useState<ClientIcon | undefined>(client.icon);
    const [color, setColor] = useState<ClientColor | undefined>(client.color);
    const [state, formAction, pending] = useActionState<Awaited<ReturnType<typeof updateClientAction>>, FormData>(async (previous, formData) => {
        const result = await updateClientAction(previous, formData);
        if (result?.ok) {
            toast.success(t("{value0} is saved.", { value0: result.data.name }));
            onSaved();
        }
        return result;
    }, null);

    return (
        <form action={formAction} className="flex flex-col gap-6">
            <DialogHeader className="flex-row items-center gap-3">
                <ClientAvatarEditor client={{ ...client, name: name || client.name, icon, color }} workspaceId={workspaceId}
                    onIconChange={setIcon} onColorChange={setColor} onPendingChange={setUploading} disabled={pending || uploading} />
                <div className="flex min-w-0 flex-col gap-1">
                    <DialogTitle>{t("Edit client")}</DialogTitle>
                    <DialogDescription>{t("Every project of this client shows the changes.")}</DialogDescription>
                </div>
            </DialogHeader>
            <input type="hidden" name="clientId" value={client.id} />
            <input type="hidden" name="icon" value={icon ?? ''} />
            <input type="hidden" name="color" value={color ?? ''} />
            <FieldGroup>
                <Field>
                    <FieldLabel htmlFor={`${id}-name`}>{t("Client name")}</FieldLabel>
                    <Input
                        id={`${id}-name`}
                        name="name"
                        value={name}
                        onChange={event => setName(event.target.value)}
                        required
                        maxLength={MAX_CLIENT_NAME_LENGTH} />
                </Field>
                <Field>
                    <FieldLabel htmlFor={`${id}-description`}>{t("Description (optional)")}</FieldLabel>
                    <Textarea
                        id={`${id}-description`}
                        name="description"
                        value={description}
                        onChange={event => setDescription(event.target.value)}
                        maxLength={MAX_CLIENT_DESCRIPTION_LENGTH}
                        rows={3} />
                </Field>
            </FieldGroup>
            <FormMessage state={state} />
            <DialogFooter>
                <DialogClose render={<Button type="button" variant="outline" disabled={uploading} />}>{t("Cancel")}</DialogClose>
                <Button type="submit" disabled={pending || uploading}>
                    {pending && <Spinner data-icon="inline-start" />}{t("Save")}</Button>
            </DialogFooter>
        </form>
    );
}
