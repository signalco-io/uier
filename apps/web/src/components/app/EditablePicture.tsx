'use client';

import { useRef, useState, useTransition, type ComponentProps } from 'react';
import { PencilIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Spinner } from '@/src/components/ui/spinner';
import { avatarInputTypes } from '@/src/lib/app/avatarLimits';
import { fitForUpload } from '@/src/lib/app/fitAvatarUpload';
import { cn } from '@/src/lib/utils';

/**
 * A picture people can change (a profile picture, a client's logo): the picture itself is the button
 * that opens its options, with a small pencil badge on its corner to show it can be edited. Use it as
 * the `render` of a menu or popover trigger, with the picture as its children, and give it an
 * `aria-label` that names what it edits ("Edit profile picture"). `pending` shows a spinner over it.
 */
export function EditablePicture({ children, pending, className, badgeClassName, ...props }: ComponentProps<typeof Button> & {
    pending?: boolean;
    /** Moves the badge for a picture that is not a circle (a client's rounded square sits it on the corner) */
    badgeClassName?: string;
}) {
    return (
        <Button variant="ghost" size="icon" data-editable-picture className={cn('relative size-16 shrink-0 rounded-full p-0 hover:bg-transparent aria-expanded:bg-transparent dark:hover:bg-transparent', className)} {...props}>
            {children}
            {pending && (
                <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center rounded-[inherit] bg-background/70">
                    <Spinner />
                </span>
            )}
            <span aria-hidden="true" data-edit-badge
                className={cn('absolute right-0 bottom-0 flex size-6 items-center justify-center rounded-full border bg-background text-foreground transition-colors group-hover/button:bg-muted group-focus-visible/button:bg-muted', badgeClassName)}>
                <PencilIcon className="size-3" />
            </span>
        </Button>
    );
}

/**
 * Uploads (`POST`, multipart `file`, downsized in the browser first) and removes (`DELETE`) a picture at
 * `endpoint`, the shared shape of the profile picture and client logo routes. `fileInput` is the hidden
 * file field that `choose()` opens; render it once beside the picture. Each change saves at once.
 */
export function usePictureUpload({ endpoint, fileLabel, failed, onSaved, onPendingChange }: {
    endpoint: string;
    /** The hidden file field's accessible name ("Profile picture file") */
    fileLabel: string;
    /** The error when the server gives no reason ("Your picture could not be saved.") */
    failed: string;
    onSaved: (method: 'POST' | 'DELETE', response: Response) => Promise<void> | void;
    onPendingChange?: (pending: boolean) => void;
}) {
    const input = useRef<HTMLInputElement>(null);
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string>();

    const send = (method: 'POST' | 'DELETE', file?: File) => {
        onPendingChange?.(true);
        startTransition(async () => {
            setError(undefined);
            try {
                let body: FormData | undefined;
                if (file) {
                    body = new FormData();
                    body.set('file', await fitForUpload(file), file.name);
                }
                const response = await fetch(endpoint, { method, body });
                if (!response.ok) {
                    const result = await response.json().catch(() => null) as { message?: unknown } | null;
                    setError(typeof result?.message === 'string' ? result.message : `${failed} Try again.`);
                    return;
                }
                await onSaved(method, response);
            } catch {
                setError(`${failed} Check your connection and try again.`);
            } finally {
                onPendingChange?.(false);
            }
        });
    };

    const fileInput = (
        <input
            ref={input}
            type="file"
            accept={avatarInputTypes.join(',')}
            aria-label={fileLabel}
            hidden
            onChange={(event) => {
                const file = event.target.files?.[0];
                // The same file can be chosen again after an error
                event.target.value = '';
                if (file) send('POST', file);
            }} />
    );

    return {
        pending,
        error,
        fileInput,
        /** Opens the file chooser; call it from a click or key press */
        choose: () => input.current?.click(),
        remove: () => send('DELETE')
    };
}
