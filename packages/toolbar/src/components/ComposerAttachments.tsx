'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { IconButton } from '@uier/ui-primitives/IconButton';
import { Button } from '@uier/ui-primitives/Button';
import { cx } from '@uier/ui-primitives/cx';
import { Close } from '@uier/ui-icons';
import { useAttachedImage } from '../useAttachedImage';
import { ScreenshotImage } from '../screenshotImage';
import { IconTooltip, useIconTooltip } from './IconTooltip';
import { useToolbarPortalContainer } from './CommentsBootstrapperContext';
import { useInkContainer } from './InkScope';
import { destructiveTextClassName } from './@types/Comments';
import { ScreenshotViewer, viewerImageClassName } from './ScreenshotViewer';
import { useMessages } from '../i18n';

export { useAttachedImage, type AttachedImage } from '../useAttachedImage';

type CaptureState = 'capturing' | 'ready' | 'failed';


/** An automatic capture (src/screenshot.ts) and its image once taken; it resolves `undefined` when it failed or timed out */
function useCapture(screenshot: Promise<string | undefined> | undefined): { state: CaptureState; data?: string } {
    const [settled, setSettled] = useState<{ screenshot: Promise<string | undefined>; data: string | undefined }>();
    useEffect(() => {
        if (!screenshot) return;
        let active = true;
        void screenshot.then(data => { if (active) setSettled({ screenshot, data }); });
        return () => { active = false; };
    }, [screenshot]);
    if (!screenshot || settled?.screenshot !== screenshot) return { state: 'capturing' };
    return settled.data ? { state: 'ready', data: settled.data } : { state: 'failed' };
}

/** Lucide's camera and camera-off, drawn like the UI kit's icons (the kit has no camera) */
export function CameraIcon({ off, size = 16 }: { off?: boolean; size?: number }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {off ? <>
                <path d="M14.564 14.558a3 3 0 1 1-4.122-4.121" />
                <path d="m2 2 20 20" />
                <path d="M20 20H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 .819-.175" />
                <path d="M9.695 4.024A2 2 0 0 1 10.004 4h3.993a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v7.344" />
            </> : <>
                <path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" />
                <circle cx="12" cy="13" r="3" />
            </>}
        </svg>
    );
}

/** The start of what a thumbnail shows: the top-left corner of the commented part, as on the page */
const thumbnailClassName = 'block h-7 w-10 rounded-l-md object-cover object-left-top pointer-coarse:h-11 pointer-coarse:w-16';

/**
 * A small thumbnail of an image in a form, the first part of its chip: the automatic screenshot
 * ({@link ComposerScreenshot}) and an attached image (`ComposerAttachMenu`, uier #506). Named by its
 * button; pressing it opens the image in the {@link ScreenshotViewer}. The chip's X follows it.
 */
export function ComposerThumbnail({ data, label, viewerLabel, closeLabel, expandedAlt, describedBy, open: controlledOpen, onOpenChange, ...rest }: {
    /** The image as a data URL */
    data: string;
    /** The button's name */
    label: string;
    viewerLabel: string;
    closeLabel: string;
    expandedAlt: string;
    describedBy?: string;
    /** Controlled by a form that closes it itself (Remove screenshot); open on its own otherwise */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
} & Record<`data-${string}`, string>) {
    const container = useToolbarPortalContainer(useInkContainer());
    const [ownOpen, setOwnOpen] = useState(false);
    const open = controlledOpen ?? ownOpen;
    const tip = useIconTooltip(label);
    return <>
        {tip.tooltip}
        <ScreenshotViewer
            container={container}
            open={open}
            onOpenChange={next => { setOwnOpen(next); onOpenChange?.(next); }}
            label={viewerLabel}
            closeLabel={closeLabel}
            className="w-fit min-w-64 max-w-[min(40rem,calc(100vw-2rem))]"
            trigger={(
                <Button
                    variant="plain"
                    type="button"
                    {...tip.triggerProps}
                    {...rest}
                    aria-label={label}
                    aria-describedby={describedBy}
                    className="block h-auto shrink-0 cursor-zoom-in overflow-hidden rounded-none rounded-l-md p-0">
                    {/* Named by the button; the viewer has the image's own name */}
                    <span aria-hidden="true"><ScreenshotImage src={data} alt="" className={thumbnailClassName} /></span>
                </Button>
            )}>
            {/* At most its own size: a small image is not blown up */}
            <ScreenshotImage src={data} alt={expandedAlt} className={viewerImageClassName} />
        </ScreenshotViewer>
    </>;
}

/** A compact icon button of a composer's header or text box */
export const composerIconButtonClassName = 'size-7 shrink-0 rounded-md text-muted-foreground hover:text-foreground pointer-coarse:size-11';

/**
 * The header of a new comment or feedback: its title and `actions` (Expand). The screenshot's
 * thumbnail ({@link ComposerScreenshot}) and Attach (`ComposerAttachMenu`) are in the text box's
 * bottom-left corner. An attached image's problem shows here.
 */
export function ComposerAttachmentsHeader({ title, attachment, actions }: {
    title: ReactNode;
    attachment: ReturnType<typeof useAttachedImage>;
    /** More controls at the end of the line */
    actions?: ReactNode;
}) {
    const t = useMessages();
    const { error, problem } = attachment;
    return (
        <div className="bg-card px-3 pt-3">
            <div className="flex min-h-7 items-center justify-between gap-2">
                <div className="min-w-0">{title}</div>
                {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
            </div>
            {error && <p role="alert" className={cx('m-0 mt-1 text-xs', destructiveTextClassName)}>{problem ? t.imageProblems[problem] : error}</p>}
        </div>
    );
}

/**
 * The automatic screenshot, after Attach in the text box's bottom-left corner (uier #476): a small
 * thumbnail of the capture, which opens a larger preview, and Remove screenshot, which sends that one
 * comment as text only. While it is taken, a placeholder of the thumbnail's size holds its place;
 * removed, **Attach screenshot** (a camera) takes a new one. Its status is read out, not shown, and
 * describes the thumbnail. An attached image replaces the screenshot, so it makes way until the image
 * is removed; a capture that failed shows nothing.
 */
export function ComposerScreenshot({ screenshot, page, omitted, onOmittedChange, attachment }: {
    /** The capture started with the draft (src/screenshot.ts) */
    screenshot: Promise<string | undefined> | undefined;
    /** Feedback about the page: the screenshot is the visible page, not the commented part */
    page?: boolean;
    omitted: boolean;
    onOmittedChange: (omitted: boolean) => void;
    attachment: ReturnType<typeof useAttachedImage>;
}) {
    const { state, data } = useCapture(screenshot);
    const statusId = useId();
    const t = useMessages();
    const [previewing, setPreviewing] = useState(false);
    const attachRef = useRef<HTMLButtonElement>(null);
    const removeRef = useRef<HTMLButtonElement>(null);
    // Removed or attached again with its own button: the focus moves to the one that takes its place
    const moveFocus = useRef(false);
    useLayoutEffect(() => {
        if (!moveFocus.current) return;
        moveFocus.current = false;
        (omitted ? attachRef : removeRef).current?.focus();
    }, [omitted]);
    const change = (next: boolean) => {
        moveFocus.current = true;
        setPreviewing(false);
        onOmittedChange(next);
    };
    const { image, reading } = attachment;
    const message = image
        ? t.attachments.imageInstead(image.name)
        : reading
            ? t.attachments.reading
            : omitted
                ? t.attachments.noScreenshot
                : state === 'capturing'
                    ? t.attachments.capturing
                    : state === 'failed'
                        ? t.attachments.captureFailed
                        : page
                            ? t.attachments.pageScreenshot
                            : t.attachments.regionScreenshot;
    return (
        <>
            <p id={statusId} role="status" className="sr-only">{message}</p>
            {/* An attached image replaces the screenshot: the screenshot is back once the image is removed */}
            {!image && (omitted ? (
                <IconTooltip label={t.attachments.attachScreenshot}>
                    <IconButton
                        ref={attachRef}
                        variant="plain"
                        size="xs"
                        type="button"
                        aria-label={t.attachments.screenshotToggle}
                        aria-describedby={statusId}
                        data-uier-screenshot-attach=""
                        className={composerIconButtonClassName}
                        onClick={() => change(false)}>
                        <CameraIcon />
                    </IconButton>
                </IconTooltip>
            ) : state !== 'failed' && (
                // One chip, so its X reads as the screenshot's own, not as Discard's; an outline takes no room from the 44 px targets
                <span data-uier-screenshot="" className="flex shrink-0 items-center rounded-md bg-background ring-1 ring-border">
                    {data ? (
                        <ComposerThumbnail
                            data={data}
                            label={t.attachments.previewScreenshot}
                            viewerLabel={t.screenshot.label}
                            closeLabel={t.screenshot.close}
                            expandedAlt={t.screenshot.expanded}
                            describedBy={statusId}
                            open={previewing}
                            onOpenChange={setPreviewing}
                            data-uier-screenshot-preview="" />
                    ) : (
                        // Being taken: its place is kept, and it can be removed already (its work stops)
                        <span aria-hidden="true" data-image-placeholder="" className={cx(thumbnailClassName, 'animate-pulse bg-muted motion-reduce:animate-none')} />
                    )}
                    <IconTooltip label={t.attachments.removeScreenshot}>
                        <IconButton
                            ref={removeRef}
                            variant="plain"
                            size="xs"
                            type="button"
                            aria-label={t.attachments.removeScreenshot}
                            data-uier-screenshot-remove=""
                            className="h-7 w-6 shrink-0 rounded-none rounded-r-md text-muted-foreground hover:text-foreground pointer-coarse:size-11"
                            onClick={() => change(true)}>
                            <Close size={12} aria-hidden="true" />
                        </IconButton>
                    </IconTooltip>
                </span>
            ))}
        </>
    );
}
