'use client';

import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Popper } from '@signalco/ui-primitives/Popper';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Stack } from '@signalco/ui-primitives/Stack';
import { cx } from '@signalco/ui-primitives/cx';
import { Paperclip, Upload } from '@signalco/ui-icons';
import { canRecordScreen, recordingContentTypes, useRecording, type RecordingState } from '../recordings';
import { screenshotContentTypes } from '../screenshotPolicy';
import { SuppliedImageError, suppliedScreenshot } from '../suppliedScreenshot';
import { captureCommentScreenshot } from '../screenshot';
import { useReplaceScreenshot } from '../hooks/useReplaceScreenshot';
import { useAttachRecording } from '../hooks/useAttachRecording';
import { useMessages } from '../i18n';
import { moveFocusInMenu } from '../focusKeys';
import { keepMovedFocus } from '../toolbarReview';
import { CommentsBootstrapperContext, useToolbarPortalContainer } from './CommentsBootstrapperContext';
import { useIconTooltip } from './IconTooltip';
import { useInkContainer } from './InkScope';
import { useAnnounce } from './Announcer';
import { CameraIcon } from './ComposerAttachments';
import { ComposerRecordingPreview } from './ComposerRecording';
import { PasteIcon, readClipboardImage } from './CommentScreenshot';
import { RecordingIcon } from './RecordingIcon';
import { destructiveTextClassName, floatingShadowClassName, type CommentItem } from './@types/Comments';

/**
 * The recording being added to a thread's first message, kept by what stays mounted while the thread is
 * closed (a pin, `CommentBubble`): the capture goes on and the clip waits there. Without one, `CommentAttach`
 * keeps its own (the inbox and inline threads stay mounted).
 */
export const ThreadRecordingContext = createContext<RecordingState | undefined>(undefined);

/** Whether a capture is being chosen or is running: the thread stays open so Stop stays in reach */
export const isCapturing = (recording: RecordingState) => recording.phase === 'choosing' || recording.phase === 'recording';

/** The screenshot could not be taken: said as it is, without "not attached" after it */
class CaptureFailed extends Error {}

/**
 * Attach, among the first message's actions in the thread's header line (uier #473): one paperclip whose menu
 * adds what the saved comment does not have yet, for those who may edit it (its author, or a project's admin).
 * It replaces the "No screenshot · Upload image · Paste image" row, so a thread without evidence has no row for it.
 * - An image, while there is no screenshot: Take screenshot (the commented part of the page as it is now, only
 *   on the comment's own page at the address it was left on), Attach image and Paste image. Each is saved like a replaced screenshot, under
 *   the same formats and limits; a paste with the keyboard works while Attach or its menu has the focus.
 * - A recording, while there is none: Record screen, where the browser can capture, and Upload recording.
 *   The capture and the clip show under the message (`panel`); a clip is attached with Attach recording.
 * With nothing left to add, the button goes. What is being saved and what failed show in `panel` too, a
 * slot under the message that takes no room while it is empty.
 */
export function CommentAttach({ comment, panel, disabled }: { comment: CommentItem; panel: HTMLElement | null; disabled?: boolean }) {
    // Project DTOs carry the permission; public comments belong to their author
    if (comment.pending || !(comment.permissions?.edit ?? comment.isMine)) return null;
    return <AttachControl comment={comment} panel={panel} disabled={disabled} />;
}

function AttachControl({ comment, panel, disabled }: { comment: CommentItem; panel: HTMLElement | null; disabled?: boolean }) {
    const t = useMessages();
    const announce = useAnnounce();
    const { rootElement, path } = useContext(CommentsBootstrapperContext);
    // In a thread shown as a sheet, its dialog (a modal makes the rest inert); else dark in the ink scope like the inbox
    const container = useToolbarPortalContainer(useInkContainer());
    const [open, setOpen] = useState(false);
    const [stage, setStage] = useState<'capturing' | 'reading' | 'saving'>();
    const working = useRef(false);
    const [failure, setFailure] = useState('');
    const triggerRef = useRef<HTMLButtonElement>(null);
    const imageInput = useRef<HTMLInputElement>(null);
    const recordingInput = useRef<HTMLInputElement>(null);
    const captureId = useId();
    const imageLimitsId = useId();
    const recordingLimitsId = useId();
    const replacement = useReplaceScreenshot(comment);
    const shared = useContext(ThreadRecordingContext);
    const own = useRecording();
    const recording = shared ?? own;
    const attachRecording = useAttachRecording(comment);
    const tip = useIconTooltip(t.attachments.attachToComment);

    // Attached from somewhere else meanwhile (another tab, a retry that did save): the clip has no place left
    const hasRecording = Boolean(comment.recording);
    useEffect(() => {
        if (hasRecording && !attachRecording.isPending) recording.discard();
        // Only when the comment's recording appears
    }, [hasRecording]);

    // The document being reviewed is the one the comment was left on: its canonical page, at its own origin.
    // Addresses that share feedback show each other's threads, but a capture here is of this address, and would
    // be saved as the other's evidence. A project comment names its source; one whose source is gone or was never
    // recorded gets no capture. Public comments are kept per site, so their page is enough.
    const onSourcePage = comment.path === path
        && (!comment.source || (comment.source.available && comment.source.origin === window.location.origin));
    const offerImage = !comment.screenshot;
    const offerRecording = !hasRecording && !recording.clip && recording.phase !== 'recording';
    const offerCapture = offerRecording && canRecordScreen();
    const savingImage = Boolean(stage) || replacement.isPending;
    const imageDisabled = disabled || savingImage;
    const recordingDisabled = disabled || recording.busy || attachRecording.isPending;

    // The new evidence takes the focus when what had it is gone with nothing left to add: Attach, or Attach
    // recording. Checked after each render until the saved comment shows that evidence.
    const focusAfter = useRef<'screenshot' | 'recording' | undefined>(undefined);
    useEffect(() => {
        const kind = focusAfter.current;
        if (!kind || !(kind === 'screenshot' ? comment.screenshot : comment.recording)) return;
        focusAfter.current = undefined;
        if (triggerRef.current?.isConnected) return;
        const root = panel?.getRootNode();
        const focused = root instanceof ShadowRoot || root instanceof Document ? root.activeElement : null;
        if (!focused || focused === document.body)
            panel?.parentElement?.querySelector<HTMLElement>(`[data-uier-evidence="${kind}"] button`)?.focus();
    });

    const saveImage = async (first: 'capturing' | 'reading', read: () => Promise<string>, saved: string) => {
        if (working.current || replacement.isPending) return;
        working.current = true;
        setStage(first);
        setFailure('');
        try {
            const dataUrl = await read();
            setStage('saving');
            await replacement.mutateAsync(dataUrl);
            focusAfter.current = 'screenshot';
            announce(saved);
        } catch (error) {
            setFailure(error instanceof CaptureFailed ? t.screenshot.notTaken
                : t.screenshot.notAttached(error instanceof SuppliedImageError ? t.imageProblems[error.problem] : error instanceof Error ? error.message : t.screenshot.notSaved));
        } finally {
            working.current = false;
            setStage(undefined);
        }
    };
    const supplyImage = (read: () => Promise<Blob>) => saveImage('reading', async () => suppliedScreenshot(await read()), t.screenshot.imageAttached);
    const takeScreenshot = () => saveImage('capturing', async () => {
        // The toolbar's own capture, as for a new comment: its region around the anchor, without the toolbar
        const dataUrl = await captureCommentScreenshot(comment.position, rootElement, comment.drawing);
        if (!dataUrl) throw new CaptureFailed();
        return dataUrl;
    }, t.screenshot.attached);

    const saveRecording = async () => {
        const clip = recording.current();
        if (!clip || attachRecording.isPending) return;
        setFailure('');
        try {
            await attachRecording.mutateAsync(clip);
            focusAfter.current = 'recording';
            recording.clear(clip);
            announce(t.recording.attached);
        } catch {
            // The clip stays, and its finished upload is reused by the next try
            setFailure(t.recording.notAttached);
        }
    };

    // A press closes the menu first; the picker (or the browser's capture prompt) opens from the same press
    const choose = (action: () => void) => () => {
        setOpen(false);
        setFailure('');
        // What an earlier capture or file said is answered by choosing again
        if (recording.error && !recording.clip && !recording.busy) recording.discard();
        action();
    };
    const itemClassName = 'justify-start gap-2 font-normal';
    const items = [
        offerImage && onSourcePage && (
            <Button key="capture" variant="plain" size="sm" fullWidth type="button" className={itemClassName}
                aria-describedby={captureId} disabled={imageDisabled}
                startDecorator={<CameraIcon />}
                onClick={choose(() => void takeScreenshot())}>
                {t.screenshot.take}
            </Button>
        ),
        offerImage && (
            <Button key="image" variant="plain" size="sm" fullWidth type="button" className={itemClassName}
                aria-describedby={imageLimitsId} disabled={imageDisabled}
                startDecorator={<Paperclip size={16} aria-hidden="true" />}
                onClick={choose(() => imageInput.current?.click())}>
                {t.attachments.attachImage}
            </Button>
        ),
        offerImage && (
            <Button key="paste" variant="plain" size="sm" fullWidth type="button" className={itemClassName}
                aria-describedby={imageLimitsId} disabled={imageDisabled}
                startDecorator={<PasteIcon />}
                onClick={choose(() => void supplyImage(() => readClipboardImage(t)))}>
                {t.screenshot.paste}
            </Button>
        ),
        offerCapture && (
            <Button key="record" variant="plain" size="sm" fullWidth type="button" className={itemClassName}
                aria-describedby={recordingLimitsId} disabled={recordingDisabled}
                startDecorator={<RecordingIcon />}
                onClick={choose(() => void recording.start())}>
                {t.recording.record}
            </Button>
        ),
        offerRecording && (
            <Button key="upload" variant="plain" size="sm" fullWidth type="button" className={itemClassName}
                aria-describedby={recordingLimitsId} disabled={recordingDisabled}
                startDecorator={<Upload size={16} aria-hidden="true" />}
                onClick={choose(() => recordingInput.current?.click())}>
                {t.recording.upload}
            </Button>
        )
    ].filter(Boolean);

    const status = stage === 'capturing' ? t.attachments.capturing : stage === 'reading' ? t.attachments.reading
        : savingImage ? t.screenshot.saving : attachRecording.isPending ? t.recording.attaching : '';
    const showRecording = !hasRecording && (recording.clip || recording.busy || recording.error);

    return <>
        {offerImage && <>
            <span id={captureId} className="sr-only">{comment.position.type === 'page' ? t.attachments.pageScreenshot : t.attachments.regionScreenshot}</span>
            <span id={imageLimitsId} className="sr-only">{t.attachments.imageLimits}</span>
        </>}
        {!hasRecording && <span id={recordingLimitsId} className="sr-only">{t.recording.limits} {t.recording.navigation}</span>}
        {/* An image pasted with the keyboard while Attach or its menu has the focus (events come up the React tree) */}
        {items.length > 0 && <span className="contents" onPaste={event => {
            if (!offerImage || imageDisabled) return;
            const file = [...event.clipboardData.files][0];
            if (file) { event.preventDefault(); setOpen(false); void supplyImage(async () => file); }
        }}>{tip.tooltip}<Popper
            container={container}
            open={open}
            onOpenChange={setOpen}
            align="end"
            aria-label={t.attachments.attachToComment}
            // Like a menu: ↑ and ↓ move between its buttons
            onKeyDown={moveFocusInMenu}
            className={cx('z-[70] w-auto min-w-40 max-w-64 rounded-xl p-1', floatingShadowClassName)}
            // Back to Attach, unless the focus moved on meanwhile: Stop of a capture that started from the menu
            {...{ onCloseAutoFocus: keepMovedFocus }}
            trigger={(
                <IconButton ref={triggerRef} variant="plain" size="xs" type="button" className="size-6 text-muted-foreground hover:text-foreground"
                    {...tip.triggerProps}
                    aria-label={t.attachments.attachToComment}
                    data-uier-attach-evidence=""
                    data-uier-thread-control=""
                    disabled={disabled}>
                    <Paperclip size={14} aria-hidden="true" />
                </IconButton>
            )}>
            <Stack>{items}</Stack>
        </Popper></span>}
        {offerImage && <input ref={imageInput} type="file" accept={screenshotContentTypes.join(',')} aria-label={t.screenshot.uploadInput}
            className="hidden" disabled={imageDisabled}
            onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void supplyImage(async () => file);
            }} />}
        {!hasRecording && <input ref={recordingInput} type="file" accept={recordingContentTypes.join(',')} aria-hidden="true"
            className="hidden" disabled={recordingDisabled}
            onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) { setFailure(''); void recording.attach(file); }
            }} />}
        {panel && createPortal(<>
            {showRecording && <ComposerRecordingPreview recording={recording} disabled={attachRecording.isPending} saved={{
                action: <Button type="button" variant="solid" size="xs" className="rounded-md pointer-coarse:min-h-11"
                    disabled={disabled || attachRecording.isPending} onClick={() => void saveRecording()}>
                    {t.recording.attach}
                </Button>
            }} />}
            {status && <p role="status" className="m-0 text-xs text-muted-foreground">{status}</p>}
            {failure && <p role="alert" className={`m-0 text-xs ${destructiveTextClassName}`}>{failure}</p>}
        </>, panel)}
    </>;
}
