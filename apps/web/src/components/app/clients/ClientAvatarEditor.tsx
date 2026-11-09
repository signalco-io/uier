'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImageUpIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLegend, FieldSet } from '@/src/components/ui/field';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/src/components/ui/popover';
import { Spinner } from '@/src/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/src/components/ui/toggle-group';
import { EditablePicture, usePictureUpload } from '@/src/components/app/EditablePicture';
import { KnownPageLinks } from '@/src/knownPages';
import { clientColors, clientIcons, type ClientColor, type ClientIcon } from '@/src/lib/app/clientAppearance';
import type { ClientSummary } from '@/src/lib/app/clients';
import { cn } from '@/src/lib/utils';
import { ClientMark, clientColorClasses, clientIconComponents, clientIconLabels } from './ClientMark';

const LETTER = 'letter';
const INK = 'ink';
const pickerItemClassName = 'size-11 p-0 data-pressed:border-foreground data-pressed:bg-transparent';

/** Logo changes save at once; icon and colour remain part of the edit dialog's draft. */
export function ClientAvatarEditor({ client, workspaceId, onIconChange, onColorChange, onPendingChange, disabled }: {
    client: ClientSummary;
    workspaceId: string;
    onIconChange: (icon: ClientIcon | undefined) => void;
    onColorChange: (color: ClientColor | undefined) => void;
    onPendingChange: (pending: boolean) => void;
    disabled: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [logoUrl, setLogoUrl] = useState(client.logoUrl);
    const [status, setStatus] = useState('');
    const router = useRouter();
    const { pending, error, fileInput, choose, remove } = usePictureUpload({
        endpoint: KnownPageLinks.clientLogoUpload(workspaceId, client.id),
        fileLabel: 'Client logo file',
        failed: 'The logo could not be saved.',
        onPendingChange: (next) => {
            if (next) setStatus('');
            onPendingChange(next);
        },
        onSaved: async (method, response) => {
            const result = method === 'POST' ? await response.json() as { url: string } : undefined;
            setLogoUrl(result?.url);
            setStatus(method === 'POST' ? 'Logo saved.' : 'Logo removed.');
            router.refresh();
        }
    });
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger render={<EditablePicture aria-label="Edit client avatar" disabled={disabled} className="size-12 rounded-xl" badgeClassName="-right-1.5 -bottom-1.5 size-5" />}>
                <ClientMark client={{ ...client, logoUrl }} className="size-12 rounded-xl text-lg" />
            </PopoverTrigger>
            <PopoverContent align="start" className="max-h-[min(32rem,80svh)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl">
                <PopoverTitle>Client avatar</PopoverTitle>
                <FieldGroup>
                    <Field data-invalid={error ? true : undefined}>
                        <div className="flex flex-wrap gap-2">
                            <Button variant="outline" className="pointer-coarse:min-h-11" disabled={pending} onClick={choose}>
                                {pending ? <Spinner data-icon="inline-start" /> : <ImageUpIcon data-icon="inline-start" />}
                                {logoUrl ? 'Change logo' : 'Upload logo'}
                            </Button>
                            {logoUrl && <Button variant="ghost" className="pointer-coarse:min-h-11" disabled={pending} onClick={remove}>Remove logo</Button>}
                        </div>
                        {fileInput}
                        <FieldDescription>PNG, JPEG, WebP or GIF, cropped to a square. Logo changes save immediately.</FieldDescription>
                        {error && <FieldError>{error}</FieldError>}
                        <p role="status" className="text-sm text-muted-foreground">{status}</p>
                    </Field>
                    <FieldSet disabled={pending || !!logoUrl}>
                        <FieldLegend variant="label">Icon</FieldLegend>
                        {logoUrl && <FieldDescription>Remove the logo to use an icon and colour.</FieldDescription>}
                        <ToggleGroup variant="outline" spacing={2} value={[client.icon ?? LETTER]} aria-label="Icon"
                            disabled={pending || !!logoUrl}
                            onValueChange={([value]) => value && onIconChange(value === LETTER ? undefined : value as ClientIcon)} className="flex-wrap">
                            <ToggleGroupItem value={LETTER} aria-label="First letter" className={cn(pickerItemClassName, 'text-sm font-semibold uppercase')}>
                                {client.name.trim()[0] ?? '?'}
                            </ToggleGroupItem>
                            {clientIcons.map(option => {
                                const Icon = clientIconComponents[option];
                                return <ToggleGroupItem key={option} value={option} aria-label={clientIconLabels[option]} className={pickerItemClassName}><Icon /></ToggleGroupItem>;
                            })}
                        </ToggleGroup>
                    </FieldSet>
                    <FieldSet disabled={pending || !!logoUrl}>
                        <FieldLegend variant="label">Colour</FieldLegend>
                        <ToggleGroup variant="outline" spacing={2} value={[client.color ?? INK]} aria-label="Colour"
                            disabled={pending || !!logoUrl}
                            onValueChange={([value]) => value && onColorChange(value === INK ? undefined : value as ClientColor)} className="flex-wrap">
                            <ToggleGroupItem value={INK} aria-label="Ink" className={pickerItemClassName}><span aria-hidden="true" className="size-4 rounded-full border bg-background" /></ToggleGroupItem>
                            {clientColors.map(option => <ToggleGroupItem key={option} value={option} aria-label={clientColorClasses[option].label} className={pickerItemClassName}>
                                <span aria-hidden="true" className={cn('size-4 rounded-full', clientColorClasses[option].swatch)} />
                            </ToggleGroupItem>)}
                        </ToggleGroup>
                    </FieldSet>
                </FieldGroup>
                <Button variant="outline" className="pointer-coarse:min-h-11" onClick={() => setOpen(false)}>Done</Button>
            </PopoverContent>
        </Popover>
    );
}
