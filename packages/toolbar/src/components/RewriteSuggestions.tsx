'use client';

import React, { useState } from 'react';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Button } from '@signalco/ui-primitives/Button';
import { Input } from '@signalco/ui-primitives/Input';
import { cx } from '@signalco/ui-primitives/cx';
import { AI } from '@signalco/ui-icons';
import { CommentsApiError } from '../hooks/api';
import { useRewriteSuggestions } from '../hooks/useRewriteSuggestions';
import { CommentsErrorMessage, retryAfterText, UsageLink } from './CommentsErrorMessage';
import { useAnnounce } from './Announcer';
import { useMessages } from '../i18n';
import { commentTextMaxLength, destructiveTextClassName, inputFocusRingClassName } from './@types/Comments';

// The API's limit (MAX_REWRITE_INSTRUCTION_LENGTH)
const instructionMaxLength = 300;

/**
 * A rewrite's instruction and suggestions, held by the form's owner (like its attached image), so they go on
 * when the form expands to a modal and back. `reset` when the form closes.
 */
export function useRewriteSuggestionsState() {
    const [instruction, setInstruction] = useState('');
    const suggest = useRewriteSuggestions();
    return {
        instruction,
        setInstruction,
        suggest,
        reset: () => {
            setInstruction('');
            suggest.reset();
        }
    };
}

type RewriteSuggestionsProps = {
    /** The selected page text */
    text: string;
    state: ReturnType<typeof useRewriteSuggestionsState>;
    /** Puts a suggestion into the suggested text, to post as it is or to edit */
    onPick: (suggestion: string) => void;
};

/**
 * AI suggestions for a rewrite, in the rewrite's form between the quoted text and the text box
 * (`CommentComposer`'s `beforeText`): an optional instruction in one box with Suggest inside it (like the
 * text box with its buttons), then the suggestions to pick from. It is a part of the composer's form, so
 * Enter in the instruction asks for suggestions instead of posting. The reviewer's own text never depends
 * on them. Offered only for selections that fit a comment (a rewrite comment quotes the original whole).
 */
export function RewriteSuggestions({ text, state, onPick }: RewriteSuggestionsProps) {
    const { instruction, setInstruction, suggest } = state;
    const announce = useAnnounce();
    const t = useMessages();
    const suggestions = suggest.data ?? [];

    const handleSuggest = async () => {
        if (suggest.isPending) {
            return;
        }
        try {
            const result = await suggest.mutateAsync({ text, instruction });
            announce(result.length ? t.rewrite.count(result.length) : t.rewrite.none);
        } catch {
            // Shown below
        }
    };

    if (text.trim().length > commentTextMaxLength) {
        return (
            <p className="m-0 px-0.5 text-xs text-muted-foreground">
                {t.rewrite.tooLong(commentTextMaxLength)}
            </p>
        );
    }

    const rateLimited = suggest.error instanceof CommentsApiError && suggest.error.code === 'rate_limited'
        ? suggest.error
        : undefined;

    return (
        <>
            {/* One box like the text box: the AI mark, the instruction and Suggest; the box shows the focus */}
            <Input
                aria-label={t.rewrite.instruction}
                placeholder={t.rewrite.instructionPlaceholder}
                value={instruction}
                maxLength={instructionMaxLength}
                autoComplete="off"
                enterKeyHint="go"
                onChange={(event) => setInstruction(event.target.value)}
                onKeyDown={(event) => {
                    // Not the composer's implicit submission: Enter here asks for suggestions
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        void handleSuggest();
                    }
                }}
                startDecorator={<AI size={16} aria-hidden="true" className="ml-3 shrink-0 text-muted-foreground" />}
                endDecorator={(
                    <Button
                        type="button"
                        variant="plain"
                        size="xs"
                        loading={suggest.isPending}
                        className="mr-1.5 shrink-0 pointer-coarse:min-h-11"
                        onClick={() => void handleSuggest()}>
                        {t.rewrite.suggest}
                    </Button>
                )}
                fullWidth
                className={cx('rounded-lg [&>input]:pl-2 [&>input]:pr-1 [&>input]:placeholder:text-muted-foreground', inputFocusRingClassName)} />
            {rateLimited
                ? (
                    <p role="alert" className={cx('m-0 text-sm', destructiveTextClassName)}>
                        {t.rewrite.limited(retryAfterText(rateLimited.retryAfter))}
                        <UsageLink error={rateLimited} />
                    </p>
                )
                : <CommentsErrorMessage error={suggest.error} />}
            {suggest.isSuccess && !suggestions.length && (
                <p className="m-0 px-0.5 text-sm text-muted-foreground">{t.rewrite.noneVisible}</p>
            )}
            {suggestions.length > 0 && (
                <Stack role="group" aria-label={t.rewrite.suggestions} spacing={1}>
                    {suggestions.map((suggestion) => (
                        <Button
                            key={suggestion}
                            type="button"
                            variant="outlined"
                            size="sm"
                            fullWidth
                            className="h-auto justify-start whitespace-normal rounded-lg py-2 text-left font-normal"
                            onClick={() => onPick(suggestion)}>
                            {suggestion}
                        </Button>
                    ))}
                </Stack>
            )}
        </>
    );
}
