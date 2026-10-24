'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Row } from '@signalco/ui-primitives/Row';
import { Input } from '@signalco/ui-primitives/Input';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { cx } from '@signalco/ui-primitives/cx';
import { Send } from '@signalco/ui-icons';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { commentTextMaxLength } from './@types/Comments';

// Show the character counter when the text gets close to the limit
const counterThreshold = commentTextMaxLength - 100;

type CommentComposerProps = {
    /** Accessible name of the text input */
    label: string;
    placeholder: string;
    submitLabel: string;
    /** Selected page text the new comment is about */
    quote?: string;
    autoFocus?: boolean;
    pending?: boolean;
    error?: unknown;
    /** Resolves when the text was saved (the input is cleared), rejects to keep the text */
    onSubmit: (text: string) => Promise<unknown>;
};

export function CommentComposer({ label, placeholder, submitLabel, quote, autoFocus, pending, error, onSubmit }: CommentComposerProps) {
    const formRef = useRef<HTMLFormElement>(null);
    const inputId = useId();
    const [text, setText] = useState('');
    const trimmedText = text.trim();
    const showCounter = text.length >= counterThreshold;

    useEffect(() => {
        if (!autoFocus) {
            return;
        }

        // After the popover's own open focus handling, which moves the focus to the popover
        // itself when the previous focus was in the toolbar (the document only sees the shadow host)
        const timeout = window.setTimeout(() => formRef.current?.querySelector('input')?.focus(), 0);
        return () => window.clearTimeout(timeout);
    }, [autoFocus]);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!trimmedText.length || pending) {
            return;
        }

        try {
            await onSubmit(trimmedText);
            setText('');
        } catch {
            // Shown by `error`; keep the text so it can be sent again
        }
    };

    return (
        <form ref={formRef} onSubmit={handleSubmit}>
            <Stack spacing={1} className="bg-card px-3 py-3">
                {Boolean(quote?.length) && (
                    <blockquote className="m-0 line-clamp-3 border-l-2 border-muted-foreground bg-muted px-2 py-1 text-sm text-secondary-foreground">
                        {quote}
                    </blockquote>
                )}
                <Input
                    id={inputId}
                    name="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={commentTextMaxLength}
                    placeholder={placeholder}
                    aria-label={label}
                    autoComplete="off"
                    className="focus-within:ring-2 focus-within:ring-ring" />
                <CommentsErrorMessage error={error} />
                <Row justifyContent="space-between" spacing={1}>
                    <span
                        aria-live="polite"
                        className={cx(
                            'text-xs tabular-nums',
                            text.length >= commentTextMaxLength ? 'text-red-300' : 'text-muted-foreground'
                        )}>
                        {showCounter && (
                            <>
                                {text.length}/{commentTextMaxLength}
                                <span className="sr-only"> characters</span>
                            </>
                        )}
                    </span>
                    <IconButton
                        variant="solid"
                        size="sm"
                        type="submit"
                        title={submitLabel}
                        aria-label={submitLabel}
                        disabled={!trimmedText.length || pending}>
                        <Send size={16} />
                    </IconButton>
                </Row>
            </Stack>
        </form>
    );
}
