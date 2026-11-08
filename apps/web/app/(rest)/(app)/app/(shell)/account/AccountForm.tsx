'use client';

import { useActionState, useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { ImageUpIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Spinner } from '@/src/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/src/components/ui/toggle-group';
import { Section } from '@/src/components/app/PageHeader';
import { PersonAvatar } from '@/src/components/app/PersonAvatar';
import { SaveFooter, useSettingsDraft } from '@/src/components/app/SettingsSave';
import { themeOptions } from '@/src/components/app/shell/AccountMenu';
import { KnownPages } from '@/src/knownPages';
import { avatarInputTypes, MAX_AVATAR_UPLOAD_BYTES } from '@/src/lib/app/avatarLimits';
import { MAX_NAME_LENGTH } from '@/src/lib/app/limits';
import { updateNameAction } from './actions';

/** Longer side of a photo scaled down in the browser before upload, when the file is over the limit */
const SHRINK_TO = 1024;

/**
 * A photo over the upload limit is scaled down here first (a phone camera's often is); the server
 * still checks and re-encodes whatever arrives. Anything the browser cannot draw goes as it is.
 */
async function fitForUpload(file: File): Promise<Blob> {
    if (file.size <= MAX_AVATAR_UPLOAD_BYTES) return file;
    try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, SHRINK_TO / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        return await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob ?? file), type, 0.9));
    } catch {
        return file;
    }
}

/** Upload, change or remove the profile picture; each saves at once, like a switch */
function ProfilePicture({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
    const id = useId();
    const router = useRouter();
    const input = useRef<HTMLInputElement>(null);
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string>();

    const send = (method: 'POST' | 'DELETE', file?: File) => startTransition(async () => {
        setError(undefined);
        try {
            let body: FormData | undefined;
            if (file) {
                body = new FormData();
                body.set('file', await fitForUpload(file), file.name);
            }
            const response = await fetch(KnownPages.AccountAvatar, { method, body });
            if (!response.ok) {
                const result = await response.json().catch(() => null) as { message?: unknown } | null;
                setError(typeof result?.message === 'string' ? result.message : 'Your picture could not be saved. Try again.');
                return;
            }
            toast(method === 'POST' ? 'Your picture is saved.' : 'Your picture is removed.');
            router.refresh();
        } catch {
            setError('Your picture could not be saved. Check your connection and try again.');
        }
    });

    return (
        <Field data-invalid={error ? true : undefined}>
            <FieldLabel id={`${id}-label`}>Picture</FieldLabel>
            <div className="flex flex-wrap items-center gap-4">
                <PersonAvatar name={name} avatarUrl={avatarUrl} aria-hidden="true" className="size-16" fallbackClassName="text-xl" />
                <div role="group" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" disabled={pending} onClick={() => input.current?.click()}>
                        {pending ? <Spinner data-icon="inline-start" /> : <ImageUpIcon data-icon="inline-start" />}
                        {avatarUrl ? 'Change picture' : 'Upload picture'}
                    </Button>
                    {avatarUrl && (
                        <Button variant="ghost" size="sm" disabled={pending} onClick={() => send('DELETE')}>Remove picture</Button>
                    )}
                </div>
                <input
                    ref={input}
                    type="file"
                    accept={avatarInputTypes.join(',')}
                    aria-label="Profile picture file"
                    hidden
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        // The same file can be chosen again after an error
                        event.target.value = '';
                        if (file) send('POST', file);
                    }} />
            </div>
            <FieldDescription id={`${id}-description`}>Shown beside your name. PNG, JPEG, WebP or GIF, cropped to a square.</FieldDescription>
            {error && <FieldError>{error}</FieldError>}
        </Field>
    );
}

export function AccountForm({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
    const formId = useId();
    const [state, formAction, pending] = useActionState(updateNameAction, null);
    const { draft, dirty, update, discard } = useSettingsDraft(name, state);
    return (
        <Section
            id="profile"
            title="Profile"
            footer={<SaveFooter formId={formId} state={state} pending={pending} dirty={dirty} onDiscard={discard} />}>
            <ProfilePicture name={name} avatarUrl={avatarUrl} />
            <form id={formId} action={formAction}>
                <Field>
                    <FieldLabel htmlFor={`${formId}-name`}>Name</FieldLabel>
                    <Input
                        id={`${formId}-name`}
                        name="name"
                        value={draft}
                        onChange={(event) => update(() => event.target.value)}
                        required
                        maxLength={MAX_NAME_LENGTH}
                        autoComplete="name"
                        className="max-w-md" />
                    <FieldDescription>Shown with your comments and to the people you work with.</FieldDescription>
                </Field>
            </form>
        </Section>
    );
}

/** Light, dark or the system's theme for the app (and the site), kept in this browser */
export function AppearanceSection() {
    const { theme, setTheme } = useTheme();
    // next-themes only knows the theme on the client; show "system" until mounted
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    return (
        <Section id="appearance" title="Appearance" description="How uier looks in this browser.">
            <ToggleGroup
                variant="outline"
                aria-label="Theme"
                value={[mounted ? (theme ?? 'system') : 'system']}
                onValueChange={([next]) => next && setTheme(next)}>
                {themeOptions.map(option => (
                    <ToggleGroupItem key={option.value} value={option.value} className="px-3">
                        <option.icon data-icon="inline-start" />
                        {option.label}
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
        </Section>
    );
}
