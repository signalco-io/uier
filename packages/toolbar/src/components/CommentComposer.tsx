'use client';

import { useEffect, useId, useImperativeHandle, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode, type Ref } from 'react';
import { IconTooltip } from './IconTooltip';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Row } from '@signalco/ui-primitives/Row';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Input } from '@signalco/ui-primitives/Input';
import { cx } from '@signalco/ui-primitives/cx';
import { Close, Send } from '@signalco/ui-icons';
import { useParticipants, type Participant } from '../hooks/useParticipants';
import { MarkdownEditor, type MarkdownEditorHandle, type MentionQuery } from '../editor/MarkdownEditor';
import type { EditorMention } from '../editor/markdownDoc';
import type { Mention } from './@types/Comments';
import { useDrafts } from '../hooks/useDrafts';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { useAnnounce } from './Announcer';
import { commentTextMaxLength, destructiveTextClassName, inputFocusRingClassName } from './@types/Comments';
import { useProjectViewer } from '../project/ProjectGate';
import { getGuestName, setGuestName } from '../project/projectSession';
import { ComposerFooter } from './ComposerFooter';
import { messages, useMessages } from '../i18n';
import { useKeyboardLikely } from '../shortcuts';
import type { RecordingState } from '../recordings';
import { ComposerRecordingControls, ComposerRecordingPreview } from './ComposerRecording';

/** Longest guest name the review API accepts */
const guestNameMaxLength = 80;
const noMentions: Mention[] = [];

// Show the character counter when the text gets close to the limit
const counterThreshold = commentTextMaxLength - 100;
// Remaining characters are announced once at each of these lengths, not on every key
const announceThresholds = [counterThreshold, commentTextMaxLength - 10, commentTextMaxLength];
// The text box starts at two lines and grows with the text up to about 8, then scrolls. Expanded (`tall`): it
// starts at 8 lines and grows to about 22, within the window
const textClassName = 'min-h-[54px] max-h-44';
const tallTextClassName = 'min-h-[174px] max-h-[min(480px,calc(100dvh-16rem))]';

// A guest's name typed but not sent yet, per form (its draft key): the same form expanded or
// collapsed again starts with it, and another form never gets it
const unsentGuestNames = new Map<string, string>();

function thresholdIndex(length: number) {
    return announceThresholds.filter(t => length >= t).length;
}

export type CommentComposerHandle = {
    /**
     * Replaces the text as if it was typed: the text box stays (with a guest's name and the undo
     * history, so Ctrl/Cmd+Z brings the earlier text back) and gets the focus
     */
    replaceText: (text: string) => void;
    /** Focuses the text box with the caret at the end */
    focus: () => void;
};

type CommentComposerProps = {
    initialText?: string;
    initialMentions?: Mention[];
    commentId?: string;
    /** Editing has a labeled Save button and a separate cancel action. */
    onCancel?: () => void;
    ref?: Ref<CommentComposerHandle>;
    /** Accessible name of the text box */
    label: string;
    placeholder: string;
    submitLabel: string;
    /** Unsent text is kept under this key (see hooks/useDrafts.tsx) */
    draftKey: string;
    /** Selected page text the new comment is about */
    quote?: string;
    autoFocus?: boolean;
    /** Editing only: the save is on its way */
    pending?: boolean;
    /** Part of what it sends is not ready (an attached image is still being read): Enter and the send button wait */
    holdSubmit?: boolean;
    /**
     * Not ready for text yet (a reply to a comment that is still being saved): the text box keeps
     * its place and can have the focus, but is read-only
     */
    waiting?: boolean;
    /** In the bottom-left corner of the text box, before its hint (Attach image for new comments and feedback) */
    attachments?: ReactNode;
    recording?: RecordingState;
    /**
     * Above the text box, after the quote (and a guest's name), in the same form and spacing: a rewrite's
     * suggestions. Its own controls must not submit the form (no nested form; Enter handled there).
     */
    beforeText?: ReactNode;
    /** Expanded to a modal for focused writing: a larger text box */
    tall?: boolean;
    error?: unknown;
    /**
     * Resolves when saved; rejects to retain the text. Capture belongs to the draft, not this form.
     * New text (no `onCancel`) is sent in the background: the form is empty again at once, and a
     * failure puts the text back (the toast says why).
     */
    onSubmit: (text: string, mentions?: Mention[]) => Promise<unknown>;
    /** An image file dropped on the text (the form's Attach image takes it) */
    onImageDrop?: (file: File) => void;
    /** Shows a "Discard" button while there is text (new comments) */
    onDiscard?: () => void;
    /** Discard shows without text too (a drawing's comment: the drawing is something to discard) */
    discardable?: boolean;
};

/**
 * Text box for a comment or reply: the rich message editor (`editor/MarkdownEditor`, saved as Markdown) in one
 * box styled like the kit's `Input` (bordered, radius 8, blue focus ring), with its hint or counter and buttons.
 * Enter sends, Shift+Enter adds a new line; Markdown typed and Ctrl/⌘+B, I, E format the text.
 */
export function CommentComposer({ ref, label, placeholder, submitLabel, draftKey, quote, autoFocus, pending, holdSubmit = false, waiting = false, attachments, recording, beforeText, tall = false, error, onSubmit, onImageDrop, onDiscard, discardable = false, initialText, initialMentions, commentId, onCancel }: CommentComposerProps) {
    holdSubmit = holdSubmit || Boolean(recording?.busy);
    const formRef = useRef<HTMLFormElement>(null);
    const editorRef = useRef<MarkdownEditorHandle>(null);
    const inputId = useId();
    const counterId = useId();
    const keysId = useId();
    const drafts = useDrafts();
    const announce = useAnnounce();
    const t = useMessages();
    const text = useSyncExternalStore(
        listener => drafts.subscribe(draftKey, listener),
        () => drafts.get(draftKey) ?? initialText ?? '');
    const [storageAvailable, setStorageAvailable] = useState(drafts.available);
    const keyboard = useKeyboardLikely();
    const trimmedText = text.trim();
    const mentions = useSyncExternalStore(
        listener => drafts.subscribe(draftKey, listener),
        () => drafts.details(draftKey)?.mentions ?? (text === initialText ? initialMentions ?? noMentions : noMentions));
    const [mentionQuery, setMentionQuery] = useState<MentionQuery>();
    const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
    const [activeSuggestion, setActiveSuggestion] = useState(0);
    const listId = useId();
    const query = suggestionsDismissed ? undefined : mentionQuery;
    const participants = useParticipants(commentId, Boolean(query));
    const suggestions = query ? participants.data?.filter(person => person.name.toLocaleLowerCase().includes(query.search)).slice(0, 8) ?? [] : [];
    const selectedIndex = Math.min(activeSuggestion, Math.max(0, suggestions.length - 1));
    const showSuggestions = Boolean(query && suggestions.length);

    // Guests of a project tag their comments with their name, asked once and kept on this site
    const { needsName, isMember } = useProjectViewer();
    const [savedName, setSavedName] = useState(() => needsName ? getGuestName() : undefined);
    const askName = needsName && !savedName;
    const [name, setName] = useState(() => unsentGuestNames.get(draftKey) ?? '');
    const [nameMissing, setNameMissing] = useState(false);
    const showCounter = text.length >= counterThreshold;
    const submittingRef = useRef(false);
    const [submitting, setSubmitting] = useState(false);
    const sharedPending = useSyncExternalStore(
        listener => drafts.subscribe(draftKey, listener),
        () => drafts.pending(draftKey));
    const recoveries = useSyncExternalStore(listener => drafts.subscribe(draftKey, listener), () => drafts.recoveries(draftKey));
    // Editing waits for the save; new comments, replies and feedback never block the form
    const instant = !onCancel;
    const busy = !instant && (pending || submitting || sharedPending);

    // The editor reports the Markdown with each mention's range (its mentions move with the text)
    const setText = (value: string, next: EditorMention[]) => {
        drafts.set(draftKey, value);
        drafts.setDetails(draftKey, { mentions: next });
        setStorageAvailable(drafts.available());
    };

    useImperativeHandle(ref, () => ({
        // Like typing it: one step in the editor's undo history, so Ctrl/Cmd+Z brings the earlier text back
        replaceText: (value: string) => editorRef.current?.replaceText(value),
        focus: () => editorRef.current?.focus('end')
    }));

    useEffect(() => {
        if (!autoFocus) {
            return;
        }

        // After the popover's own open focus handling, which moves the focus to the popover
        // itself when the previous focus was in the toolbar (the document only sees the shadow host).
        // A restored draft continues where it ended: the caret goes to the end.
        const timeout = window.setTimeout(() => editorRef.current?.focus('end'), 0);
        return () => window.clearTimeout(timeout);
    }, [autoFocus]);

    // Announce the remaining characters when the text crosses a threshold
    const lastThreshold = useRef(thresholdIndex(text.length));
    useEffect(() => {
        const current = thresholdIndex(text.length);
        if (current > lastThreshold.current) {
            const left = commentTextMaxLength - text.length;
            announce(left > 0 ? messages().composer.charactersLeft(left) : messages().composer.limitReached);
        }
        lastThreshold.current = current;
    }, [text.length, announce]);

    /**
     * Empties the form at once. The text stays with the draft until the send settles: a failure puts
     * it back (before anything written meanwhile), and so does leaving the page before it settled.
     */
    const sendInBackground = async (sentText: string, sentMentions: Mention[], send: () => Promise<unknown>) => {
        const id = drafts.startSend(draftKey, sentText, sentMentions);
        let saved = false;
        try {
            await send();
            saved = true;
        } catch {
            // The toast says why
        } finally {
            drafts.settleSend(draftKey, id, saved);
        }
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        // The draft's text, not this render's: a second Enter before the form re-rendered would send it again
        const text = drafts.get(draftKey) ?? initialText ?? '';
        const mentions = drafts.details(draftKey)?.mentions ?? (text === initialText ? initialMentions ?? noMentions : noMentions);
        const trimmedText = text.trim();
        if (!trimmedText.length || busy || holdSubmit || waiting || drafts.pending(draftKey) || submittingRef.current) {
            return;
        }
        if (askName) {
            if (!name.trim().length) {
                setNameMissing(true);
                return;
            }
            setGuestName(name);
            setSavedName(name.trim());
            unsentGuestNames.delete(draftKey);
        }

        const leading = text.length - text.trimStart().length;
        const selected = mentions.filter(mention => mention.end <= text.trimEnd().length).map(mention => ({ userId: mention.userId, start: mention.start - leading, end: mention.end - leading }));
        if (instant) {
            await sendInBackground(text, mentions, () => onSubmit(trimmedText, selected));
            return;
        }

        submittingRef.current = true;
        setSubmitting(true);
        try {
            await drafts.run(draftKey, () => onSubmit(trimmedText, selected));
            drafts.delete(draftKey);
        } catch {
            // Shown by `error`; keep the text so it can be sent again
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    };

    const selectMention = (person: Participant) => {
        // The mention and a space after it, in place of the `@` being typed, unless that is over the limit
        if (!query || !editorRef.current?.insertMention(person)) return;
        setSuggestionsDismissed(true);
        announce(t.composer.mentioned(person.name));
    };

    // Keys before the editor's own: true when handled (the editor then prevents the default)
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.isComposing) return false;
        if (showSuggestions) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                setActiveSuggestion((selectedIndex + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
                return true;
            }
            if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) { selectMention(suggestions[selectedIndex]!); return true; }
            if (e.key === 'Escape') { e.stopPropagation(); setSuggestionsDismissed(true); return true; }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            formRef.current?.requestSubmit();
            return true;
        }
        return false;
    };

    const handleDiscard = () => {
        drafts.delete(draftKey);
        onDiscard?.();
    };

    return (
        <form ref={formRef} onSubmit={handleSubmit} aria-busy={busy}>
            <Stack spacing={1} className="bg-card px-3 py-3">
                {Boolean(quote?.length) && (
                    <blockquote className="m-0 line-clamp-3 border-l-2 border-border pl-2.5 text-sm text-secondary-foreground">
                        {quote}
                    </blockquote>
                )}
                {askName && (
                    <>
                        <Input
                            label={t.composer.yourName}
                            name="authorName"
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value);
                                unsentGuestNames.set(draftKey, e.target.value);
                                setNameMissing(false);
                            }}
                            maxLength={guestNameMaxLength}
                            autoComplete="name"
                            placeholder={t.composer.namePlaceholder}
                            className={inputFocusRingClassName}
                            fullWidth />
                        {nameMissing && (
                            <p role="alert" className={cx('m-0 text-sm', destructiveTextClassName)}>{t.composer.enterName}</p>
                        )}
                    </>
                )}
                {beforeText}
                {/* One box: the text, then its hint or counter and the buttons; the box shows the focus */}
                <div className={cx('rounded-lg border border-input bg-background', inputFocusRingClassName)}>
                {recording && <ComposerRecordingPreview recording={recording} disabled={waiting || busy || sharedPending} />}
                <MarkdownEditor
                    ref={editorRef}
                    value={text}
                    mentions={mentions}
                    onChange={(value, next) => { setText(value, next); setSuggestionsDismissed(false); setActiveSuggestion(0); }}
                    onMentionQuery={setMentionQuery}
                    onKeyDown={handleKeyDown}
                    onImageDrop={onImageDrop}
                    maxLength={commentTextMaxLength}
                    readOnly={busy || waiting}
                    placeholder={placeholder}
                    enterKeyHint={onCancel ? 'done' : 'send'}
                    attributes={{
                        id: inputId,
                        'aria-label': label,
                        'aria-describedby': [showCounter || isMember ? counterId : '', keyboard ? keysId : ''].filter(Boolean).join(' ') || undefined,
                        'aria-autocomplete': showSuggestions ? 'list' : undefined,
                        'aria-controls': showSuggestions ? listId : undefined,
                        'aria-activedescendant': showSuggestions ? `${listId}-${selectedIndex}` : undefined
                    }}
                    textClassName={cx('overflow-y-auto rounded-t-lg px-3 pb-1 pt-2.5 text-sm text-foreground', tall ? tallTextClassName : textClassName)}
                    placeholderClassName="px-3 pt-2.5 text-sm text-muted-foreground" />
                <Row justifyContent="space-between" spacing={1} className={cx('py-1.5 pr-1.5', attachments ? 'pl-1.5' : 'pl-3')}>
                    <Row spacing={1} className="min-w-0">
                    {attachments}
                    {recording && <ComposerRecordingControls recording={recording} disabled={waiting || busy || sharedPending} />}
                    <span
                        id={counterId}
                        className={cx(
                            'min-w-0 truncate text-xs tabular-nums',
                            text.length >= commentTextMaxLength ? destructiveTextClassName : 'text-muted-foreground'
                        )}>
                        {showCounter ? (
                            <>
                                {text.length}/{commentTextMaxLength}
                                <span className="sr-only">{t.composer.characters}</span>
                            </>
                        ) : isMember && (
                            <>
                                <span aria-hidden="true" title={t.composer.mentionHelp}>{t.composer.mentionHint}</span>
                                <span className="sr-only">{t.composer.mentionHelp}</span>
                            </>
                        )}
                    </span>
                    </Row>
                    <Row spacing={0.5} className="shrink-0">
                        {onCancel && <Button variant="plain" size="xs" type="button" disabled={busy} onClick={onCancel}>{t.common.cancel}</Button>}
                        {!onCancel && (text.length > 0 || (discardable && onDiscard)) && (
                            <IconTooltip label={t.composer.discard}><IconButton
                                variant="plain"
                                size="xs"
                                type="button"
                                className="size-7 rounded-md pointer-coarse:size-11"
                                aria-label={t.composer.discard}
                                disabled={busy}
                                onClick={handleDiscard}>
                                <Close size={14} />
                            </IconButton></IconTooltip>
                        )}
                        {onCancel ? (
                            <Button type="submit" variant="plain" size="xs" className="pointer-coarse:min-h-11" disabled={!trimmedText.length || busy || holdSubmit}>{submitLabel}</Button>
                        ) : <IconTooltip label={submitLabel}><IconButton
                            variant="plain"
                            size="xs"
                            type="submit"
                            className="size-7 rounded-md pointer-coarse:size-11"
                            aria-label={submitLabel}
                            disabled={!trimmedText.length || busy || holdSubmit || waiting || sharedPending}>
                            <Send size={14} />
                        </IconButton></IconTooltip>}
                    </Row>
                </Row>
                </div>
                <ComposerFooter keysId={keysId} keyboard={keyboard} submitVerb={onCancel ? 'save' : 'send'} />
                {showSuggestions && <div id={listId} role="listbox" aria-label={t.composer.mentionPeople} className="max-h-48 overflow-y-auto rounded-xl border p-1">
                    {suggestions.map((person, index) => <Button key={person.id} id={`${listId}-${index}`} role="option" aria-selected={index === selectedIndex}
                        variant="plain" size="sm" className={cx('min-h-11 w-full justify-start', index === selectedIndex && 'bg-muted')}
                        onMouseDown={e => e.preventDefault()} onClick={() => selectMention(person)}>
                        {person.name}<span className="ml-2 font-mono text-xs text-secondary-foreground">{person.id.slice(-6)}</span>
                    </Button>)}
                </div>}
                {query && participants.error && <p role="status" className="m-0 text-xs text-muted-foreground">{t.composer.peopleNotLoaded}</p>}
                <CommentsErrorMessage error={error} />
                {!storageAvailable && text.length > 0 && <p role="status" className="m-0 text-xs text-muted-foreground">{t.composer.storageUnavailable}</p>}
                {error != null && <p className="m-0 text-xs text-muted-foreground">{t.composer.draftKept}</p>}
                {recoveries > 0 && <div className="text-xs text-muted-foreground"><p role="status">{t.composer.recoveryKept}</p>
                    <Button variant="plain" size="sm" disabled={sharedPending} onClick={() => drafts.restore(draftKey)}>{t.composer.restoreUnsent}</Button></div>}
                {(busy || sharedPending) && <p role="status" className="m-0 text-xs text-muted-foreground">{instant ? t.composer.sending : t.composer.saving}</p>}
            </Stack>
        </form>
    );
}
