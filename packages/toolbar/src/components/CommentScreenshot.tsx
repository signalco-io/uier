'use client';

import { useContext, useEffect, useRef, useState } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { Button } from '@signalco/ui-primitives/Button';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Upload } from '@signalco/ui-icons';
import { Input } from '@signalco/ui-primitives/Input';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { useQuery } from '@tanstack/react-query';
import { getCommentScreenshot } from '../hooks/useComments';
import { screenshotQueryKey } from '../hooks/api';
import type { CommentItem } from './@types/Comments';
import { destructiveTextClassName } from './@types/Comments';
import { suppliedScreenshot } from '../suppliedScreenshot';
import { useReplaceScreenshot } from '../hooks/useReplaceScreenshot';
import { ScreenshotRedaction } from './ScreenshotRedaction';

export const screenshotAlt = 'Screenshot of the commented part of the page';

const imageLimits = 'PNG, JPEG or WebP. Up to 512 KB and 4096 pixels on each side.';

/** Lucide's clipboard-paste (the UI kit has no clipboard icon), drawn like the kit's icons next to it */
function PasteIcon({ size = 16 }: { size?: number }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 14h10" />
            <path d="M16 4h2a2 2 0 0 1 2 2v1.344" />
            <path d="m17 18 4-4-4-4" />
            <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 1.793-1.113" />
            <rect x="8" y="2" width="8" height="4" rx="1" />
        </svg>
    );
}

/** Whether the element is in (or near) the window, once; scrolled containers count (the inbox) */
function useSeen<T extends Element>() {
    const ref = useRef<T>(null);
    const [seen, setSeen] = useState(false);
    useEffect(() => {
        const element = ref.current;
        if (!element || seen) {
            return;
        }
        const observer = new IntersectionObserver((entries) => {
            if (entries.some(entry => entry.isIntersecting)) {
                setSeen(true);
                observer.disconnect();
            }
        }, { rootMargin: '200px' });
        observer.observe(element);
        return () => observer.disconnect();
    });
    return [ref, seen] as const;
}

/**
 * The screenshot under a thread's first message, with icon buttons to upload or paste a new one
 * for its author (the limits are in their tooltips). The image is fetched when it comes into view
 * (the inbox lists many threads), once per image revision; until then a placeholder of its size
 * keeps the thread from jumping. Without a screenshot and nothing to do, it renders nothing.
 */
export function CommentScreenshot({ comment }: { comment: CommentItem }) {
    const size = comment.screenshot;
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const [working, setWorking] = useState(false);
    const workingRef = useRef(false);
    const sectionRef = useRef<HTMLElement>(null);
    const [message, setMessage] = useState('');
    const [failure, setFailure] = useState('');
    const replacement = useReplaceScreenshot(comment);
    const canReplace = comment.permissions?.edit ?? comment.isMine;
    const busy = working || replacement.isPending;
    const [placeholderRef, seen] = useSeen<HTMLDivElement>();
    const { data, isError } = useQuery({
        queryKey: [...screenshotQueryKey(comment.id), size?.revision ?? null],
        queryFn: () => getCommentScreenshot(comment.id),
        enabled: Boolean(size) && seen,
        staleTime: Infinity,
        retry: 1
    });
    const replace = async (dataUrl: string) => {
        await replacement.mutateAsync(dataUrl);
        setMessage('Screenshot replaced. The previous image has been removed.');
        setEditing(false);
        setOpen(false);
    };
    const supply = async (read: () => Promise<Blob>) => {
        if (workingRef.current || replacement.isPending) return;
        workingRef.current = true;
        setWorking(true);
        setFailure('');
        setMessage('');
        try { await replace(await suppliedScreenshot(await read())); }
        catch (error) {
            setFailure(`${error instanceof Error ? error.message : 'The image could not be saved.'} Replacement was not confirmed. Reload to check the saved image, or try again.`);
        } finally { workingRef.current = false; setWorking(false); }
    };
    const clipboard = async () => {
        if (!navigator.clipboard?.read) throw new Error('Clipboard access is unavailable. Upload an image or paste it with your keyboard.');
        let items: ClipboardItem[];
        try { items = await navigator.clipboard.read(); }
        catch { throw new Error('Clipboard access was denied. Upload an image or paste it with your keyboard.'); }
        for (const item of items) {
            const type = item.types.find(type => ['image/png', 'image/jpeg', 'image/webp'].includes(type));
            if (type) return item.getType(type);
        }
        throw new Error('The clipboard contains no PNG, JPEG or WebP image.');
    };

    if (!size && !canReplace) {
        return null;
    }

    return <section ref={sectionRef} aria-label="Screenshot evidence" className="flex flex-wrap items-center gap-1" onPaste={event => {
        if (!canReplace || busy || editing) return;
        const file = [...event.clipboardData.files][0];
        if (file) { event.preventDefault(); void supply(async () => file); }
    }}>
        {!size ? <span className="mr-1 text-xs text-muted-foreground">No screenshot</span>
            : isError ? <span className="mr-1 text-xs text-muted-foreground">The screenshot is no longer available.</span>
            : data
        ? (
            <Popper
                container={rootElement}
                open={open}
                onOpenChange={value => { if (!busy) { setOpen(value); if (!value) setEditing(false); } }}
                aria-label="Screenshot"
                className="z-[70] flex max-h-[min(var(--radix-popover-content-available-height),85vh)] w-[min(88vw,64rem)] flex-col gap-2 overflow-auto rounded-xl p-3"
                trigger={(
                    <Button variant="plain" className="mr-1 block h-auto w-24 cursor-zoom-in overflow-hidden rounded-lg p-0" aria-label={screenshotAlt} title="Expand screenshot">
                        <img src={data} width={size.width} height={size.height} alt={screenshotAlt}
                            className="block h-16 w-24 rounded-lg border object-contain" />
                    </Button>
                )}>
                <Button variant="plain" className="min-h-11 self-end" disabled={busy} onClick={() => { setOpen(false); setEditing(false); }}>Close screenshot</Button>
                {editing ? <ScreenshotRedaction key={size.revision ?? 'original'} data={data} pending={replacement.isPending}
                    onSave={replace} onCancel={() => setEditing(false)} /> : <>
                    <img src={data} width={size.width} height={size.height} alt="Expanded screenshot"
                        className="block min-h-0 w-full object-contain" />
                    {canReplace && <Button variant="plain" className="min-h-11 self-start" onClick={() => { setMessage(''); setEditing(true); }}>Redact screenshot</Button>}
                </>}
                {replacement.isPending && <p role="status" className="m-0 text-sm">Saving replacement...</p>}
            </Popper>
        )
        : (
            <div
                ref={placeholderRef}
                aria-hidden="true"
                className="mr-1 h-16 w-24 animate-pulse rounded-lg border bg-muted"
                style={{ aspectRatio: `${size.width} / ${size.height}` }} />
        )}
        {canReplace && <>
            <Input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload screenshot image" className="hidden"
                disabled={busy} onChange={event => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void supply(async () => file);
                }} />
            <IconButton size="xs" variant="plain" className="size-7 text-muted-foreground hover:text-foreground"
                title={`Upload image. ${imageLimits}`} aria-label="Upload image"
                disabled={busy || editing} onClick={() => sectionRef.current?.querySelector('input')?.click()}>
                <Upload size={16} />
            </IconButton>
            <IconButton size="xs" variant="plain" className="size-7 text-muted-foreground hover:text-foreground"
                title={`Paste image. ${imageLimits}`} aria-label="Paste image"
                disabled={busy || editing} onClick={() => { void supply(clipboard); }}>
                <PasteIcon />
            </IconButton>
        </>}
        {busy && <p role="status" className="m-0 basis-full text-xs text-muted-foreground">Saving replacement...</p>}
        {message && <p role="status" className="m-0 basis-full text-xs text-muted-foreground">{message}</p>}
        {failure && <p role="alert" className={`m-0 basis-full text-xs ${destructiveTextClassName}`}>{failure}</p>}
    </section>;
}
