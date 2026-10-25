'use client';

import React, { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore, type Ref } from 'react';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Row } from '@signalco/ui-primitives/Row';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Input } from '@signalco/ui-primitives/Input';
import { cx } from '@signalco/ui-primitives/cx';
import { Send } from '@signalco/ui-icons';
import { useParticipants, type Participant } from '../hooks/useParticipants';
import { mentionQuery, moveMentions } from '../mentions';
import type { Mention } from './@types/Comments';
import { useDrafts } from '../hooks/useDrafts';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { useAnnounce } from './Announcer';
import { commentTextMaxLength, destructiveTextClassName, inputFocusRingClassName } from './@types/Comments';
import { useProjectViewer } from '../project/ProjectGate';
import { getGuestName, setGuestName } from '../project/projectSession';

/** Longest guest name the review API accepts */
const guestNameMaxLength = 80;
const noMentions: Mention[] = [];

// Show the character counter when the text gets close to the limit
const counterThreshold = commentTextMaxLength - 100;
// Remaining characters are announced once at each of these lengths, not on every key
const announceThresholds = [counterThreshold, commentTextMaxLength - 10, commentTextMaxLength];
// The text box grows with the text up to about 8 lines, then scrolls
const textareaMaxHeight = 176;

function thresholdIndex(length: number) {
    return announceThresholds.filter(t => length >= t).length;
}

export type CommentComposerHandle = {
    /**
     * Replaces the text as if it was typed: the text box stays (with a guest's name and the undo
     * history, so Ctrl/Cmd+Z brings the earlier text back) and gets the focus
     */
    replaceText: (text: string) => void;
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
    error?: unknown;
    /**
     * Resolves when saved; rejects to retain the text. Capture belongs to the draft, not this form.
     * New text (no `onCancel`) is sent in the background: the form is empty again at once, and a
     * failure puts the text back (the toast says why).
     */
    onSubmit: (text: string, mentions?: Mention[]) => Promise<unknown>;
    /** Shows a "Discard" button while there is text (new comments) */
    onDiscard?: () => void;
};

/**
 * Text box for a comment or reply. The UI kit has no multi-line input, so this is a plain
 * textarea styled like the kit's `Input` (bordered, radius 8, blue focus ring).
 * Enter sends, Shift+Enter adds a new line.
 */
export function CommentComposer({ ref, label, placeholder, submitLabel, draftKey, quote, autoFocus, pending, error, onSubmit, onDiscard, initialText, initialMentions, commentId, onCancel }: CommentComposerProps) {
    const formRef = useRef<HTMLFormElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const inputId = useId();
    const counterId = useId();
    const drafts = useDrafts();
    const announce = useAnnounce();
    const text = useSyncExternalStore(
        listener => drafts.subscribe(draftKey, listener),
        () => drafts.get(draftKey) ?? initialText ?? '');
    const [storageAvailable, setStorageAvailable] = useState(drafts.available);
    const trimmedText = text.trim();
    const mentions = useSyncExternalStore(
        listener => drafts.subscribe(draftKey, listener),
        () => drafts.details(draftKey)?.mentions ?? (text === initialText ? initialMentions ?? noMentions : noMentions));
    const [caret, setCaret] = useState(0);
    const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
    const [activeSuggestion, setActiveSuggestion] = useState(0);
    const listId = useId();
    const query = suggestionsDismissed ? undefined : mentionQuery(text, caret);
    const participants = useParticipants(commentId, Boolean(query));
    const suggestions = query ? participants.data?.filter(person => person.name.toLocaleLowerCase().includes(query.search)).slice(0, 8) ?? [] : [];
    const selectedIndex = Math.min(activeSuggestion, Math.max(0, suggestions.length - 1));
    const showSuggestions = Boolean(query && suggestions.length);

    // Guests of a project tag their comments with their name, asked once and kept on this site
    const { needsName, isMember } = useProjectViewer();
    const mentionHintId = useId();
    const [savedName, setSavedName] = useState(() => needsName ? getGuestName() : undefined);
    const askName = needsName && !savedName;
    const [name, setName] = useState('');
    const [nameMissing, setNameMissing] = useState(false);
    const showCounter = text.length >= counterThreshold;
    const submittingRef = useRef(false);
    const [submitting, setSubmitting] = useState(false);
    const sharedPending = useSyncExternalStore(
        listener => drafts.subscribe(draftKey, listener),
        () => drafts.pending(draftKey));
    // Editing waits for the save; new comments, replies and feedback never block the form
    const instant = !onCancel;
    const busy = !instant && (pending || submitting || sharedPending);

    const setText = (value: string) => {
        const next = moveMentions(text, value, mentions).map(({ userId, start, end }) => ({ userId, start, end }));
        drafts.set(draftKey, value);
        drafts.setDetails(draftKey, { mentions: next });
        setStorageAvailable(drafts.available());
    };

    useImperativeHandle(ref, () => ({
        replaceText: (value: string) => {
            const textarea = textareaRef.current;
            if (!textarea) {
                return;
            }
            textarea.focus();
            textarea.select();
            // Like typing it: the change is an input event (onChange keeps the drafts in sync) and
            // one step in the text box's undo history
            const inserted = value.length
                ? document.execCommand('insertText', false, value)
                : document.execCommand('delete');
            if (!inserted || textarea.value !== value) {
                // Without execCommand: no undo step
                setText(value);
                textarea.setSelectionRange(value.length, value.length);
            }
        }
    }));

    useEffect(() => {
        if (!autoFocus) {
            return;
        }

        // After the popover's own open focus handling, which moves the focus to the popover
        // itself when the previous focus was in the toolbar (the document only sees the shadow host)
        const timeout = window.setTimeout(() => textareaRef.current?.focus(), 0);
        return () => window.clearTimeout(timeout);
    }, [autoFocus]);

    // A restored draft continues where it ended (the first focus would put the caret at the start)
    const caretPlacedRef = useRef(false);
    const handleFocus = (e: React.FocusEvent<HTMLTextAreaElement>) => {
        if (caretPlacedRef.current) {
            return;
        }
        caretPlacedRef.current = true;
        // Preserve an existing selection (including select-all used to replace or clear text).
        if (e.currentTarget.selectionStart !== e.currentTarget.selectionEnd) return;
        const length = e.currentTarget.value.length;
        e.currentTarget.setSelectionRange(length, length);
    };

    // Grow with the text
    useLayoutEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) {
            return;
        }
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(textarea.scrollHeight + 2, textareaMaxHeight)}px`;
    }, [text]);

    // Announce the remaining characters when the text crosses a threshold
    const lastThreshold = useRef(thresholdIndex(text.length));
    useEffect(() => {
        const current = thresholdIndex(text.length);
        if (current > lastThreshold.current) {
            const left = commentTextMaxLength - text.length;
            announce(left > 0 ? `${left} characters left` : 'Character limit reached');
        }
        lastThreshold.current = current;
    }, [text.length, announce]);

    /** Empties the form at once; a failure puts the text back (before anything written meanwhile) */
    const sendInBackground = async (sentText: string, sentMentions: Mention[], send: () => Promise<unknown>) => {
        const sentAnchor = JSON.stringify(drafts.details(draftKey)?.anchor);
        const sameDraft = () => JSON.stringify(drafts.details(draftKey)?.anchor) === sentAnchor;
        drafts.set(draftKey, '');
        drafts.setDetails(draftKey, { mentions: [] });
        try {
            await send();
            if (!drafts.get(draftKey) && sameDraft()) drafts.delete(draftKey);
        } catch {
            const typed = drafts.get(draftKey) ?? '';
            if (!typed.trim()) {
                drafts.set(draftKey, sentText);
                drafts.setDetails(draftKey, { mentions: sentMentions });
                return;
            }
            const joined = `${sentText}\n\n${typed}`;
            if (joined.length > commentTextMaxLength) return;
            const shift = sentText.length + 2;
            drafts.set(draftKey, joined);
            drafts.setDetails(draftKey, { mentions: [...sentMentions, ...(drafts.details(draftKey)?.mentions ?? []).map(m => ({ ...m, start: m.start + shift, end: m.end + shift }))] });
        }
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        // The draft's text, not this render's: a second Enter before the form re-rendered would send it again
        const text = drafts.get(draftKey) ?? initialText ?? '';
        const mentions = drafts.details(draftKey)?.mentions ?? (text === initialText ? initialMentions ?? noMentions : noMentions);
        const trimmedText = text.trim();
        if (!trimmedText.length || busy || drafts.pending(draftKey) || submittingRef.current) {
            return;
        }
        if (askName) {
            if (!name.trim().length) {
                setNameMissing(true);
                return;
            }
            setGuestName(name);
            setSavedName(name.trim());
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
        if (!query) return;
        const label = `@${person.name}`;
        const value = text.slice(0, query.start) + label + ' ' + text.slice(query.end);
        if (value.length > commentTextMaxLength) return;
        const kept = moveMentions(text, value, mentions);
        setText(value);
        const selected = [...kept, { userId: person.id, start: query.start, end: query.start + label.length }].sort((a, b) => a.start - b.start);
        drafts.setDetails(draftKey, { mentions: selected.map(({ userId, start, end }) => ({ userId, start, end })) });
        setSuggestionsDismissed(true);
        const next = query.start + label.length + 1;
        requestAnimationFrame(() => { textareaRef.current?.focus(); textareaRef.current?.setSelectionRange(next, next); setCaret(next); });
        announce(`Mentioned ${person.name}`);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (showSuggestions && !e.nativeEvent.isComposing) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault(); setActiveSuggestion((selectedIndex + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length); return;
            }
            if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) { e.preventDefault(); selectMention(suggestions[selectedIndex]!); return; }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSuggestionsDismissed(true); return; }
        }

        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            formRef.current?.requestSubmit();
        }
    };

    const handleDiscard = () => {
        drafts.delete(draftKey);
        onDiscard?.();
    };

    return (
        <form ref={formRef} onSubmit={handleSubmit} aria-busy={busy}>
            <Stack spacing={1} className="bg-card px-3 py-3">
                {Boolean(quote?.length) && (
                    <blockquote className="m-0 line-clamp-3 border-l-2 border-muted-foreground bg-muted px-2 py-1 text-sm text-secondary-foreground">
                        {quote}
                    </blockquote>
                )}
                {askName && (
                    <>
                        <Input
                            label="Your name"
                            name="authorName"
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value);
                                setNameMissing(false);
                            }}
                            maxLength={guestNameMaxLength}
                            autoComplete="name"
                            placeholder="Shown with your comments"
                            className={inputFocusRingClassName}
                            fullWidth />
                        {nameMissing && (
                            <p role="alert" className={cx('m-0 text-sm', destructiveTextClassName)}>Enter your name to comment.</p>
                        )}
                    </>
                )}
                <textarea
                    ref={textareaRef}
                    id={inputId}
                    name="text"
                    rows={2}
                    value={text}
                    onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); setSuggestionsDismissed(false); setActiveSuggestion(0); }}
                    onSelect={e => setCaret(e.currentTarget.selectionStart)}
                    aria-autocomplete={showSuggestions ? 'list' : undefined}
                    aria-controls={showSuggestions ? listId : undefined}
                    aria-activedescendant={showSuggestions ? `${listId}-${selectedIndex}` : undefined}
                    onKeyDown={handleKeyDown}
                    onFocus={handleFocus}
                    maxLength={commentTextMaxLength}
                    readOnly={busy}
                    placeholder={placeholder}
                    aria-label={label}
                    aria-describedby={[showCounter ? counterId : '', isMember ? mentionHintId : ''].filter(Boolean).join(' ') || undefined}
                    autoComplete="off"
                    className={cx(
                        'block w-full resize-none overflow-y-auto rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground',
                        'placeholder:text-muted-foreground',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                        'disabled:cursor-not-allowed disabled:opacity-50'
                    )}
                    style={{ maxHeight: textareaMaxHeight }} />
                {isMember && <p id={mentionHintId} className="m-0 text-xs text-secondary-foreground">Type @ to mention someone with access.</p>}
                {showSuggestions && <div id={listId} role="listbox" aria-label="Mention people" className="max-h-48 overflow-y-auto rounded-xl border p-1">
                    {suggestions.map((person, index) => <Button key={person.id} id={`${listId}-${index}`} role="option" aria-selected={index === selectedIndex}
                        variant="plain" size="sm" className={cx('min-h-11 w-full justify-start', index === selectedIndex && 'bg-muted')}
                        onMouseDown={e => e.preventDefault()} onClick={() => selectMention(person)}>
                        {person.name}<span className="ml-2 font-mono text-xs text-secondary-foreground">{person.id.slice(-6)}</span>
                    </Button>)}
                </div>}
                {query && participants.error && <p role="status" className="m-0 text-xs text-muted-foreground">People could not be loaded. You can still post without a mention.</p>}
                <CommentsErrorMessage error={error} />
                {!storageAvailable && text.length > 0 && <p role="status" className="m-0 text-xs text-muted-foreground">Browser storage is unavailable. Keep this page open to keep your draft.</p>}
                {error != null && <p className="m-0 text-xs text-muted-foreground">Your draft is kept. Try sending again.</p>}
                {busy && <p role="status" className="m-0 text-xs text-muted-foreground">Saving...</p>}
                <Row justifyContent="space-between" spacing={1}>
                    <span
                        id={counterId}
                        className={cx(
                            'text-xs tabular-nums',
                            text.length >= commentTextMaxLength ? destructiveTextClassName : 'text-muted-foreground'
                        )}>
                        {showCounter && (
                            <>
                                {text.length}/{commentTextMaxLength}
                                <span className="sr-only"> characters</span>
                            </>
                        )}
                    </span>
                    <Row spacing={1}>
                        {onCancel && <Button variant="plain" size="sm" type="button" disabled={busy} onClick={onCancel}>Cancel</Button>}
                        {!onCancel && text.length > 0 && (
                            <Button
                                variant="plain"
                                size="sm"
                                type="button"
                                disabled={busy}
                                onClick={handleDiscard}>
                                Discard
                            </Button>
                        )}
                        {onCancel ? (
                            <Button type="submit" size="sm" disabled={!trimmedText.length || busy}>{submitLabel}</Button>
                        ) : <IconButton
                            variant="solid"
                            size="sm"
                            type="submit"
                            title={submitLabel}
                            aria-label={submitLabel}
                            disabled={!trimmedText.length || busy}>
                            <Send size={16} />
                        </IconButton>}
                    </Row>
                </Row>
            </Stack>
        </form>
    );
}
