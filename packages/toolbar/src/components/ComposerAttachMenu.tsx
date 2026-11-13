'use client';

import { useContext, useId, useRef, useState } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Stack } from '@signalco/ui-primitives/Stack';
import { cx } from '@signalco/ui-primitives/cx';
import { Close, Paperclip, Upload } from '@signalco/ui-icons';
import { canRecordScreen, recordingContentTypes, type RecordingState } from '../recordings';
import { screenshotContentTypes } from '../screenshotPolicy';
import type { useAttachedImage } from '../useAttachedImage';
import { useMessages } from '../i18n';
import { moveFocusInMenu } from '../focusKeys';
import { keepMovedFocus } from '../toolbarReview';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { IconTooltip, TooltipContainerContext, useIconTooltip } from './IconTooltip';
import { useInkContainer } from './InkScope';
import { composerIconButtonClassName } from './ComposerAttachments';
import { RecordingIcon } from './RecordingIcon';
import { floatingShadowClassName } from './@types/Comments';

/**
 * Attach, in the bottom-left corner of a message's text box (`CommentComposer`): one button whose
 * menu offers what can be added now, so the corner holds one control instead of one per kind
 * (docs/recordings.md, docs/screenshots.md):
 * - Attach image: the reviewer's own image, sent instead of the screenshot (or with a reply). Once one
 *   is attached, its name with a remove button follows the button and the item leaves the menu.
 * - Record screen, where the browser can capture, and Upload recording: one recording, whose capture
 *   and preview show above the text (`ComposerRecordingPreview`); both leave the menu meanwhile.
 * With nothing left to add, the button goes. The file inputs stay outside the menu, so a pick still
 * reaches them after it closes.
 */
export function ComposerAttachMenu({ image, recording, disabled }: {
    /** The image a new comment, feedback or reply can carry; `reply` says it goes with the reply */
    image?: { attachment: ReturnType<typeof useAttachedImage>; reply?: boolean };
    recording?: RecordingState;
    disabled?: boolean;
}) {
    const t = useMessages();
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const modal = useContext(TooltipContainerContext);
    const ink = useInkContainer();
    // In an expanded modal, its dialog (the top layer covers the rest); else dark in the ink scope like the form
    const container = modal ?? ink ?? rootElement;
    const [open, setOpen] = useState(false);
    const imageInput = useRef<HTMLInputElement>(null);
    const recordingInput = useRef<HTMLInputElement>(null);
    const imageLimitsId = useId();
    const recordingLimitsId = useId();
    const attachment = image?.attachment;
    const attached = attachment?.image;
    const offerImage = Boolean(attachment && !attached);
    const offerRecording = Boolean(recording && !recording.clip && recording.phase !== 'recording');
    const offerCapture = offerRecording && canRecordScreen();
    const recordingDisabled = disabled || Boolean(recording?.busy);
    const imageDisabled = Boolean(attachment?.reading);
    const tip = useIconTooltip(t.attachments.attach);
    // A press closes the menu first; the picker (or the browser's capture prompt) opens from the same press
    const choose = (action: () => void) => () => { setOpen(false); action(); };
    const items = [
        offerImage && (
            <Button key="image" variant="plain" size="sm" fullWidth type="button" className="justify-start gap-2 font-normal"
                aria-describedby={imageLimitsId} disabled={imageDisabled}
                startDecorator={<Paperclip size={16} aria-hidden="true" />}
                onClick={choose(() => imageInput.current?.click())}>
                {t.attachments.attachImage}
            </Button>
        ),
        offerCapture && (
            <Button key="record" variant="plain" size="sm" fullWidth type="button" className="justify-start gap-2 font-normal"
                aria-describedby={recordingLimitsId} disabled={recordingDisabled}
                startDecorator={<RecordingIcon />}
                onClick={choose(() => void recording?.start())}>
                {t.recording.record}
            </Button>
        ),
        offerRecording && (
            <Button key="upload" variant="plain" size="sm" fullWidth type="button" className="justify-start gap-2 font-normal"
                aria-describedby={recordingLimitsId} disabled={recordingDisabled}
                startDecorator={<Upload size={16} aria-hidden="true" />}
                onClick={choose(() => recordingInput.current?.click())}>
                {t.recording.upload}
            </Button>
        )
    ].filter(Boolean);

    return <>
        {attachment && <span id={imageLimitsId} className="sr-only">{image?.reply ? t.attachments.attachedToReply : t.attachments.sentInstead} {t.attachments.imageLimits}</span>}
        {recording && <span id={recordingLimitsId} className="sr-only">{t.recording.limits} {t.recording.navigation}</span>}
        {items.length > 0 && <>{tip.tooltip}<Popper
            container={container}
            open={open}
            onOpenChange={setOpen}
            side="top"
            align="start"
            aria-label={t.attachments.attach}
            // Like a menu: ↑ and ↓ move between its buttons
            onKeyDown={moveFocusInMenu}
            className={cx('z-[80] w-auto min-w-40 max-w-64 rounded-xl p-1', floatingShadowClassName)}
            // Back to Attach, unless the focus moved on meanwhile: Stop of a capture that started from the menu
            {...{ onCloseAutoFocus: keepMovedFocus }}
            trigger={(
                <IconButton variant={open ? 'soft' : 'plain'} size="xs" type="button" className={composerIconButtonClassName}
                    {...tip.triggerProps}
                    aria-label={t.attachments.attach}
                    data-uier-attach=""
                    disabled={!(offerImage && !imageDisabled) && !(offerRecording && !recordingDisabled)}>
                    <Paperclip size={16} aria-hidden="true" />
                </IconButton>
            )}
            >
            <Stack>{items}</Stack>
        </Popper></>}
        {attachment && attached && (
            <IconTooltip label={image?.reply ? t.attachments.replyImageRemove : t.attachments.imageRemove}>
                <Button
                    variant="plain"
                    size="xs"
                    type="button"
                    aria-label={t.attachments.removeImage(attached.name)}
                    className="min-w-0 max-w-40 gap-1 rounded-md font-normal text-muted-foreground hover:text-foreground pointer-coarse:min-h-11"
                    startDecorator={<Paperclip size={14} aria-hidden="true" />}
                    endDecorator={<Close size={14} aria-hidden="true" />}
                    onClick={attachment.remove}>
                    <span className="truncate">{attached.name}</span>
                </Button>
            </IconTooltip>
        )}
        {attachment && <input
            ref={imageInput}
            type="file"
            accept={screenshotContentTypes.join(',')}
            tabIndex={-1}
            aria-hidden="true"
            className="hidden"
            onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void attachment.attach(file);
            }} />}
        {recording && <input ref={recordingInput} type="file" accept={recordingContentTypes.join(',')} className="hidden" tabIndex={-1} aria-hidden="true"
            onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void recording.attach(file); }} />}
    </>;
}
