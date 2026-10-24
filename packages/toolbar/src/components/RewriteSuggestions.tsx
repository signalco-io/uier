'use client';

import React, { useState } from 'react';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Row } from '@signalco/ui-primitives/Row';
import { Button } from '@signalco/ui-primitives/Button';
import { Input } from '@signalco/ui-primitives/Input';
import { AI } from '@signalco/ui-icons';
import { useRewriteSuggestions } from '../hooks/useRewriteSuggestions';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { useAnnounce } from './Announcer';

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
 * and the suggestions to pick from. The reviewer's own text never depends on them.
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
                        className="min-w-0 flex-1" />
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
            <CommentsErrorMessage error={suggest.error} />
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
