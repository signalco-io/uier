'use client';

import { useSyncExternalStore } from 'react';
import { draftLifetimeMs } from '../hooks/draftStorage';

/** The same words as the uier app's reply composer */
export const newLineHint = 'Shift+Enter for a new line';

const draftLifetimeDays = Math.round(draftLifetimeMs / (24 * 60 * 60 * 1000));

// A mouse or trackpad comes with a keyboard. A phone's on-screen keyboard has no Shift+Enter: its
// Enter key sends (the textarea labels it with `enterKeyHint`), so the hint would not be true there.
const keyboardQuery = '(any-pointer: fine)';
const subscribeKeyboard = (listener: () => void) => {
    const query = window.matchMedia(keyboardQuery);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
};

export function useKeyboardHint() {
    return useSyncExternalStore(subscribeKeyboard, () => window.matchMedia(keyboardQuery).matches, () => true);
}

type ComposerFooterProps = {
    /** Describes the text box (`aria-describedby`) */
    id: string;
    keyboardHint: boolean;
    /** What Enter does: send new text or save an edit */
    submitVerb: 'send' | 'save';
    /** The text came back from a draft saved in this browser */
    draftSaved: boolean;
};

/**
 * Under a composer's box: how to add a new line, and that a restored draft is kept in this
 * browser (only there: drafts are never sent to uier before they are posted).
 */
export function ComposerFooter({ id, keyboardHint, submitVerb, draftSaved }: ComposerFooterProps) {
    if (!keyboardHint && !draftSaved) {
        return null;
    }

    return (
        <div id={id} className="flex flex-wrap justify-between gap-x-3 px-0.5 text-xs text-muted-foreground">
            {keyboardHint && (
                <span>
                    <span aria-hidden="true">{newLineHint}</span>
                    <span className="sr-only">Enter to {submitVerb}. {newLineHint}.</span>
                </span>
            )}
            {draftSaved && (
                <span title={`Unsent text stays in this browser for ${draftLifetimeDays} days after your last change.`}>
                    Draft saved in this browser
                </span>
            )}
        </div>
    );
}
