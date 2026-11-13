'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { cx } from '@signalco/ui-primitives/cx';
import { Check } from '@signalco/ui-icons';
import { useAttachedImage } from '../useAttachedImage';
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

/** Lucide's camera and camera-off, drawn like the UI kit's icons (the kit has no camera) */
function CameraIcon({ off, size = 16 }: { off?: boolean; size?: number }) {
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

/** A compact icon button of a composer's header or text box */
export const composerIconButtonClassName = 'size-7 shrink-0 rounded-md text-muted-foreground hover:text-foreground pointer-coarse:size-11';

/**
 * The header of a new comment or feedback: its title and `actions` (Expand). The screenshot toggle
 * ({@link ComposerScreenshotToggle}) and Attach ({@link ComposerAttachMenu}) are in the text box's
 * bottom-left corner. Never a preview: composers stay without images (#81, #92). An attached image's
 * problem shows here.
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
 * Attach screenshot, after Attach in the text box's bottom-left corner: pressed (ink, with a check)
 * while the automatic screenshot will be sent, so the choice is visible before sending. It says in
 * its tooltip and description what will be attached; the status is read out, not shown. An attached
 * image replaces the screenshot, so the toggle makes way until it is removed.
 */
export function ComposerScreenshotToggle({ screenshot, page, omitted, onOmittedChange, attachment }: {
    /** The capture started with the draft (src/screenshot.ts) */
    screenshot: Promise<string | undefined> | undefined;
    /** Feedback about the page: the screenshot is the visible page, not the commented part */
    page?: boolean;
    omitted: boolean;
    onOmittedChange: (omitted: boolean) => void;
    attachment: ReturnType<typeof useAttachedImage>;
}) {
    const state = useCaptureState(screenshot);
    const statusId = useId();
    const t = useMessages();
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
    const toggleTip = omitted
        ? t.attachments.attachScreenshot
        : t.attachments.textOnly(message);
    return (
        <>
            <p id={statusId} role="status" className="sr-only">{message}</p>
            {/* An attached image replaces the screenshot: the choice to omit it is back once the image is removed */}
            {!image && (state !== 'failed' || omitted) && (
                <IconTooltip label={toggleTip}>
                    <IconButton
                        variant={omitted ? 'plain' : 'solid'}
                        size="xs"
                        type="button"
                        aria-label={t.attachments.screenshotToggle}
                        aria-pressed={!omitted}
                        aria-describedby={statusId}
                        data-uier-screenshot-toggle=""
                        className={cx('h-7 w-auto min-w-7 shrink-0 gap-0.5 rounded-md px-1.5 pointer-coarse:h-11 pointer-coarse:min-w-11', omitted && 'text-muted-foreground hover:text-foreground')}
                        onClick={() => onOmittedChange(!omitted)}>
                        {!omitted && <Check size={14} aria-hidden="true" />}
                        <CameraIcon off={omitted} />
                    </IconButton>
                </IconTooltip>
            )}
        </>
    );
}
