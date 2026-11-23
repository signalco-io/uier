'use client';

import type { ReactNode } from 'react';
import { Button } from '@uier/ui-primitives/Button';
import { cx } from '@uier/ui-primitives/cx';
import { IconButton } from '@uier/ui-primitives/IconButton';
import { Close } from '@uier/ui-icons';
import { MAX_RECORDING_DURATION, recordingClock, recordingLength, type RecordingState } from '../recordings';
import { useMessages } from '../i18n';
import { IconTooltip } from './IconTooltip';
import { composerIconButtonClassName } from './ComposerAttachments';
import { RecordingIcon } from './RecordingIcon';
import { destructiveTextClassName } from './@types/Comments';

/**
 * Above the text, inside its box: the running capture (time, Stop, Discard), or the clip to review
 * before sending, named with its length and its own Discard. Record screen and Upload recording are
 * in Attach's menu (`ComposerAttachMenu`). A line under the capture's bar parts it from the text; that
 * leaving the page ends the capture is read with Record screen, not shown under the bar.
 * `saved`: the same parts under a saved message, for a recording added to it later.
 */
export function ComposerRecordingPreview({ recording, disabled, saved }: {
    recording: RecordingState;
    disabled?: boolean;
    /**
     * Under a saved message instead of in a text box (`CommentAttach`): each part is its own bordered box, and
     * `action` (Attach recording) is under the clip, which has no Send
     */
    saved?: { action: ReactNode };
}) {
    const t = useMessages().recording;
    const barClassName = saved ? 'rounded-lg border py-1 pl-3 pr-1' : 'border-b border-border py-1.5 pl-3 pr-1.5';
    const discard = <IconTooltip label={t.discard}>
        <IconButton type="button" variant="plain" size="xs" className={composerIconButtonClassName} aria-label={t.discard} disabled={disabled && recording.phase === 'idle'}
            onClick={recording.discard}><Close size={16} aria-hidden="true" /></IconButton>
    </IconTooltip>;
    return <>
        {recording.clip && recording.previewUrl && <section aria-label={t.preview} className={cx('min-w-0 overflow-hidden rounded-lg border bg-muted', !saved && 'mx-2 mt-2')}>
            <video src={recording.previewUrl} controls preload="metadata" playsInline className="block max-h-44 w-full" aria-label={t.preview} />
            <div className="flex min-h-8 items-center gap-1.5 pl-2 pr-0.5 text-xs text-muted-foreground">
                <RecordingIcon size={14} />
                <span className="min-w-0 flex-1 truncate">{recording.clip.name}</span>
                <span className="shrink-0 font-mono tabular-nums">{recordingLength(recording.clip.duration)}</span>
                {discard}
            </div>
            {saved && <div className="flex justify-end px-1.5 pb-1.5">{saved.action}</div>}
        </section>}
        {recording.phase === 'recording' && <div data-uier-recording-bar="" className={barClassName}>
            <div className="flex min-h-7 items-center gap-2">
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-destructive motion-safe:animate-pulse" />
                <span role="timer" aria-live="off" className="min-w-0 flex-1 truncate font-mono text-xs tabular-nums">
                    {recordingClock(recording.elapsed)} / {recordingClock(MAX_RECORDING_DURATION)}
                </span>
                {/* Focused as it appears: the capture started from Attach's menu, which had the focus */}
                <Button type="button" variant="outlined" size="xs" autoFocus className="shrink-0 gap-1.5 rounded-md pointer-coarse:min-h-11"
                    aria-label={t.stop} onClick={recording.stop}
                    startDecorator={<span aria-hidden="true" className="size-2 rounded-[2px] bg-destructive" />}>{t.stopShort}</Button>
                {discard}
            </div>
        </div>}
        {(recording.phase === 'choosing' || recording.phase === 'reading') && <div className={cx('flex min-h-7 items-center gap-2', barClassName)}>
            <p role="status" className="m-0 min-w-0 flex-1 text-xs text-muted-foreground">{recording.phase === 'choosing' ? t.choosing : t.reading}</p>
            {discard}
        </div>}
        {recording.error && <p role="alert" className={cx('m-0 text-xs', saved ? destructiveTextClassName : 'px-3 pt-2 text-destructive')}>{t.problems[recording.error]}</p>}
    </>;
}
