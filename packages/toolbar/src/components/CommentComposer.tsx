'use client';

import React, { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Row } from '@signalco/ui-primitives/Row';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Input } from '@signalco/ui-primitives/Input';
import { cx } from '@signalco/ui-primitives/cx';
import { Send } from '@signalco/ui-icons';
import { useDrafts } from '../hooks/useDrafts';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { useAnnounce } from './Announcer';
import { commentTextMaxLength, destructiveTextClassName, inputFocusRingClassName } from './@types/Comments';
import { useProjectViewer } from '../project/ProjectGate';
import { getGuestName, setGuestName } from '../project/projectSession';

/** Longest guest name the review API accepts */
const guestNameMaxLength = 80;

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
    pending?: boolean;
    error?: unknown;
    /** Resolves when saved; rejects to retain the text. Capture belongs to the draft, not this form. */
    onSubmit: (text: string) => Promise<unknown>;
    /** Shows a "Discard" button while there is text (new comments) */
    onDiscard?: () => void;
};

/**
 * Text box for a comment or reply. The UI kit has no multi-line input, so this is a plain
 * textarea styled like the kit's `Input` (bordered, radius 8, blue focus ring).
 * Enter sends, Shift+Enter adds a new line.
 */
export function CommentComposer({ ref, label, placeholder, submitLabel, draftKey, quote, autoFocus, pending, error, onSubmit, onDiscard }: CommentComposerProps) {
    const formRef = useRef<HTMLFormElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const inputId = useId();
    const counterId = useId();
    const drafts = useDrafts();
    const announce = useAnnounce();
    const [text, setTextState] = useState(() => drafts.get(draftKey) ?? '');
    const trimmedText = text.trim();
    // Guests of a project tag their comments with their name, asked once and kept on this site
    const { needsName } = useProjectViewer();
    const [savedName, setSavedName] = useState(() => needsName ? getGuestName() : undefined);
    const askName = needsName && !savedName;
    const [name, setName] = useState('');
    const [nameMissing, setNameMissing] = useState(false);
    const showCounter = text.length >= counterThreshold;
    const submittingRef = useRef(false);
    const [submitting, setSubmitting] = useState(false);
    const busy = pending || submitting;

    const setText = (value: string) => {
        setTextState(value);
        if (value.length) {
            drafts.set(draftKey, value);
        } else {
            drafts.delete(draftKey);
        }
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

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!trimmedText.length || pending || submittingRef.current) {
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

        submittingRef.current = true;
        setSubmitting(true);
        try {
            await onSubmit(trimmedText);
            setText('');
        } catch {
            // Shown by `error`; keep the text so it can be sent again
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            formRef.current?.requestSubmit();
        }
    };

    const handleDiscard = () => {
        setText('');
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
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={handleFocus}
                    maxLength={commentTextMaxLength}
                    readOnly={busy}
                    placeholder={placeholder}
                    aria-label={label}
                    aria-describedby={showCounter ? counterId : undefined}
                    autoComplete="off"
                    className={cx(
                        'block w-full resize-none overflow-y-auto rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground',
                        'placeholder:text-muted-foreground',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                        'disabled:cursor-not-allowed disabled:opacity-50'
                    )}
                    style={{ maxHeight: textareaMaxHeight }} />
                <CommentsErrorMessage error={error} />
                {submitting && <p role="status" className="m-0 text-xs text-muted-foreground">Saving...</p>}
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
                        {onDiscard && text.length > 0 && (
                            <Button
                                variant="plain"
                                size="sm"
                                type="button"
                                disabled={busy}
                                onClick={handleDiscard}>
                                Discard
                            </Button>
                        )}
                        <IconButton
                            variant="solid"
                            size="sm"
                            type="submit"
                            title={submitLabel}
                            aria-label={submitLabel}
                            disabled={!trimmedText.length || busy}>
                            <Send size={16} />
                        </IconButton>
                    </Row>
                </Row>
            </Stack>
        </form>
    );
}
