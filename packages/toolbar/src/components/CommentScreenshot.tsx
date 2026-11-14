import { ScreenshotImage } from '../screenshotImage';
'use client';

import { useContext, useEffect, useRef, useState } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { Button } from '@signalco/ui-primitives/Button';
import { Upload } from '@signalco/ui-icons';
import { Input } from '@signalco/ui-primitives/Input';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { useQuery } from '@tanstack/react-query';
import { getCommentScreenshot } from '../hooks/useComments';
import { screenshotQueryKey } from '../hooks/api';
import type { CommentItem } from './@types/Comments';
import { destructiveTextClassName } from './@types/Comments';
import { useMessages } from '../i18n';
import { SuppliedImageError, suppliedScreenshot } from '../suppliedScreenshot';
import { useReplaceScreenshot } from '../hooks/useReplaceScreenshot';
import { ScreenshotRedaction } from './ScreenshotRedaction';
import { toolbarSurface } from '../toolbarReview';


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
 * The screenshot under a thread's first message. Its author replaces it from the expanded view
 * (Redact, Upload image, Paste image; the limits are in their tooltips), or adds one from the
 * thread while there is none. Pasting with the keyboard works in both. The image is fetched when it comes into view
 * (the inbox lists many threads), once per image revision; until then a placeholder of its size
 * keeps the thread from jumping. Without a screenshot and nothing to do, it renders nothing.
 */
export function CommentScreenshot({ comment, itemId }: { comment: CommentItem; itemId?: string }) {
    const item = itemId ? comment.thread.items.find(item => item.id === itemId) : undefined;
    const size = item && !item.deleted ? item.screenshot : itemId ? undefined : comment.screenshot;
    // Still sending: there is nothing to fetch yet, so the placeholder shows until the saved message replaces it
    const sending = Boolean(item && !item.deleted ? item.pending : comment.pending);
    const t = useMessages();
    const imageLimits = t.screenshot.limits;
    const label = itemId ? t.screenshot.replyImageAlt : t.screenshot.alt;
    const alt = itemId ? t.screenshot.replyImageAlt : t.screenshot.imageAlt;
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const [working, setWorking] = useState(false);
    const workingRef = useRef(false);
    const sectionRef = useRef<HTMLElement>(null);
    const [message, setMessage] = useState('');
    const [failure, setFailure] = useState('');
    const replacement = useReplaceScreenshot(comment);
    const canReplace = !itemId && (comment.permissions?.edit ?? comment.isMine);
    const busy = working || replacement.isPending;
    const [placeholderRef, seen] = useSeen<HTMLDivElement>();
    const { data, isError } = useQuery({
        queryKey: itemId ? [...screenshotQueryKey(comment.id), 'reply', itemId] : [...screenshotQueryKey(comment.id), comment.screenshot?.revision ?? null],
        queryFn: () => getCommentScreenshot(comment.id, itemId),
        enabled: Boolean(size) && seen && !sending,
        staleTime: Infinity,
        retry: 1
    });
    const replace = async (dataUrl: string) => {
        await replacement.mutateAsync(dataUrl);
        setMessage(t.screenshot.replaced);
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
            const reason = error instanceof SuppliedImageError ? t.imageProblems[error.problem] : error instanceof Error ? error.message : t.screenshot.notSaved;
            setFailure(t.screenshot.notConfirmed(reason));
        } finally { workingRef.current = false; setWorking(false); }
    };
    const clipboard = async () => {
        if (!navigator.clipboard?.read) throw new Error(t.screenshot.clipboardUnavailable);
        let items: ClipboardItem[];
        try { items = await navigator.clipboard.read(); }
        catch { throw new Error(t.screenshot.clipboardDenied); }
        for (const item of items) {
            const type = item.types.find(type => ['image/png', 'image/jpeg', 'image/webp'].includes(type));
            if (type) return item.getType(type);
        }
        throw new Error(t.screenshot.clipboardEmpty);
    };

    if (!size && !canReplace) {
        return null;
    }

    // Upload and paste: small labelled buttons beside "No screenshot", or in the expanded view
    const replaceActions = canReplace && <>
        <Button size="xs" variant="plain" className="text-muted-foreground hover:text-foreground"
            title={t.screenshot.uploadTip(imageLimits)} startDecorator={<Upload size={14} />}
            disabled={busy || editing} onClick={() => sectionRef.current?.querySelector('input')?.click()}>
            {t.screenshot.upload}
        </Button>
        <Button size="xs" variant="plain" className="text-muted-foreground hover:text-foreground"
            title={t.screenshot.pasteTip(imageLimits)} startDecorator={<PasteIcon size={14} />}
            disabled={busy || editing} onClick={() => { void supply(clipboard); }}>
            {t.screenshot.paste}
        </Button>
    </>;
    // Shown where the person is: in the expanded view while it is open, under the thumbnail otherwise
    const notices = <>
        {busy && <p role="status" className="m-0 basis-full text-xs text-muted-foreground">{t.screenshot.savingReplacement}</p>}
        {message && <p role="status" className="m-0 basis-full text-xs text-muted-foreground">{message}</p>}
        {failure && <p role="alert" className={`m-0 basis-full text-xs ${destructiveTextClassName}`}>{failure}</p>}
    </>;

    return <section ref={sectionRef} aria-label={t.screenshot.evidence} className="flex flex-wrap items-center gap-1" onPaste={event => {
        if (!canReplace || busy || editing) return;
        const file = [...event.clipboardData.files][0];
        if (file) { event.preventDefault(); void supply(async () => file); }
    }}>
        {!size ? <span className="mr-1 text-xs text-muted-foreground">{t.screenshot.none}</span>
            : isError ? <span className="mr-1 text-xs text-muted-foreground">{t.screenshot.unavailable}</span>
            : data
        ? (
            <Popper
                container={rootElement}
                open={open}
                onOpenChange={value => { if (!busy) { setOpen(value); if (!value) setEditing(false); } }}
                aria-label={t.screenshot.label}
                {...toolbarSurface('uier-screenshot', 'z-[70] flex max-h-[min(var(--radix-popover-content-available-height),85vh)] w-[min(88vw,64rem)] flex-col gap-2 overflow-auto rounded-xl p-3')}
                trigger={(
                    <Button variant="plain" className="mr-1 block h-auto w-24 cursor-zoom-in overflow-hidden rounded-lg p-0" aria-label={label} title={t.screenshot.expand}>
                        <ScreenshotImage src={data} width={size.width} height={size.height} alt={alt}
                            className="block h-16 w-24 rounded-lg border object-contain" />
                    </Button>
                )}>
                <Button variant="plain" className="min-h-11 self-end" disabled={busy} onClick={() => { setOpen(false); setEditing(false); }}>{t.screenshot.close}</Button>
                {editing ? <ScreenshotRedaction key={comment.screenshot?.revision ?? 'original'} data={data} pending={replacement.isPending}
                    onSave={replace} onCancel={() => setEditing(false)} /> : <>
                    <ScreenshotImage src={data} width={size.width} height={size.height} alt={t.screenshot.expanded}
                        className="block min-h-0 w-full object-contain" />
                    {canReplace && (
                        <div className="flex flex-wrap items-center gap-1">
                            <Button variant="plain" className="min-h-11" disabled={busy} onClick={() => { setMessage(''); setEditing(true); }}>{t.screenshot.redact}</Button>
                            {replaceActions}
                        </div>
                    )}
                </>}
                {open && notices}
            </Popper>
        )
        : (
            <div
                ref={placeholderRef}
                aria-hidden="true"
                data-image-placeholder=""
                className="mr-1 h-16 w-24 animate-pulse rounded-lg border bg-muted"
                style={size.width && size.height ? { aspectRatio: `${size.width} / ${size.height}` } : undefined} />
        )}
        {canReplace && (
            <Input type="file" accept="image/png,image/jpeg,image/webp" aria-label={t.screenshot.uploadInput} className="hidden"
                disabled={busy} onChange={event => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void supply(async () => file);
                }} />
        )}
        {!size && replaceActions}
        {!open && notices}
    </section>;
}
