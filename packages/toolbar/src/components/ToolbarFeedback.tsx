'use client';

import { useContext, useEffect, useEffectEvent, useRef, useState } from 'react';
import { useIconTooltip } from './IconTooltip';
import { Popper } from '@signalco/ui-primitives/Popper';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Row } from '@signalco/ui-primitives/Row';
import { Typography } from '@signalco/ui-primitives/Typography';
import { cx } from '@signalco/ui-primitives/cx';
import { Megaphone } from '@signalco/ui-icons';
import { useComments } from '../hooks/useComments';
import { feedbackDraftKey, useDrafts } from '../hooks/useDrafts';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { useInkContainer } from './InkScope';
import { CommentComposer } from './CommentComposer';
import { defaultFeedbackTypes, type FeedbackTypeId } from '../feedbackTypes';
import { useProjectViewer } from '../project/ProjectGate';
import { CommentKindIcon } from './CommentKindLabel';
import { ComposerAttachButton, ComposerAttachmentsHeader, useAttachedImage } from './ComposerAttachments';
import { ComposerModal, ExpandComposerButton } from './ComposerModal';
import { useAnnounce } from './Announcer';
import { getDeviceInfo } from './info/getDeviceInfo';
import { cancelCommentScreenshot, captureCommentScreenshot } from '../screenshot';
import { floatingShadowClassName } from './@types/Comments';
import { toolbarSurface } from '../toolbarReview';
import { messages, useMessages } from '../i18n';
import { feedbackTypeText } from '../i18n/format';

/**
 * The toolbar's feedback button: the project's enabled feedback types about the page,
 * not pinned to an element. Saved as a comment with a `page` position and its kind, so it shows
 * in the inbox like any other thread.
 */
export function ToolbarFeedback({ onOpen, openRequested = false, onOpenRequestHandled }: {
    onOpen?: () => void;
    /** The page asked to give feedback (a "Give feedback" button): the form opens once */
    openRequested?: boolean;
    onOpenRequestHandled?: () => void;
}) {
    const { rootElement } = useContext(CommentsBootstrapperContext);
    // Dark like the pill it opens from
    const container = useInkContainer() ?? rootElement;
    const { create } = useComments();
    const { feedbackTypes = defaultFeedbackTypes } = useProjectViewer();
    const t = useMessages();
    // The built-in types' names and hints in the toolbar's language, unless an admin renamed them
    const kinds = feedbackTypes.filter(type => type.enabled).map(type => ({ ...type, ...feedbackTypeText(type, t) }));
    const drafts = useDrafts();
    const announce = useAnnounce();
    const [open, setOpen] = useState(false);
    // Expanded to a modal for focused writing: the popover is closed meanwhile, the form goes on
    const [expanded, setExpandedState] = useState(false);
    // At once: the popover's own close (the focus moving into the modal) comes before the next render
    const expandedRef = useRef(false);
    const setExpanded = (next: boolean) => { expandedRef.current = next; setExpandedState(next); };
    const [screenshot, setScreenshot] = useState<Promise<string | undefined>>();
    // Per feedback: back to the automatic screenshot once it is sent
    const [omitScreenshot, setOmitScreenshot] = useState(false);
    // The reviewer's own image, sent instead of the screenshot; also per feedback
    const attachment = useAttachedImage(undefined, { pastedName: t.attachments.pastedImage });
    const device = useRef<ReturnType<typeof getDeviceInfo>>(undefined);
    const [selectedKind, setKind] = useState<FeedbackTypeId>(() => kinds.reduce<(typeof kinds)[number] | undefined>((latest, type) =>
        (drafts.details(`${feedbackDraftKey}:${type.id}`)?.updatedAt ?? 0) > (drafts.details(`${feedbackDraftKey}:${latest?.id}`)?.updatedAt ?? 0) ? type : latest, kinds[0])?.id ?? 'feedback');
    const selected = kinds.find(type => type.id === selectedKind) ?? kinds[0];
    const kind = selected?.id ?? 'feedback';

    const handleOpenChange = (next: boolean) => {
        setOpen(next);
        setExpanded(false);
        if (next) {
            device.current = getDeviceInfo();
            setScreenshot(captureCommentScreenshot({ type: 'page' }, rootElement));
            onOpen?.();
        } else {
            create.reset();
        }
    };

    // Omitted while it is taken: its work stops. Attached after all: a new one is taken.
    const handleOmittedChange = (omitted: boolean) => {
        setOmitScreenshot(omitted);
        if (omitted && cancelCommentScreenshot(screenshot)) {
            setScreenshot(undefined);
        } else if (!omitted && !screenshot) {
            setScreenshot(captureCommentScreenshot({ type: 'page' }, rootElement));
        }
    };

    const openOnRequest = useEffectEvent(() => {
        if (!selected) {
            announce(messages().feedback.typesOff);
        } else if (!open) {
            handleOpenChange(true);
        }
        onOpenRequestHandled?.();
    });
    useEffect(() => {
        if (openRequested) {
            openOnRequest();
        }
    }, [openRequested]);

    // Sent in the background: the form closes at once and is clean when opened again, while this
    // send keeps its image. A failure says so, keeps the text and brings the image and the choice to
    // omit the screenshot back, unless another image was attached meanwhile.
    const handleSubmit = async (text: string, mentions?: import('./@types/Comments').Mention[]) => {
        if (!selected) return;
        const sent = { image: attachment.image, omitScreenshot };
        const sending = create.mutateAsync({
            position: { type: 'page' },
            kind,
            feedbackType: kind.startsWith('custom_') ? { id: selected.id, label: selected.label, icon: selected.icon } : undefined,
            text,
            mentions,
            device: device.current,
            screenshot: attachment.screenshotFor(omitScreenshot, screenshot)
        });
        setOmitScreenshot(false);
        attachment.remove();
        handleOpenChange(false);
        try {
            await sending;
        } catch (error) {
            if (!attachment.attached()) {
                if (sent.image) attachment.restore(sent.image);
                if (sent.omitScreenshot) setOmitScreenshot(true);
            }
            throw error;
        }
        announce(kind === 'bug' ? t.feedback.bugSent : kind === 'feedback' ? t.feedback.feedbackSent : t.feedback.typeSent(selected.label));
    };

    const tip = useIconTooltip(t.feedback.send);
    if (!selected) return null;
    // A pasted image file is attached instead of the screenshot
    const form = (
        <div className="contents" onPaste={attachment.handlePaste}>
            <ComposerAttachmentsHeader
                page
                title={<Typography component="h2" level="body2" semiBold className="text-foreground">{t.feedback.send}</Typography>}
                screenshot={screenshot}
                omitted={omitScreenshot}
                onOmittedChange={handleOmittedChange}
                attachment={attachment}
                actions={<ExpandComposerButton expanded={expanded} onExpandedChange={setExpanded} />} />
            <div className="bg-card px-3 pt-2">
                {/* Enabled types wrap in pairs, with the same pressed state as the inbox switch */}
                <Row role="group" aria-label={t.feedback.type} className="flex-wrap rounded-md bg-muted p-0.5">
                    {kinds.map((k) => (
                        <Button
                            key={k.id}
                            size="sm"
                            variant="plain"
                            aria-pressed={kind === k.id}
                            className={cx(
                                'min-w-0 basis-1/3 flex-1 gap-1.5 rounded-sm',
                                kind === k.id ? 'bg-accent text-foreground' : 'text-muted-foreground'
                            )}
                            startDecorator={<CommentKindIcon kind={k.id} feedbackType={k} />}
                            onClick={() => setKind(k.id)}>
                            <span className="truncate" title={k.label}>{k.label}</span>
                        </Button>
                    ))}
                </Row>
            </div>
            <CommentComposer
                key={kind}
                label={selected.label}
                placeholder={selected.placeholder}
                submitLabel={kind === 'bug' ? t.feedback.sendBug : t.feedback.send}
                draftKey={`${feedbackDraftKey}:${kind}`}
                autoFocus
                tall={expanded}
                holdSubmit={attachment.reading}
                attachments={<ComposerAttachButton attachment={attachment} />}
                onImageDrop={file => void attachment.attach(file)}
                error={create.error}
                onSubmit={handleSubmit} />
        </div>
    );
    return (
        <>{tip.tooltip}{open && expanded && (
            <ComposerModal container={container} label={t.feedback.send} onCollapse={() => setExpanded(false)}>
                {form}
            </ComposerModal>
        )}<Popper
            container={container}
            open={open && !expanded}
            // Not while expanded: the popover makes way for the modal, which has the focus now
            onOpenChange={next => { if (next || !expandedRef.current) handleOpenChange(next); }}
            side="top"
            sideOffset={12}
            aria-label={t.feedback.send}
            {...toolbarSurface('uier-feedback', cx('flex max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-1rem)] flex-col overflow-y-auto rounded-xl p-0', floatingShadowClassName,
                // Expanding: gone at once, the modal is there
                expanded && 'data-[state=closed]:animate-none!'))}
            trigger={(
                <IconButton
                    variant="plain"
                    className="rounded-full"
                    {...tip.triggerProps}
                    aria-label={t.feedback.send}>
                    <Megaphone />
                </IconButton>
            )}>
            {form}
        </Popper></>
    );
}
