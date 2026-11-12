'use client';

import { useContext, useEffect, useImperativeHandle, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type Ref } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { Divider } from '@signalco/ui-primitives/Divider';
import { cx } from '@signalco/ui-primitives/cx';
import { Pin } from '@uier/brand';
import { useMessages, useToolbarLanguage } from '../i18n';
import { newLocalId, useComments } from '../hooks/useComments';
import { getCommentPlacement, lowestRect, resolveAnchorElement, useCommentPlacement } from '../hooks/useCommentItemRects';
import { cancelCommentScreenshot, captureCommentScreenshot } from '../screenshot';
import { newCommentDraftKey, newDrawingDraftKey, newRewriteDraftKey, useDrafts } from '../hooks/useDrafts';
import { CommentThread } from './CommentThread';
import { CommentComposer, type CommentComposerHandle } from './CommentComposer';
import { CommentSelectionHighlight } from './CommentSelectionHighlight';
import { CommentAreaHighlight } from './CommentAreaHighlight';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { useAnnounce } from './Announcer';
import { getDeviceInfo } from './info/getDeviceInfo';
import { holdsLayersAttribute, isToolbarAnchor, pressableToolbarOpener, toolbarPinId, toolbarSurface } from '../toolbarReview';
import { isPointing } from './CommentPointOverlay';
import { PinStatus } from './PinStatus';
import { statusLabel } from './CommentThreadHeader';
import { selectedWorkflowStatus, useWorkflowStatuses } from '../hooks/useWorkflowStatus';
import { feedbackStage } from '../verification';
import { PinParticipants, participantsTuck, participantsWidth, threadParticipants } from './PinParticipants';
import { RewriteSuggestions, useRewriteSuggestionsState } from './RewriteSuggestions';
import { ComposerAttachButton, ComposerAttachmentsHeader, composerIconButtonClassName, useAttachedImage, type AttachedImage } from './ComposerAttachments';
import { ComposerModal, ExpandComposerButton } from './ComposerModal';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { IconTooltip } from './IconTooltip';
import { DrawingLayer } from './canvas/DrawingLayer';
import { DrawIcon } from './canvas/CanvasIcons';
import { commentDrawing, type CommentDrawing } from '../drawing';
import { useProjectViewer } from '../project/ProjectGate';
import { getGuestName } from '../project/projectSession';
import { CommentDraft, CommentItem, CommentItemPosition, commentTextMaxLength, floatingShadowClassName, isCommentArea, type Mention } from './@types/Comments';

// Bubble (the pin) half size, how far its message count badge reaches past the right edge (Pin,
// @uier/brand) and its minimal distance from the window edges
const bubbleHalfSize = 16;
const bubbleBadgeOverhang = 5;
const bubbleWindowMargin = 4;

/**
 * Space the thread popover keeps from the window edges. The bottom leaves room for the toolbar
 * pill (bottom-4, 48px tall), so the reply box is never underneath it.
 */
const popoverCollisionPadding = { top: 8, left: 8, right: 8, bottom: 80 };

/**
 * A mouse resting on a pin previews its thread after this long (uier #308), and the preview closes
 * this long after the pointer left the pin and the preview (time to move between them)
 */
const previewDelay = 400;
const previewCloseDelay = 150;

/** Half the pin's hit area: 44px on touch (`pointer-coarse:p-1.5`), the pin itself otherwise */
function bubbleHalfHitArea() {
    return window.matchMedia('(pointer: coarse)').matches ? 22 : bubbleHalfSize;
}

/** Keeps the bubble inside the window horizontally, e.g. for text that ends at the right edge on mobile */
function bubbleLeft(rect: DOMRect | undefined) {
    const left = (rect?.right ?? 0) + 16;
    const halfHitArea = bubbleHalfHitArea();
    const min = halfHitArea + bubbleWindowMargin;
    const max = document.documentElement.clientWidth - Math.max(halfHitArea, bubbleHalfSize + bubbleBadgeOverhang) - bubbleWindowMargin;
    return max > min ? Math.min(Math.max(left, min), max) : left;
}

/** The toolbar pill's box (`CommentToolbar`), in the shadow root that holds `rootElement` */
function toolbarPillRect(rootElement: HTMLElement | null | undefined) {
    const root = rootElement?.getRootNode();
    return root instanceof ShadowRoot ? root.getElementById('uier-feedback-toolbar')?.getBoundingClientRect() : undefined;
}

/**
 * The bubble's middle, 16px below its anchor. When that leaves the bottom of the window, or goes
 * under the toolbar pill, while the anchor's bottom is in the window (an element or area that ends
 * at the bottom edge, uier #166), the bubble is above that point, upside down (its sharp corner
 * still on the point), and kept inside the window and above the pill. An anchor below the window
 * keeps its bubble below it, off-screen until scrolled to.
 */
function bubbleTop(rect: DOMRect | undefined, offset: number, left: number, rootElement: HTMLElement | null | undefined): { top: number; upsideDown: boolean } {
    const bottom = rect?.bottom ?? 0;
    const below = bottom + 16 + offset;
    const height = document.documentElement.clientHeight;
    const halfHitArea = bubbleHalfHitArea();
    let max = height - halfHitArea - bubbleWindowMargin;
    // The pill at the bottom edge (where it starts; it can be moved), in the bubble's columns
    const pill = toolbarPillRect(rootElement);
    if (pill && pill.width && pill.bottom > height - popoverCollisionPadding.bottom && pill.left < left + halfHitArea && pill.right > left - halfHitArea) {
        max = Math.min(max, pill.top - halfHitArea - bubbleWindowMargin);
    }
    // A pixel of slack for an anchor that ends at the bottom edge with a fractional size
    if (below <= max || bottom > height + 1) {
        return { top: below, upsideDown: false };
    }
    return { top: Math.min(bottom - 16 - offset, max), upsideDown: true };
}

type PopoverPlacement = { side: 'top' | 'right' | 'bottom' | 'left'; align: 'start' | 'end'; sideOffset: number; alignOffset: number };

/**
 * Where the thread popover opens: beside its bubble, on the side with room for it (right, else
 * left), going down from the bubble's top, or up from its bottom when the bubble is upside down; it
 * shifts up or down to stay inside the window, and never covers the bubble. A window too narrow for
 * either (mobile) has it below the bubble (or above, when there is more room there), or above an
 * upside-down one and the toolbar pill, shifted sideways to stay inside. Offsets are from the bubble
 * itself, not its hit area.
 */
function popoverPlacement(left: number, top: number, upsideDown: boolean): PopoverPlacement {
    const inset = bubbleHalfHitArea() - bubbleHalfSize;
    // The popover's width (`w-72`, Popper), in the page's rem
    const width = 18 * (Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
    const align = upsideDown ? 'end' : 'start';
    if (document.documentElement.clientWidth - popoverCollisionPadding.right - (left + bubbleHalfSize) >= width) {
        return { side: 'right', align, sideOffset: -inset, alignOffset: inset };
    }
    if (left - bubbleHalfSize - popoverCollisionPadding.left >= width) {
        return { side: 'left', align, sideOffset: -inset, alignOffset: inset };
    }
    if (!upsideDown) return { side: 'bottom', align: 'start', sideOffset: 4 - inset, alignOffset: inset };
    // Above the bubble, and clear of the toolbar pill when the bubble is in its row
    const lift = Math.max(0, top - bubbleHalfSize - 4 - (document.documentElement.clientHeight - popoverCollisionPadding.bottom));
    return { side: 'top', align: 'start', sideOffset: 4 - inset + lift, alignOffset: inset };
}

function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Scrolls a comment's place into the middle of the window: its element, or an area itself (its
 * element can be much larger). An area taller than half the window brings its pin, at the bottom.
 */
function scrollAnchorIntoView(position: CommentItemPosition, rect: DOMRect | undefined, behavior: ScrollBehavior, closed = false) {
    // An area, and the opener of the closed menu that holds the anchor, by the placed rectangle
    if ((isCommentArea(position) || closed) && rect) {
        const target = rect.height <= window.innerHeight / 2 ? rect.top + rect.height / 2 : rect.bottom;
        window.scrollBy({ top: target - window.innerHeight / 2, behavior });
        return;
    }
    resolveAnchorElement(position)?.scrollIntoView({ block: 'center', behavior });
}

/**
 * Brings a draft's anchor into the window when it is outside it, as Resume draft does, so its screenshot is of its
 * anchor and not of whatever the window shows: the capture measures its region in the window. Resolves once the
 * scroll has settled (the next frame; soon, when the tab is hidden). An anchor that is not on the page is not
 * scrolled to: its capture is of the window, as the form's would be.
 */
function revealAnchor(position: CommentItemPosition): Promise<void> {
    const { rects, state } = getCommentPlacement(position);
    if (!rects.length || rects.every(rect => rect.top >= 0 && rect.bottom <= window.innerHeight)) return Promise.resolve();
    scrollAnchorIntoView(position, lowestRect(rects), 'auto', state === 'closed');
    return new Promise(resolve => {
        requestAnimationFrame(() => resolve());
        window.setTimeout(resolve, 100);
    });
}

/** A draft pin's actions from outside its popover: the inbox's drafts (CommentsGlobal) */
export type CommentDraftHandle = {
    /**
     * Sends the draft as it is, without opening its form: its text, mentions, attached image or a new capture of its
     * anchor. `false` when it needs its form (a guest's name, an image still being read, nothing to send).
     */
    send: () => boolean;
};

type CommentBubbleProps = {
    /** A draft's actions from outside it (the inbox) */
    ref?: Ref<CommentDraftHandle>;
    /** Opens the thread once the pin is on the page (a comment that was just posted, or a comment link) */
    autoOpen?: boolean;
    /** Opened with J or K, going from thread to thread: the messages take the focus, not the reply box */
    autoOpenReading?: boolean;
    initiallyClosed?: boolean;
    /** Keep a recovered draft reachable beside saved pins on the same element. */
    draftPinOffset?: number;
    onAutoOpened?: () => void;
    /** It pressed the opener of a closed layer its pin is in: its thread opens once that layer has rendered */
    onAutoOpenStep?: () => void;
    /** With the comment's id, or a draft's key (see hooks/useDrafts.tsx) */
    onOpenStateChange?: (commentId: string, open: boolean) => void;
    /**
     * The comment was sent: its temporary id, its pin shown at once (see hooks/useComments.tsx). `quiet`: sent from
     * the inbox (`CommentDraftHandle.send`), so its thread does not open on the page.
     */
    onCreated?: (localId: string, quiet: boolean) => void;
    /**
     * A comment just sent from a draft: its thread is open from the start, in place of the draft's
     * popover, without the opening animation (one popover that goes on, not one closing and another opening)
     */
    continuesDraft?: boolean;
    /**
     * Sending failed: the draft (its text is back, the choice to omit its screenshot, its attached image and its drawing)
     * should be on the page again; `quiet` (sent from the inbox) with its form closed
     */
    onSendFailed?: (error: unknown, choice: { omitScreenshot: boolean; image?: AttachedImage; drawing?: CommentDrawing }, quiet: boolean) => void;
    onCanceled?: () => void;
    /** A drawing's draft: back to canvas mode with its shapes (Edit drawing) */
    onEditDrawing?: () => void;
    className?: string;
} & (
    /** A saved comment */
    | { commentItem: CommentItem; draft?: undefined }
    /** A new comment that is being written */
    | { commentItem?: undefined; draft: CommentDraft }
);

export function CommentBubble(props: CommentBubbleProps) {
    const { autoOpen, autoOpenReading = false, continuesDraft = false, onAutoOpened, onAutoOpenStep, onCreated, onSendFailed, onCanceled, onEditDrawing, onOpenStateChange, className } = props;
    const commentItem = props.commentItem;
    const creating = !commentItem;
    const position = props.commentItem ? props.commentItem.position : props.draft.position;
    // A rewrite suggestion: the suggested text for the selected text, instead of a comment
    const rewriting = props.draft?.kind === 'rewrite';
    const selectedText = props.draft?.position.type === 'text' ? props.draft.position.text : undefined;
    // A comment on a drawing (canvas mode): its shapes are shown on its area; the draft keeps them in memory
    const drawingDraft = props.draft?.kind === 'drawing';
    const savedDrawing = commentItem?.drawing;
    const drawing = useMemo(() => props.draft ? props.draft.drawing : commentDrawing(savedDrawing), [props.draft, savedDrawing]);
    const draftKey = commentItem ? commentItem.id : props.draft.draftKey ?? (rewriting ? newRewriteDraftKey : drawingDraft ? newDrawingDraftKey : newCommentDraftKey);
    const t = useMessages();
    const language = useToolbarLanguage();
    const newLabel = rewriting ? t.pin.newRewrite : t.pin.newComment;
    // Picking a suggestion replaces the text in the text box (as if typed, so it can be undone)
    const composerRef = useRef<CommentComposerHandle>(null);
    // The instruction and suggestions belong to the form, so they go on in the modal and back
    const rewrite = useRewriteSuggestionsState();

    const { rootElement } = useContext(CommentsBootstrapperContext);
    const drafts = useDrafts();
    const announce = useAnnounce();
    const triggerRef = useRef<HTMLButtonElement>(null);
    // Missing, ambiguous and hidden anchors have no pin; their threads stay in the inbox. An anchor in
    // a closed menu, popover or dialog has its pin on the element that opens it.
    const { rects: placementRects, state: placementState, opener: closedOpener } = useCommentPlacement(position);
    const closedLayer = placementState === 'closed';
    const lastRect = lowestRect(placementRects);
    const { create, reply } = useComments();
    const [capture, setCapture] = useState<{ device: ReturnType<typeof getDeviceInfo>; screenshot: Promise<string | undefined> | undefined }>();
    // A draft pin that starts closed (restored, or one of several on the page) is captured when its form opens or it
    // is sent, not for being on the page
    const startsClosed = Boolean(props.initiallyClosed) && !props.draft?.screenshot;
    useEffect(() => {
        if (creating && !startsClosed) setCapture({
            device: props.draft.device ?? getDeviceInfo(),
            screenshot: props.draft.screenshot ?? captureCommentScreenshot(position, rootElement, props.draft.drawing)
        });
    }, [creating, startsClosed, position, rootElement, props.draft]);
    const [omitScreenshot, setOmitScreenshot] = useState(props.draft?.omitScreenshot ?? false);
    // The reviewer's own image, sent instead of the automatic screenshot
    const attachment = useAttachedImage(props.draft?.image, { pastedName: t.attachments.pastedImage });
    // Omitted while it is taken: its work stops. Attached after all: a new one is taken.
    const handleOmittedChange = (omitted: boolean) => {
        setOmitScreenshot(omitted);
        if (omitted && cancelCommentScreenshot(capture?.screenshot)) {
            setCapture(current => current && { ...current, screenshot: undefined });
        } else if (!omitted && capture && !capture.screenshot) {
            setCapture({ ...capture, screenshot: captureCommentScreenshot(position, rootElement, drawing) });
        }
    };
    const mutation = creating ? create : reply;
    // A deleted first item ("Comment deleted") is not a message, nor is one still on its way
    const messagesCount = commentItem?.thread.items.filter(item => !item.deleted && !item.pending).length ?? 0;
    const sending = Boolean(commentItem?.pending);
    // The thread's status on its pin and in its name (uier #364): optimistic changes and realtime update the item
    const workflowStatuses = useWorkflowStatuses();
    const pinStage = commentItem && !creating && !sending ? feedbackStage(commentItem) : undefined;
    const pinStatus = commentItem && pinStage && pinStage !== 'open' ? selectedWorkflowStatus(commentItem, pinStage, workflowStatuses.data) : undefined;
    const statusName = pinStage && pinStage !== 'open' ? (pinStatus ? statusLabel(pinStatus, t) : t.status[pinStage]) : undefined;

    const handleSubmit = async (text: string, mentions?: Mention[]) => {
        if (props.commentItem) {
            const sentImage = attachment.image;
            attachment.remove();
            try {
                await reply.mutateAsync({ commentId: props.commentItem.id, text, mentions, screenshot: sentImage?.dataUrl, imageKey: sentImage?.key });
            } catch (error) {
                if (sentImage) attachment.restore(sentImage);
                throw error;
            }
            announce(t.thread.replyPosted);
            return;
        }

        await createComment(text, mentions, capture, false);
    };

    // `quiet`: sent from the inbox, its form closed (`send`)
    const createComment = async (text: string, mentions: Mention[] | undefined, sent: typeof capture, quiet: boolean) => {
        const draft = props.draft!;
        const quotedText = draft.position.type === 'text'
            ? draft.position.text.trim().slice(0, commentTextMaxLength)
            : undefined;
        const localId = newLocalId();
        const posting = create.mutateAsync({
            localId,
            draftKey,
            position: draft.position,
            kind: rewriting ? 'rewrite' : undefined,
            text,
            mentions,
            quotedText: quotedText || undefined,
            // The original viewport, alongside the automatic capture, even after resizing.
            device: sent?.device ?? getDeviceInfo(),
            screenshot: attachment.screenshotFor(omitScreenshot, sent?.screenshot),
            ...(draft.drawing ? { drawing: draft.drawing } : {})
        });
        // The draft pin makes way for the comment's, shown at once with its thread open (unless sent from the inbox)
        onCreated?.(localId, quiet);
        try {
            await posting;
        } catch (error) {
            // After the composer (or `send`) has put the text back
            window.setTimeout(() => onSendFailed?.(error, { omitScreenshot, image: attachment.image, drawing: draft.drawing }, quiet), 0);
            throw error;
        }
        announce(rewriting ? t.pin.suggestionPosted : t.pin.commentPosted);
    };

    // Sent from the inbox, as the composer sends it: the form's text moves into the send (`startSend`) and comes back
    // if it fails. A guest without a name, or an image still being read, needs the form.
    const { needsName } = useProjectViewer();
    useImperativeHandle(props.ref, () => ({
        send: () => {
            const text = drafts.get(draftKey) ?? '';
            const trimmed = text.trim();
            if (!creating || !trimmed || attachment.reading || (needsName && !getGuestName())) return false;
            const mentions = drafts.details(draftKey)?.mentions ?? [];
            const leading = text.length - text.trimStart().length;
            const selected = mentions.filter(mention => mention.end <= text.trimEnd().length)
                .map(mention => ({ userId: mention.userId, start: mention.start - leading, end: mention.end - leading }));
            // A new capture of its anchor, as opening its form takes, with the anchor in the window first
            const screenshot = omitScreenshot || attachment.image
                ? undefined
                : revealAnchor(position).then(() => captureCommentScreenshot(position, rootElement, drawing));
            const sent = { device: getDeviceInfo(), screenshot };
            const id = drafts.startSend(draftKey, text, mentions);
            void createComment(trimmed, selected, sent, true)
                .then(() => drafts.settleSend(draftKey, id, true), () => drafts.settleSend(draftKey, id, false));
            return true;
        }
    }));

    const [open, setOpen] = useState(creating ? !props.initiallyClosed : continuesDraft);
    // Until it is closed: opening it again animates as usual
    const [continuing, setContinuing] = useState(continuesDraft);
    // A new comment expanded to a modal for focused writing: the popover is closed meanwhile, the form goes on
    const [expanded, setExpandedState] = useState(false);
    // At once: the popover's own close (the focus moving into the modal) comes before the next render
    const expandedRef = useRef(false);
    const setExpanded = (next: boolean) => { expandedRef.current = next; setExpandedState(next); };
    // Opened with J or K: the messages have the focus, so the keys go on to the next thread instead of typing
    const [reading, setReading] = useState(false);
    const messagesRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (open && reading) messagesRef.current?.focus();
    }, [open, reading]);
    // A saved comment's id, or a draft's key
    const openStateId = commentItem?.id ?? draftKey;
    useEffect(() => {
        if (!onOpenStateChange) return;
        onOpenStateChange(openStateId, open);
        return () => onOpenStateChange(openStateId, false);
    }, [openStateId, open, onOpenStateChange]);
    // A mouse resting on the pin opens a read-only preview of the thread, which closes when the
    // pointer leaves the pin and the preview; a click (on either) opens the thread itself (uier #308).
    // Touch and the keyboard open the thread at once, as before.
    const [previewing, setPreviewing] = useState(false);
    const preview = previewing && !open;
    // The last time the popover opened, it was a preview: closing it leaves the focus where it is
    const previewedRef = useRef(false);
    const previewTimer = useRef<number>(undefined);
    // Opened from its preview: the thread's controls, hidden in the preview, fade in (uier #320)
    const [revealControls, setRevealControls] = useState(false);
    useEffect(() => () => window.clearTimeout(previewTimer.current), []);
    useEffect(() => {
        if (!open) return;
        window.clearTimeout(previewTimer.current);
        previewedRef.current = false;
        setPreviewing(false);
    }, [open]);
    const canPreview = Boolean(commentItem) && !sending;
    const handlePreviewEnter = (event: PointerEvent) => {
        if (event.pointerType !== 'mouse' || !canPreview || open) return;
        window.clearTimeout(previewTimer.current);
        // Not while a button is held (a drag, a text selection)
        if (previewing || event.buttons) return;
        previewTimer.current = window.setTimeout(() => {
            // Not while choosing a place for a comment: the pins are part of the page then
            if (isPointing()) return;
            previewedRef.current = true;
            setPreviewing(true);
        }, previewDelay);
    };
    const handlePreviewLeave = (event: PointerEvent) => {
        if (event.pointerType !== 'mouse') return;
        window.clearTimeout(previewTimer.current);
        if (previewing) previewTimer.current = window.setTimeout(() => setPreviewing(false), previewCloseDelay);
    };
    // A click keeps it open, as the thread with its reply box and actions
    const handlePinClick = (event: MouseEvent) => {
        window.clearTimeout(previewTimer.current);
        if (!preview) return;
        // Instead of the popover's own toggle, which would close it
        event.preventDefault();
        setRevealControls(true);
        handleOpenChange(true);
    };

    const handleOpenChange = (open: boolean) => {
        setContinuing(false);
        setExpanded(false);
        if (open && creating) setCapture({ device: getDeviceInfo(), screenshot: captureCommentScreenshot(position, rootElement, drawing) });
        if (!open) {
            setRevealControls(false);
            mutation.reset();
            rewrite.reset();
            setReading(false);
            // A new comment with text stays on the page as a draft pin; reopening it brings the text
            // back. A rewrite whose text is still the selected text has nothing to keep. A drawing is
            // something to keep by itself: Discard removes it.
            const text = drafts.get(draftKey)?.trim();
            if (creating && !drawingDraft && (!text?.length || (rewriting && text === selectedText?.trim()))) {
                drafts.delete(draftKey);
                onCanceled?.();
            }
        }
        setOpen(open);
    };

    const handleDiscard = () => {
        mutation.reset();
        rewrite.reset();
        drafts.delete(draftKey);
        onCanceled?.();
    };

    // On uier's own pages: a comment on a part of the toolbar, whose pin, thread and composer keep
    // that part's popover open, above the toolbar's popovers and menus (toolbarReview.ts)
    const onToolbar = isToolbarAnchor(position);
    const holdsLayers = onToolbar ? { [holdsLayersAttribute]: '' } : {};

    // The thread opens (and takes the focus, its reply box) once the pin is on the page; a pin
    // outside the window (a comment link) is scrolled into view first. A comment in a closed
    // popover or panel of the toolbar opens it first, with the button that opens it, and nested
    // ones layer by layer from the outside in: each press waits for its layer to render, where the
    // pin moves on to the next closed opener (useCommentItemRects.tsx).
    const hasRect = Boolean(lastRect);
    const pressedOpenersRef = useRef<Element[]>([]);
    useEffect(() => {
        if (!autoOpen) {
            pressedOpenersRef.current = [];
            return;
        }
        const opener = closedLayer && onToolbar ? pressableToolbarOpener(closedOpener) : undefined;
        if (opener && hasRect && !pressedOpenersRef.current.includes(opener)) {
            pressedOpenersRef.current.push(opener);
            opener.click();
            onAutoOpenStep?.();
            return;
        }
        if (hasRect) {
            const rect = triggerRef.current?.getBoundingClientRect();
            if (rect && (rect.top < 0 || rect.bottom > window.innerHeight)) {
                scrollAnchorIntoView(position, lastRect, 'auto', closedLayer);
            }
            setReading(autoOpenReading);
            // A draft resumed from the toolbar or the inbox: a new capture, as opening it by its pin takes
            if (creating && !open) setCapture({ device: getDeviceInfo(), screenshot: captureCommentScreenshot(position, rootElement, drawing) });
            setOpen(true);
            onAutoOpened?.();
        }
    }, [autoOpen, autoOpenReading, hasRect, closedLayer, closedOpener, onToolbar, onAutoOpened, onAutoOpenStep, position]);

    // Bubbles are fixed to their anchor; when one gets the focus off-screen, scroll it into view
    const handleFocus = () => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect || (rect.top >= 0 && rect.bottom <= window.innerHeight)) {
            return;
        }
        scrollAnchorIntoView(position, lastRect, prefersReducedMotion() ? 'auto' : 'smooth', closedLayer);
    };

    // The commented element is not on the page (anymore), e.g. a different layout on this device
    if (!lastRect && !creating) {
        return null;
    }

    const pinLeft = bubbleLeft(lastRect);
    const { top: pinTop, upsideDown } = bubbleTop(lastRect, creating ? props.draftPinOffset ?? 0 : 0, pinLeft, rootElement);
    const placement = popoverPlacement(pinLeft, pinTop, upsideDown);
    // Whose thread it is: the people in it beside the pin, on the side with room (uier #307)
    const participants = commentItem && !sending ? threadParticipants(commentItem, t.common.guest) : [];
    const participantsReach = bubbleHalfSize - participantsTuck + participantsWidth(participants);
    const participantsSide = pinLeft + participantsReach <= document.documentElement.clientWidth - bubbleWindowMargin ? 'right' : 'left';
    const participantsText = participants.length
        ? t.pin.participants(new Intl.ListFormat(language, { type: 'conjunction' }).format(participants.map(person => person.isMe ? t.pin.participantsYou : person.name)))
        : undefined;

    // Bounded by the space the window has left, so the reply box always stays visible
    const popoverClassName = cx(
        onToolbar ? 'z-[78]' : 'z-[60]',
        'flex max-h-[min(var(--radix-popover-content-available-height),36rem)] flex-col rounded-xl',
        // A rewrite (suggestions and text box) scrolls as a whole: when it is clipped, the
        // browser would scroll the page to show the caret, and the popover follows its pin
        rewriting ? 'overflow-y-auto overscroll-contain' : 'overflow-hidden',
        // In place of the draft's popover, already on the page
        continuing && 'data-[state=open]:animate-none!',
        // Expanding: gone at once, the modal is there
        expanded && 'data-[state=closed]:animate-none!',
        floatingShadowClassName
    );

    // A saved thread is a part of the toolbar that can be reviewed on uier's own pages; the comment
    // being written and a preview are not
    const surface = commentItem && !preview ? toolbarSurface('uier-thread', popoverClassName) : { className: popoverClassName, onCloseAutoFocus: undefined };
    const handleCloseAutoFocus = (event: Event) => {
        // A preview never had the focus: it stays where it is, not on the pin
        if (previewedRef.current) event.preventDefault();
        else surface.onCloseAutoFocus?.(event);
    };

    // A pasted (or dropped, `onImageDrop`) image file is attached to a new comment, instead of its screenshot
    const composer = (
        <div className="shrink-0" onPaste={attachment.handlePaste}>
            {creating && (
                <ComposerAttachmentsHeader
                    title={<span className="text-sm font-semibold text-foreground">{newLabel}</span>}
                    screenshot={capture?.screenshot}
                    omitted={omitScreenshot}
                    onOmittedChange={handleOmittedChange}
                    attachment={attachment}
                    actions={<>
                        {drawingDraft && onEditDrawing && placementState === 'exact' && (
                            <IconTooltip label={t.canvas.editDrawing}>
                                <IconButton
                                    variant="plain"
                                    size="xs"
                                    type="button"
                                    data-uier-edit-drawing=""
                                    aria-label={t.canvas.editDrawing}
                                    className={composerIconButtonClassName}
                                    onClick={onEditDrawing}>
                                    <DrawIcon size={16} />
                                </IconButton>
                            </IconTooltip>
                        )}
                        <ExpandComposerButton expanded={expanded} onExpandedChange={setExpanded} />
                    </>} />
            )}
            <CommentComposer
                commentId={commentItem?.id}
                ref={composerRef}
                label={rewriting ? t.pin.suggestedText : (creating ? t.pin.comment : t.pin.reply)}
                placeholder={rewriting ? t.pin.suggestionPlaceholder : (creating ? t.pin.commentPlaceholder : t.thread.replyPlaceholder)}
                submitLabel={rewriting ? t.pin.postSuggestion : (creating ? t.pin.postComment : t.thread.postReply)}
                draftKey={draftKey}
                quote={selectedText}
                // Not when it appears in a thread that is closing (its comment was saved after
                // Escape): the focus, and a page selection made meanwhile, stay where they are
                autoFocus={open && !reading}
                tall={expanded}
                error={mutation.error ?? props.draft?.sendError}
                holdSubmit={attachment.reading}
                // Replies wait until the comment is saved (they need its id); the reply box
                // is there already, so the thread keeps its size and the focus stays in it
                waiting={sending}
                attachments={<ComposerAttachButton attachment={attachment} reply={!creating} />}
                onImageDrop={file => void attachment.attach(file)}
                // A rewrite's form: the quoted text, the suggestions, then the suggested text in its box
                beforeText={rewriting && selectedText ? (
                    <RewriteSuggestions
                        text={selectedText}
                        state={rewrite}
                        onPick={(suggestion) => composerRef.current?.replaceText(suggestion)} />
                ) : undefined}
                onSubmit={handleSubmit}
                discardable={drawingDraft}
                onDiscard={creating ? handleDiscard : attachment.remove} />
            {!creating && attachment.error && <p role="alert" className="m-0 px-3 pb-2 text-xs text-destructive">{attachment.error}</p>}
        </div>
    );

    return (
        <>
            {creating && open && expanded && (
                <ComposerModal container={rootElement} label={newLabel} onCollapse={() => setExpanded(false)} {...holdsLayers}>
                    {composer}
                </ComposerModal>
            )}
            {position.type === 'text' && (
                <CommentSelectionHighlight
                    commentSelection={position}
                    commentId={commentItem?.id}
                    onClick={commentItem ? () => setOpen(true) : undefined} />
            )}
            {isCommentArea(position) && lastRect && !closedLayer && drawing && (
                <DrawingLayer
                    data-uier-drawing-comment={commentItem?.id ?? ''}
                    className={onToolbar ? 'z-[74]' : 'z-[47]'}
                    shapes={drawing.shapes}
                    left={lastRect.left}
                    top={lastRect.top} />
            )}
            {/* A drawing marks its area itself: the outline only while its thread is open (or previewed) */}
            {isCommentArea(position) && lastRect && !closedLayer && (!drawing || open || preview) && (
                <CommentAreaHighlight rect={lastRect} commentId={commentItem?.id} active={open || preview} />
            )}
            <Popper
                container={rootElement}
                trigger={(
                    <button
                        ref={triggerRef}
                        type="button"
                        // Names the pin when it opens the thread a comment on the toolbar is in
                        id={commentItem && !sending ? toolbarPinId(commentItem.id) : undefined}
                        data-uier-comment={commentItem?.id ?? newCommentDraftKey}
                        // Which of the page's drafts it is (`newDraftKey`)
                        data-uier-draft={creating ? draftKey : undefined}
                        {...holdsLayers}
                        // The same number as the thread header, the inbox and the app ("Comment #6, 3 messages")
                        aria-label={creating
                            ? newLabel
                            : sending
                                ? t.pin.commentSending
                                : t.pin.label(commentItem.number, messagesCount, statusName)}
                        aria-description={participantsText}
                        onFocus={handleFocus}
                        onPointerEnter={handlePreviewEnter}
                        onPointerLeave={handlePreviewLeave}
                        onClick={handlePinClick}
                        className={cx(
                            // The pin's shape, so the focus ring follows it: round but for the sharp corner
                            // (top-left, bottom-left when upside down)
                            'group fixed cursor-pointer rounded-full pointer-coarse:p-1.5',
                            upsideDown ? 'rounded-bl-none' : 'rounded-tl-none',
                            // A hovered or focused pin comes in front of the pins it overlaps
                            onToolbar ? 'z-[75] hover:z-[76] focus-visible:z-[76]' : 'z-[48] hover:z-[49] focus-visible:z-[49]',
                            sending && 'opacity-70',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                            className
                        )}
                        data-uier-upside-down={upsideDown ? '' : undefined}
                        style={{
                            left: pinLeft,
                            top: pinTop,
                            transform: 'translate(-50%, -50%)',
                            willChange: 'left, top'
                        }}>
                        {/* The thread's number, the one people quote; the message count is the badge */}
                        <span className="relative block group-hover:scale-110 group-hover:brightness-75">
                            <Pin
                                aria-hidden="true"
                                number={creating || sending ? undefined : commentItem.number}
                                messages={creating || sending ? undefined : messagesCount}
                                upsideDown={upsideDown}
                                style={{ display: 'block' }} />
                            {/* Its status at a glance, but Open (uier #364) */}
                            {pinStage && pinStage !== 'open' && <PinStatus stage={pinStage} />}
                        </span>
                        <PinParticipants people={participants} side={participantsSide} />
                    </button>
                )}
                aria-label={creating ? newLabel : sending ? t.pin.sendingComment : preview ? t.pin.threadPreview : t.pin.thread}
                {...holdsLayers}
                {...surface}
                // Passed through to the Radix popover content, like `collisionPadding`
                {...{ onCloseAutoFocus: handleCloseAutoFocus }}
                // A saved thread: R, S and A act on it (`threadShortcuts.ts`); not on a preview
                {...(commentItem && !preview && { 'data-uier-thread-scope': '' })}
                {...(preview && {
                    'data-uier-preview': '',
                    // The focus stays where it is (the page's, or another thread's reply box)
                    onOpenAutoFocus: (event: Event) => event.preventDefault(),
                    onPointerEnter: handlePreviewEnter,
                    onPointerLeave: handlePreviewLeave,
                    onClick: handlePinClick
                })}
                side={placement.side}
                sideOffset={placement.sideOffset}
                align={placement.align}
                alignOffset={placement.alignOffset}
                open={(open || preview) && !expanded}
                // Not while expanded: the popover makes way for the modal, which has the focus now.
                // A preview (Escape, a press outside) just closes.
                onOpenChange={next => {
                    if (!next && preview) setPreviewing(false);
                    else if (next || !expandedRef.current) handleOpenChange(next);
                }}
                // Passed through to the Radix popover content (the Popper's own value is derived from the offsets)
                {...{ collisionPadding: popoverCollisionPadding }}
            >
                {/* Read-only: its controls take no presses or focus, and a click anywhere opens the thread.
                    The wrapper is not inert, so the wheel over a long thread scrolls it (uier #322). */}
                {commentItem && preview && (
                    <div data-uier-preview-scroll="" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                        <div inert>
                            <CommentThread commentItem={commentItem} onPage allMessages />
                        </div>
                    </div>
                )}
                {commentItem && !preview && (
                    <>
                        {/* Focusable so the thread can be scrolled with the keyboard */}
                        <div
                            ref={messagesRef}
                            tabIndex={0}
                            aria-label={t.pin.messages}
                            role="group"
                            {...(revealControls && { 'data-uier-controls-reveal': '' })}
                            className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                            <CommentThread commentItem={commentItem} reading={open} onPage allMessages={revealControls} />
                        </div>
                        <Divider className="shrink-0" />
                    </>
                )}
                {!preview && composer}
            </Popper>
        </>
    );
}
