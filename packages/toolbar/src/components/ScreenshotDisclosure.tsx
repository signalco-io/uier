'use client';

import { useEffect, useState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { cx } from '@signalco/ui-primitives/cx';

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

/**
 * Says, under a new comment's or feedback's text box, that a screenshot will be attached, and
 * lets the reviewer send only the text. Never a preview: composers stay without images (#81, #92).
 */
export function ScreenshotDisclosure({ screenshot, page, omitted, onOmittedChange }: {
    /** The capture started with the draft (src/screenshot.ts) */
    screenshot: Promise<string | undefined> | undefined;
    /** Feedback about the page: the screenshot is the visible page, not the commented part */
    page?: boolean;
    omitted: boolean;
    onOmittedChange: (omitted: boolean) => void;
}) {
    const state = useCaptureState(screenshot);
    const message = omitted
        ? 'No screenshot will be attached.'
        : state === 'capturing'
            ? 'Taking a screenshot...'
            : state === 'failed'
                ? 'The screenshot could not be taken. Only the text will be sent.'
                : page
                    ? 'A screenshot of the visible page will be attached.'
                    : 'A screenshot of this part of the page will be attached.';
    return (
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 bg-card px-3 pb-3">
            <p role="status" className="m-0 min-w-0 flex-1 text-xs text-muted-foreground">{message}</p>
            {(state !== 'failed' || omitted) && (
                <Button
                    variant="outlined"
                    size="xs"
                    type="button"
                    aria-pressed={omitted}
                    className={cx('shrink-0 rounded-md font-normal', omitted && 'bg-accent')}
                    onClick={() => onOmittedChange(!omitted)}>
                    Omit screenshot
                </Button>
            )}
        </div>
    );
}
