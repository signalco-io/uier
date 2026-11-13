'use client';

import { useId, useRef, useSyncExternalStore } from 'react';
import { SquareIcon, UploadIcon, VideoIcon, XIcon } from 'lucide-react';
import { canRecordScreen, MAX_RECORDING_DURATION, recordingClock, recordingLength, recordingContentTypes, type RecordingState } from '@uier/toolbar/recordings';
import { Button } from '@/src/components/ui/button';
import { FieldDescription } from '@/src/components/ui/field';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { useAppI18n } from '@/src/lib/i18n/client';

const subscribe = () => () => {};
const noCaptureOnServer = () => false;
const buttonClassName = 'size-7 shrink-0 rounded-md text-muted-foreground hover:text-foreground pointer-coarse:size-11';

/**
 * Record screen and Upload video, after Attach image in the reply box. They make way once there is
 * a capture or a clip: its controls are with it, under the box ({@link ReplyRecordingPreview}).
 */
export function ReplyRecordingActions({ recording, disabled }: { recording: RecordingState; disabled?: boolean }) {
    const { t } = useAppI18n();
    const input = useRef<HTMLInputElement>(null);
    const limits = useId();
    const canCapture = useSyncExternalStore(subscribe, canRecordScreen, noCaptureOnServer);
    const offered = !recording.clip && recording.phase !== 'recording';
    return <>
        <span id={limits} className="sr-only">{t('MP4 or WebM, up to 60 seconds and 25 MB. Screen recordings have no audio.')}</span>
        {offered && canCapture && <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label={t('Record screen')} aria-describedby={limits}
                className={buttonClassName} disabled={disabled || recording.busy} onClick={() => void recording.start()} />}><VideoIcon /></TooltipTrigger>
            <TooltipContent>{t('Record screen')}</TooltipContent>
        </Tooltip>}
        {offered && <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label={t('Upload video')} aria-describedby={limits}
                className={buttonClassName} disabled={disabled || recording.busy} onClick={() => input.current?.click()} />}><UploadIcon /></TooltipTrigger>
            <TooltipContent>{t('Upload video')}</TooltipContent>
        </Tooltip>}
        <input ref={input} type="file" accept={recordingContentTypes.join(',')} aria-label={t('Video attachment')} tabIndex={-1}
            aria-hidden="true" className="hidden" disabled={disabled || recording.busy} onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void recording.attach(file);
            }} />
    </>;
}

/** Under the reply box: the running capture (time, Stop, Discard), or the clip to review before sending, with its own Discard. */
export function ReplyRecordingPreview({ recording, disabled }: { recording: RecordingState; disabled?: boolean }) {
    const { t } = useAppI18n();
    const discard = <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label={t('Discard recording')}
            className={buttonClassName} disabled={disabled && recording.phase === 'idle'} onClick={recording.discard} />}><XIcon /></TooltipTrigger>
        <TooltipContent>{t('Discard recording')}</TooltipContent>
    </Tooltip>;
    if (recording.phase === 'choosing') return <div className="flex min-h-7 items-center gap-2">
        <FieldDescription role="status" className="min-w-0 flex-1">{t('Choose a tab, window or screen to record.')}</FieldDescription>
        {discard}
    </div>;
    if (recording.phase === 'reading') return <FieldDescription role="status">{t('Preparing recording...')}</FieldDescription>;
    if (recording.phase === 'recording') return <div className="mt-1 min-w-0 space-y-1.5 rounded-lg border p-2" data-recording-capture="">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-destructive motion-safe:animate-pulse" />
            <span role="timer" aria-live="off" className="shrink-0 font-mono text-xs tabular-nums">
                {recordingClock(recording.elapsed)} / {recordingClock(MAX_RECORDING_DURATION)}
            </span>
            <span role="status" className="min-w-0 flex-1 basis-40 text-xs text-muted-foreground">{t('Recording screen. Stop when you have shown the issue.')}</span>
            <div className="ml-auto flex shrink-0 items-center gap-1">
                {/* Focused as it appears: the Record button it replaces had the focus */}
                <Button variant="outline" size="sm" autoFocus className="pointer-coarse:min-h-11" onClick={recording.stop}>
                    <SquareIcon data-icon="inline-start" className="size-2.5 fill-destructive text-destructive" />{t('Stop recording')}
                </Button>
                {discard}
            </div>
        </div>
        <FieldDescription>{t('Leaving or reloading this page ends the recording.')}</FieldDescription>
    </div>;
    if (!recording.clip || !recording.previewUrl) return null;
    return <div className="mt-1 w-full max-w-xl min-w-0 overflow-hidden rounded-lg border" data-recording-preview="">
        <video src={recording.previewUrl} controls muted playsInline preload="metadata" aria-label={t('Recording preview')}
            style={{ aspectRatio: `${recording.clip.width} / ${recording.clip.height}` }} className="block max-h-80 w-full bg-muted object-contain" />
        <div className="flex min-h-9 min-w-0 items-center gap-2 border-t pr-1 pl-2.5 text-xs text-muted-foreground">
            <VideoIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{recording.clip.name}</span>
            <span className="shrink-0 font-mono tabular-nums">{recordingLength(recording.clip.duration)}</span>
            {discard}
        </div>
        <FieldDescription className="border-t px-2.5 py-2">{t('Review the recording before sending. It stays on this page until you send it.')}</FieldDescription>
    </div>;
}
