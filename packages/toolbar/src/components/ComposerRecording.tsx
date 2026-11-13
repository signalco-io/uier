'use client';

import { useId, useRef } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Close, Upload } from '@signalco/ui-icons';
import { canRecordScreen, MAX_RECORDING_DURATION, recordingClock, recordingLength, recordingContentTypes, type RecordingState } from '../recordings';
import { useMessages } from '../i18n';
import { IconTooltip } from './IconTooltip';
import { composerIconButtonClassName } from './ComposerAttachments';
import { RecordingIcon } from './RecordingIcon';

/**
 * Record screen and Upload recording, after Attach image in the text box's bottom-left corner. They
 * make way once there is a capture or a clip: its controls are with it, above the text
 * ({@link ComposerRecordingPreview}), so the row never holds two Discard buttons.
 */
export function ComposerRecordingControls({ recording, disabled }: { recording: RecordingState; disabled?: boolean }) {
    const t = useMessages().recording;
    const input = useRef<HTMLInputElement>(null);
    const limits = useId();
    const offered = !recording.clip && recording.phase !== 'recording';
    return <>
        <span id={limits} className="sr-only">{t.limits} {t.navigation}</span>
        {offered && canRecordScreen() && <IconTooltip label={t.record}>
            <IconButton type="button" variant="plain" size="xs" className={composerIconButtonClassName}
                aria-label={t.record} aria-describedby={limits} disabled={disabled || recording.busy} onClick={() => void recording.start()}><RecordingIcon /></IconButton>
        </IconTooltip>}
        {offered && <IconTooltip label={t.upload}>
            <IconButton type="button" variant="plain" size="xs" className={composerIconButtonClassName}
                aria-label={t.upload} aria-describedby={limits} disabled={disabled || recording.busy} onClick={() => input.current?.click()}><Upload size={16} aria-hidden="true" /></IconButton>
        </IconTooltip>}
        <input ref={input} type="file" accept={recordingContentTypes.join(',')} className="hidden" tabIndex={-1} aria-hidden="true"
            onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void recording.attach(file); }} />
    </>;
}

/**
 * Above the text, inside its box: the running capture (time, Stop, Discard), or the clip to review
 * before sending, named with its length and its own Discard.
 */
export function ComposerRecordingPreview({ recording, disabled }: { recording: RecordingState; disabled?: boolean }) {
    const t = useMessages().recording;
    const discard = <IconTooltip label={t.discard}>
        <IconButton type="button" variant="plain" size="xs" className={composerIconButtonClassName} aria-label={t.discard} disabled={disabled && recording.phase === 'idle'}
            onClick={recording.discard}><Close size={16} aria-hidden="true" /></IconButton>
    </IconTooltip>;
    return <>
        {recording.clip && recording.previewUrl && <section aria-label={t.preview} className="mx-2 mt-2 min-w-0 overflow-hidden rounded-lg border bg-muted">
            <video src={recording.previewUrl} controls preload="metadata" playsInline className="block max-h-44 w-full" aria-label={t.preview} />
            <div className="flex min-h-8 items-center gap-1.5 pl-2 pr-0.5 text-xs text-muted-foreground">
                <RecordingIcon size={14} />
                <span className="min-w-0 flex-1 truncate">{recording.clip.name}</span>
                <span className="shrink-0 font-mono tabular-nums">{recordingLength(recording.clip.duration)}</span>
                {discard}
            </div>
        </section>}
        {recording.phase === 'recording' && <div className="px-3 pt-2">
            <div className="flex min-h-7 items-center gap-2">
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-destructive motion-safe:animate-pulse" />
                <span role="timer" aria-live="off" className="min-w-0 flex-1 truncate font-mono text-xs tabular-nums">
                    {recordingClock(recording.elapsed)} / {recordingClock(MAX_RECORDING_DURATION)}
                </span>
                {/* Focused as it appears: the Record button it replaces had the focus */}
                <Button type="button" variant="outlined" size="xs" autoFocus className="shrink-0 gap-1.5 rounded-md pointer-coarse:min-h-11"
                    aria-label={t.stop} onClick={recording.stop}
                    startDecorator={<span aria-hidden="true" className="size-2 rounded-[2px] bg-destructive" />}>{t.stopShort}</Button>
                {discard}
            </div>
            <p role="status" className="m-0 pt-1 text-xs text-muted-foreground">{t.navigation}</p>
        </div>}
        {(recording.phase === 'choosing' || recording.phase === 'reading') && <div className="flex min-h-7 items-center gap-2 pl-3 pr-1.5 pt-2">
            <p role="status" className="m-0 min-w-0 flex-1 text-xs text-muted-foreground">{recording.phase === 'choosing' ? t.choosing : t.reading}</p>
            {discard}
        </div>}
        {recording.error && <p role="alert" className="m-0 px-3 pt-2 text-xs text-destructive">{t.problems[recording.error]}</p>}
    </>;
}
