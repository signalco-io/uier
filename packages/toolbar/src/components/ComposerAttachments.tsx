'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { cx } from '@signalco/ui-primitives/cx';
import { Close, Paperclip } from '@signalco/ui-icons';
import { useAttachedImage } from '../useAttachedImage';
import { screenshotContentTypes } from '../screenshotPolicy';
import { IconTooltip } from './IconTooltip';
import { destructiveTextClassName } from './@types/Comments';
import { useMessages } from '../i18n';

export { useAttachedImage, type AttachedImage } from '../useAttachedImage';

type CaptureState = 'capturing' | 'ready' | 'failed';


/** Whether an automatic capture (src/screenshot.ts) is still running; it resolves `undefined` when it failed or timed out */
function useCaptureState(screenshot: Promise<string | undefined> | undefined): CaptureState {
    const [settled, setSettled] = useState<{ screenshot: Promise<string | undefined>; ready: boolean }>();
    useEffect(() => {
        if (!screenshot) return;
        let active = true;
        void screenshot.then(data => { if (active) setSettled({ screenshot, ready: Boolean(data) }); });
        return () => { active = false; };
    }, [screenshot]);
    if (!screenshot || settled?.screenshot !== screenshot) return 'capturing';
    return settled.ready ? 'ready' : 'failed';
}

/** Lucide's monitor and monitor-off, drawn like the UI kit's icons (the kit has no crossed-out screen) */
function ScreenIcon({ off, size = 16 }: { off?: boolean; size?: number }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {off ? <>
                <path d="M17 17H4a2 2 0 0 1-2-2V5c0-1.5 1-2 1-2" />
                <path d="M22 15V5a2 2 0 0 0-2-2H9" />
                <path d="M8 21h8" />
                <path d="M12 17v4" />
                <path d="m2 2 20 20" />
            </> : <>
                <rect width="20" height="14" x="2" y="3" rx="2" />
                <path d="M8 21h8" />
                <path d="M12 17v4" />
            </>}
        </svg>
    );
}

/** A compact icon button of a composer's header or text box */
export const composerIconButtonClassName = 'size-7 shrink-0 rounded-md text-muted-foreground hover:text-foreground pointer-coarse:size-11';

/**
 * The header of a new comment or feedback: its title, then the screen toggle (Omit screenshot,
 * pressed shows a crossed-out screen), which says in its tooltip and description what will be
 * attached, and `actions` (Expand). Attach image is in the text box's bottom-left corner
 * ({@link ComposerAttachButton}). Never a preview: composers stay without images (#81, #92). The
 * status is read out, not shown.
 */
export function ComposerAttachmentsHeader({ title, screenshot, page, omitted, onOmittedChange, attachment, actions }: {
    title: ReactNode;
    /** The capture started with the draft (src/screenshot.ts) */
    screenshot: Promise<string | undefined> | undefined;
    /** Feedback about the page: the screenshot is the visible page, not the commented part */
    page?: boolean;
    omitted: boolean;
    onOmittedChange: (omitted: boolean) => void;
    attachment: ReturnType<typeof useAttachedImage>;
    /** More controls at the end of the line */
    actions?: ReactNode;
}) {
    const state = useCaptureState(screenshot);
    const statusId = useId();
    const t = useMessages();
    const { image, error, problem, reading } = attachment;
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
    const toggleTip = omitted
        ? t.attachments.attachScreenshot
        : t.attachments.textOnly(message);
    return (
        <div className="bg-card px-3 pt-3">
            <div className="flex min-h-7 items-center justify-between gap-2">
                <div className="min-w-0">{title}</div>
                <div className="flex shrink-0 items-center gap-0.5">
                    <p id={statusId} role="status" className="sr-only">{message}</p>
                    {/* An attached image replaces the screenshot: the choice to omit it is back once the image is removed */}
                    {!image && (state !== 'failed' || omitted) && (
                        <IconTooltip label={toggleTip}>
                            <IconButton
                                variant="plain"
                                size="xs"
                                type="button"
                                aria-label={t.attachments.omitScreenshot}
                                aria-pressed={omitted}
                                aria-describedby={statusId}
                                className={cx(composerIconButtonClassName, omitted && 'text-foreground')}
                                onClick={() => onOmittedChange(!omitted)}>
                                <ScreenIcon off={omitted} />
                            </IconButton>
                        </IconTooltip>
                    )}
                    {actions}
                </div>
            </div>
            {error && <p role="alert" className={cx('m-0 mt-1 text-xs', destructiveTextClassName)}>{problem ? t.imageProblems[problem] : error}</p>}
        </div>
    );
}

/**
 * Attach image, in the bottom-left corner of a new comment's or feedback's text box (`attachments`
 * of `CommentComposer`), so it reads as a part of the comment: picks the reviewer's own image, sent
 * instead of the screenshot. Once attached, its name with a remove button takes its place.
 */
export function ComposerAttachButton({ attachment, reply = false }: { attachment: ReturnType<typeof useAttachedImage>; reply?: boolean }) {
    const limitsId = useId();
    const t = useMessages();
    const imageLimits = t.attachments.imageLimits;
    const inputRef = useRef<HTMLInputElement>(null);
    const { image, reading } = attachment;
    return (
        <>
            <span id={limitsId} className="sr-only">{reply ? t.attachments.attachedToReply : t.attachments.sentInstead} {imageLimits}</span>
            {image ? (
                <IconTooltip label={reply ? t.attachments.replyImageRemove : t.attachments.imageRemove}>
                    <Button
                        variant="plain"
                        size="xs"
                        type="button"
                        aria-label={t.attachments.removeImage(image.name)}
                        className="min-w-0 max-w-40 gap-1 rounded-md font-normal text-muted-foreground hover:text-foreground pointer-coarse:min-h-11"
                        startDecorator={<Paperclip size={14} aria-hidden="true" />}
                        endDecorator={<Close size={14} aria-hidden="true" />}
                        onClick={attachment.remove}>
                        <span className="truncate">{image.name}</span>
                    </Button>
                </IconTooltip>
            ) : (
                <IconTooltip label={`${reply ? t.attachments.attachToReply : t.attachments.attachInstead} ${imageLimits}`}>
                    <IconButton
                        variant="plain"
                        size="xs"
                        type="button"
                        aria-label={t.attachments.attachImage}
                        aria-describedby={limitsId}
                        disabled={reading}
                        className={composerIconButtonClassName}
                        onClick={() => inputRef.current?.click()}>
                        <Paperclip size={16} aria-hidden="true" />
                    </IconButton>
                </IconTooltip>
            )}
            <input
                ref={inputRef}
                type="file"
                accept={screenshotContentTypes.join(',')}
                tabIndex={-1}
                aria-hidden="true"
                className="hidden"
                onChange={event => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void attachment.attach(file);
                }} />
        </>
    );
}
