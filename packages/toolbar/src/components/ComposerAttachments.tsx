'use client';

import { useEffect, useId, useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { cx } from '@signalco/ui-primitives/cx';
import { Close, Paperclip } from '@signalco/ui-icons';
import { suppliedScreenshot } from '../suppliedScreenshot';
import { screenshotContentTypes } from '../screenshotPolicy';
import { IconTooltip } from './IconTooltip';
import { destructiveTextClassName } from './@types/Comments';

/** The reviewer's own image, sent as the comment's image instead of the automatic screenshot (memory only) */
export type AttachedImage = { name: string; dataUrl: string };

type CaptureState = 'capturing' | 'ready' | 'failed';

const imageLimits = 'PNG, JPEG or WebP, up to 512 KB and 4096 pixels on each side.';

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

/**
 * The reviewer's own image for a new comment or feedback: chosen with the file picker or pasted
 * into the form, checked with the same formats and limits as saved evidence (suppliedScreenshot).
 * Held in memory only, never in draft or idempotency storage.
 */
export function useAttachedImage(initial?: AttachedImage) {
    const [image, setImage] = useState(initial);
    const [error, setError] = useState('');
    const [reading, setReading] = useState(false);
    const readingRef = useRef(false);
    const attach = async (file: Blob, name = file instanceof File && file.name ? file.name : 'Pasted image') => {
        if (readingRef.current) return;
        readingRef.current = true;
        setReading(true);
        setError('');
        try {
            setImage({ name, dataUrl: await suppliedScreenshot(file) });
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'The image could not be read. Choose it again.');
        } finally {
            readingRef.current = false;
            setReading(false);
        }
    };
    /** A pasted image file, unless text came with it (text is pasted as usual) */
    const handlePaste = (event: ClipboardEvent) => {
        const file = [...event.clipboardData.files].find(file => file.type.startsWith('image/'));
        if (!file || event.clipboardData.getData('text/plain')) return;
        event.preventDefault();
        void attach(file);
    };
    return {
        image,
        error,
        reading,
        attach,
        handlePaste,
        remove: () => { setImage(undefined); setError(''); },
        /** The image the request sends: the reviewer's, else the automatic capture unless it was omitted */
        screenshotFor: (omitted: boolean, capture: Promise<string | undefined> | undefined) =>
            image ? image.dataUrl : omitted ? undefined : capture
    };
}

/**
 * The header of a new comment or feedback: its title, then two compact controls. The screen
 * toggle (Omit screenshot, pressed shows a crossed-out screen) says in its tooltip and description
 * what will be attached; Attach image picks the reviewer's own image, sent instead of the screenshot.
 * Never a preview: composers stay without images (#81, #92). The status is read out, not shown.
 */
export function ComposerAttachmentsHeader({ title, screenshot, page, omitted, onOmittedChange, attachment }: {
    title: ReactNode;
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
    const limitsId = useId();
    const inputRef = useRef<HTMLInputElement>(null);
    const { image, error, reading } = attachment;
    const message = image
        ? `Your image ${image.name} will be attached instead of a screenshot.`
        : reading
            ? 'Reading your image...'
            : omitted
                ? 'No screenshot will be attached.'
                : state === 'capturing'
                    ? 'Taking a screenshot...'
                    : state === 'failed'
                        ? 'The screenshot could not be taken. Only the text will be sent.'
                        : page
                            ? 'A screenshot of the visible page will be attached.'
                            : 'A screenshot of this part of the page will be attached.';
    const toggleTip = omitted
        ? 'No screenshot will be attached. Select to attach one.'
        : `${message} Select to send only the text.`;
    const buttonClassName = 'size-7 shrink-0 rounded-md text-muted-foreground hover:text-foreground pointer-coarse:size-11';
    return (
        <div className="bg-card px-3 pt-3">
            <div className="flex min-h-7 items-center justify-between gap-2">
                <div className="min-w-0">{title}</div>
                <div className="flex shrink-0 items-center gap-0.5">
                    <p id={statusId} role="status" className="sr-only">{message}</p>
                    <span id={limitsId} className="sr-only">Sent instead of the screenshot. {imageLimits}</span>
                    {image ? (
                        <IconTooltip label="Your image is attached instead of a screenshot. Select to remove it.">
                            <Button
                                variant="plain"
                                size="xs"
                                type="button"
                                aria-label={`Remove attached image ${image.name}`}
                                className="max-w-40 gap-1 rounded-md font-normal text-muted-foreground hover:text-foreground pointer-coarse:min-h-11"
                                startDecorator={<Paperclip size={14} aria-hidden="true" />}
                                endDecorator={<Close size={14} aria-hidden="true" />}
                                onClick={attachment.remove}>
                                <span className="truncate">{image.name}</span>
                            </Button>
                        </IconTooltip>
                    ) : <>
                        {(state !== 'failed' || omitted) && (
                            <IconTooltip label={toggleTip}>
                                <IconButton
                                    variant="plain"
                                    size="xs"
                                    type="button"
                                    aria-label="Omit screenshot"
                                    aria-pressed={omitted}
                                    aria-describedby={statusId}
                                    className={cx(buttonClassName, omitted && 'text-foreground')}
                                    onClick={() => onOmittedChange(!omitted)}>
                                    <ScreenIcon off={omitted} />
                                </IconButton>
                            </IconTooltip>
                        )}
                        <IconTooltip label={`Attach your own image instead of the screenshot. ${imageLimits}`}>
                            <IconButton
                                variant="plain"
                                size="xs"
                                type="button"
                                aria-label="Attach image"
                                aria-describedby={limitsId}
                                disabled={reading}
                                className={buttonClassName}
                                onClick={() => inputRef.current?.click()}>
                                <Paperclip size={16} aria-hidden="true" />
                            </IconButton>
                        </IconTooltip>
                    </>}
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
                </div>
            </div>
            {error && <p role="alert" className={cx('m-0 mt-1 text-xs', destructiveTextClassName)}>{error}</p>}
        </div>
    );
}
