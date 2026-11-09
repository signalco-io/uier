'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { cx } from '@signalco/ui-primitives/cx';
import { IconTooltip } from './IconTooltip';

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

/**
 * The header of a new comment or feedback: its title, then a compact screen toggle (Omit
 * screenshot, pressed shows a crossed-out screen) that says in its tooltip and description what
 * will be attached. Never a preview: composers stay without images (#81, #92). The status is read
 * out, not shown.
 */
export function ComposerAttachmentsHeader({ title, screenshot, page, omitted, onOmittedChange }: {
    title: ReactNode;
    /** The capture started with the draft (src/screenshot.ts) */
    screenshot: Promise<string | undefined> | undefined;
    /** Feedback about the page: the screenshot is the visible page, not the commented part */
    page?: boolean;
    omitted: boolean;
    onOmittedChange: (omitted: boolean) => void;
}) {
    const state = useCaptureState(screenshot);
    const statusId = useId();
    const message = omitted
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
                </div>
            </div>
        </div>
    );
}
