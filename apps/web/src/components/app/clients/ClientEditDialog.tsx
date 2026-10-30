'use client';

import { useActionState, useId, useState } from 'react';
import { PencilIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/src/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/src/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Spinner } from '@/src/components/ui/spinner';
import { Textarea } from '@/src/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/src/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { cn } from '@/src/lib/utils';
import { clientColors, clientIcons, type ClientColor, type ClientIcon } from '../../../lib/app/clientAppearance';
import type { ClientSummary } from '../../../lib/app/clients';
import { MAX_CLIENT_DESCRIPTION_LENGTH, MAX_CLIENT_NAME_LENGTH } from '../../../lib/app/limits';
import { FormMessage } from '../FormMessage';
import { ClientMark, clientColorClasses, clientIconComponents, clientIconLabels } from './ClientMark';
import { updateClientAction } from './actions';

// The pickers' "none" choices; the form sends them as empty values
const LETTER = 'letter';
const INK = 'ink';

const pickerItemClassName = 'size-9 p-0 data-[state=on]:border-foreground data-[state=on]:bg-transparent';

/** Edit a client (admins): its name, which every project of the client follows, description, icon and colour */
export function ClientEditDialog({ client, className }: { client: ClientSummary; className?: string }) {
    const [open, setOpen] = useState(false);
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <DialogTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${client.name}`} className={className}>
                            <PencilIcon />
                        </Button>
                    </DialogTrigger>
                </TooltipTrigger>
                <TooltipContent>Edit client</TooltipContent>
            </Tooltip>
            <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto">
                {/* The content unmounts when closed, so every opening starts from the saved client */}
                <ClientForm client={client} onSaved={() => setOpen(false)} />
            </DialogContent>
        </Dialog>
    );
}

function ClientForm({ client, onSaved }: { client: ClientSummary; onSaved: () => void }) {
    const id = useId();
    const [name, setName] = useState(client.name);
    const [description, setDescription] = useState(client.description ?? '');
    const [icon, setIcon] = useState<ClientIcon | undefined>(client.icon);
    const [color, setColor] = useState<ClientColor | undefined>(client.color);
    const [state, formAction, pending] = useActionState<Awaited<ReturnType<typeof updateClientAction>>, FormData>(async (previous, formData) => {
        const result = await updateClientAction(previous, formData);
        if (result?.ok) {
            toast.success(`${result.data.name} is saved.`);
            onSaved();
        }
        return result;
    }, null);

    return (
        <form action={formAction} className="flex flex-col gap-6">
            <DialogHeader className="flex-row items-center gap-3">
                <ClientMark client={{ name: name || client.name, icon, color }} className="size-10 rounded-xl text-base" />
                <div className="flex min-w-0 flex-col gap-1">
                    <DialogTitle>Edit client</DialogTitle>
                    <DialogDescription>Every project of this client shows the changes.</DialogDescription>
                </div>
            </DialogHeader>
            <input type="hidden" name="clientId" value={client.id} />
            <input type="hidden" name="icon" value={icon ?? ''} />
            <input type="hidden" name="color" value={color ?? ''} />
            <FieldGroup>
                <Field>
                    <FieldLabel htmlFor={`${id}-name`}>Client name</FieldLabel>
                    <Input
                        id={`${id}-name`}
                        name="name"
                        value={name}
                        onChange={event => setName(event.target.value)}
                        required
                        maxLength={MAX_CLIENT_NAME_LENGTH} />
                </Field>
                <Field>
                    <FieldLabel htmlFor={`${id}-description`}>Description (optional)</FieldLabel>
                    <Textarea
                        id={`${id}-description`}
                        name="description"
                        value={description}
                        onChange={event => setDescription(event.target.value)}
                        maxLength={MAX_CLIENT_DESCRIPTION_LENGTH}
                        rows={3} />
                    <FieldDescription>Shows on the Clients page to everyone who can open one of its projects.</FieldDescription>
                </Field>
                <FieldSet>
                    <FieldLegend variant="label">Icon</FieldLegend>
                    <ToggleGroup
                        type="single"
                        variant="outline"
                        spacing={2}
                        value={icon ?? LETTER}
                        onValueChange={value => value && setIcon(value === LETTER ? undefined : value as ClientIcon)}
                        className="flex-wrap">
                        <ToggleGroupItem value={LETTER} aria-label="First letter" className={cn(pickerItemClassName, 'text-sm font-semibold uppercase')}>
                            {(name || client.name).trim()[0] ?? '?'}
                        </ToggleGroupItem>
                        {clientIcons.map(option => {
                            const Icon = clientIconComponents[option];
                            return (
                                <ToggleGroupItem key={option} value={option} aria-label={clientIconLabels[option]} className={pickerItemClassName}>
                                    <Icon />
                                </ToggleGroupItem>
                            );
                        })}
                    </ToggleGroup>
                </FieldSet>
                <FieldSet>
                    <FieldLegend variant="label">Colour</FieldLegend>
                    <ToggleGroup
                        type="single"
                        variant="outline"
                        spacing={2}
                        value={color ?? INK}
                        onValueChange={value => value && setColor(value === INK ? undefined : value as ClientColor)}
                        className="flex-wrap">
                        <ToggleGroupItem value={INK} aria-label="Ink" className={pickerItemClassName}>
                            <span aria-hidden="true" className="size-4 rounded-full border bg-background" />
                        </ToggleGroupItem>
                        {clientColors.map(option => (
                            <ToggleGroupItem key={option} value={option} aria-label={clientColorClasses[option].label} className={pickerItemClassName}>
                                <span aria-hidden="true" className={cn('size-4 rounded-full', clientColorClasses[option].swatch)} />
                            </ToggleGroupItem>
                        ))}
                    </ToggleGroup>
                </FieldSet>
            </FieldGroup>
            <FormMessage state={state} />
            <DialogFooter>
                <DialogClose asChild>
                    <Button type="button" variant="outline">Cancel</Button>
                </DialogClose>
                <Button type="submit" disabled={pending}>
                    {pending && <Spinner data-icon="inline-start" />}
                    Save
                </Button>
            </DialogFooter>
        </form>
    );
}
