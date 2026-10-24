'use client';

import React, { useState } from 'react';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Row } from '@signalco/ui-primitives/Row';
import { Button } from '@signalco/ui-primitives/Button';
import { Input } from '@signalco/ui-primitives/Input';
import { cx } from '@signalco/ui-primitives/cx';
import { AI } from '@signalco/ui-icons';
import { CommentsApiError } from '../hooks/api';
import { useRewriteSuggestions } from '../hooks/useRewriteSuggestions';
import { CommentsErrorMessage, retryAfterText } from './CommentsErrorMessage';
import { useAnnounce } from './Announcer';
import { commentTextMaxLength, destructiveTextClassName, inputFocusRingClassName } from './@types/Comments';

// The API's limit (MAX_REWRITE_INSTRUCTION_LENGTH)
const instructionMaxLength = 300;

type RewriteSuggestionsProps = {
    /** The selected page text */
    text: string;
    /** Puts a suggestion into the suggested text, to post as it is or to edit */
    onPick: (suggestion: string) => void;
};

/**
 * AI suggestions for a rewrite (under the rewrite's text box): an optional instruction, "Suggest",
 * and the suggestions to pick from. The reviewer's own text never depends on them. Offered only
 * for selections that fit a comment (a rewrite comment quotes the original whole).
 */
export function RewriteSuggestions({ text, onPick }: RewriteSuggestionsProps) {
    const [instruction, setInstruction] = useState('');
    const suggest = useRewriteSuggestions();
    const announce = useAnnounce();
    const suggestions = suggest.data ?? [];

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (suggest.isPending) {
            return;
        }
        try {
            const result = await suggest.mutateAsync({ text, instruction });
            announce(result.length
                ? `${result.length} ${result.length === 1 ? 'suggestion' : 'suggestions'}`
                : 'No suggestions for this text');
        } catch {
            // Shown below
        }
    };

    if (text.trim().length > commentTextMaxLength) {
        return (
            <p className="m-0 border-t bg-card px-3 py-3 text-sm text-muted-foreground">
                Suggestions work on selections of up to {commentTextMaxLength} characters.
            </p>
        );
    }

    const rateLimited = suggest.error instanceof CommentsApiError && suggest.error.code === 'rate_limited'
        ? suggest.error
        : undefined;

    return (
        <Stack spacing={1} className="border-t bg-card px-3 py-3">
            <form onSubmit={handleSubmit}>
                <Row spacing={1}>
                    <Input
                        aria-label="Instruction for suggestions"
                        placeholder="Shorter, friendlier... (optional)"
                        value={instruction}
                        maxLength={instructionMaxLength}
                        onChange={(event) => setInstruction(event.target.value)}
                        className={cx('min-w-0 flex-1', inputFocusRingClassName)} />
                    <Button
                        type="submit"
                        variant="outlined"
                        size="sm"
                        loading={suggest.isPending}
                        startDecorator={<AI size={16} />}>
                        Suggest
                    </Button>
                </Row>
            </form>
            {rateLimited
                ? (
                    <p role="alert" className={cx('m-0 text-sm', destructiveTextClassName)}>
                        No more suggestions for now. Try again {retryAfterText(rateLimited.retryAfter)}. You can still write your own.
                    </p>
                )
                : <CommentsErrorMessage error={suggest.error} />}
            {suggest.isSuccess && !suggestions.length && (
                <p className="m-0 text-sm text-muted-foreground">No suggestions for this text.</p>
            )}
            {suggestions.length > 0 && (
                <Stack role="group" aria-label="Suggestions" spacing={1}>
                    {suggestions.map((suggestion) => (
                        <Button
                            key={suggestion}
                            variant="outlined"
                            size="sm"
                            fullWidth
                            className="h-auto justify-start whitespace-normal py-2 text-left font-normal"
                            onClick={() => onPick(suggestion)}>
                            {suggestion}
                        </Button>
                    ))}
                </Stack>
            )}
        </Stack>
    );
}
