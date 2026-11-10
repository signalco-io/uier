'use client';

import { useRef, useState, useTransition, type ClipboardEvent, type ComponentProps, type DragEvent } from 'react';
import { PencilIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Spinner } from '@/src/components/ui/spinner';
import { AVATAR_TYPE_ERROR, avatarInputTypes } from '@/src/lib/app/avatarLimits';
import { fitForUpload } from '@/src/lib/app/fitAvatarUpload';
import { cn } from '@/src/lib/utils';

/**
 * A picture people can change (a profile picture, a client's logo): the picture itself is the button
 * that opens its options, with a small pencil badge on its corner to show it can be edited. Use it as
 * the `render` of a menu or popover trigger, with the picture as its children, and give it an
 * `aria-label` that names what it edits ("Edit profile picture"). `pending` shows a spinner over it.
 * Spread `usePictureUpload`'s `dropTarget` on it so an image can be dropped on it or pasted while it has focus.
 */
export function EditablePicture({ children, pending, className, badgeClassName, ...props }: ComponentProps<typeof Button> & {
    pending?: boolean;
    /** Moves the badge for a picture that is not a circle (a client's rounded square sits it on the corner) */
    badgeClassName?: string;
}) {
    return (
        <Button variant="ghost" size="icon" data-editable-picture aria-busy={pending || undefined} className={cn('relative size-16 shrink-0 rounded-full p-0 hover:bg-transparent aria-expanded:bg-transparent dark:hover:bg-transparent', dropTargetClassName, className)} {...props}>
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

/** Outlines an element while an image file is dragged over it (`dropTarget` marks it `data-drop-target`) */
export const dropTargetClassName = 'data-drop-target:ring-2 data-drop-target:ring-ring';

const acceptedTypes: readonly string[] = avatarInputTypes;
const carriesFiles = (data: DataTransfer | null) => !!data && Array.from(data.types).includes('Files');

/**
 * Uploads (`POST`, multipart `file`, downsized in the browser first) and removes (`DELETE`) a picture at
 * `endpoint`, the shared shape of the profile picture and client logo routes. `fileInput` is the hidden
 * file field that `choose()` opens; render it once beside the picture. Each change saves at once.
 *
 * `dropTarget` takes an image dropped on, or pasted into, the elements it is spread on: the picture
 * (the picker's trigger) and the picker's open menu or popover. Paste only reaches them while the focus
 * is inside, so the page's clipboard is never read elsewhere, and text pastes pass through untouched.
 * A file that is not an image gets the server's own message before anything is sent.
 */
export function usePictureUpload({ endpoint, fileLabel, failed, onSaved, onPendingChange, disabled }: {
    endpoint: string;
    /** The hidden file field's accessible name ("Profile picture file") */
    fileLabel: string;
    /** The error when the server gives no reason ("Your picture could not be saved.") */
    failed: string;
    onSaved: (method: 'POST' | 'DELETE', response: Response) => Promise<void> | void;
    onPendingChange?: (pending: boolean) => void;
    /** Drops and pastes are ignored (the picker's trigger is disabled) */
    disabled?: boolean;
}) {
    const input = useRef<HTMLInputElement>(null);
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string>();
    // One change at a time: a second one while the first saves is ignored
    const busy = useRef(false);

    const send = (method: 'POST' | 'DELETE', file?: File) => {
        if (busy.current) return;
        busy.current = true;
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
                busy.current = false;
                onPendingChange?.(false);
            }
        });
    };

    /** The first image of a drop or paste (or its first file, to say why it can't be used) */
    const upload = (files: FileList) => {
        const file = Array.from(files).find(item => acceptedTypes.includes(item.type)) ?? files[0];
        if (!file) return;
        // An empty type is left to the server, which reads the format from the file itself
        if (file.type && !acceptedTypes.includes(file.type)) {
            setError(AVATAR_TYPE_ERROR);
            return;
        }
        send('POST', file);
    };

    // Entering a child fires dragenter on it before dragleave on its parent, so count them per element
    const depths = useRef(new WeakMap<HTMLElement, number>());
    const mark = (element: HTMLElement, change: number) => {
        const depth = change === 0 ? 0 : Math.max(0, (depths.current.get(element) ?? 0) + change);
        depths.current.set(element, depth);
        element.toggleAttribute('data-drop-target', depth > 0);
    };

    const dropTarget = {
        onDragEnter: (event: DragEvent<HTMLElement>) => {
            if (!carriesFiles(event.dataTransfer)) return;
            event.preventDefault();
            if (!disabled) mark(event.currentTarget, 1);
        },
        onDragOver: (event: DragEvent<HTMLElement>) => {
            if (!carriesFiles(event.dataTransfer)) return;
            // Always handled, so a file dropped on a disabled picker is not opened by the browser instead
            event.preventDefault();
            event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
        },
        onDragLeave: (event: DragEvent<HTMLElement>) => {
            if (carriesFiles(event.dataTransfer)) mark(event.currentTarget, -1);
        },
        onDrop: (event: DragEvent<HTMLElement>) => {
            if (!carriesFiles(event.dataTransfer)) return;
            event.preventDefault();
            event.stopPropagation();
            mark(event.currentTarget, 0);
            if (!disabled) upload(event.dataTransfer.files);
        },
        onPaste: (event: ClipboardEvent<HTMLElement>) => {
            if (!event.clipboardData.files.length) return;
            event.preventDefault();
            event.stopPropagation();
            if (!disabled) upload(event.clipboardData.files);
        }
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
        dropTarget,
        /** Opens the file chooser; call it from a click or key press */
        choose: () => input.current?.click(),
        remove: () => send('DELETE')
    };
}
