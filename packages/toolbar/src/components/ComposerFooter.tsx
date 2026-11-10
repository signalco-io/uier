'use client';

import { draftLifetimeMs } from '../hooks/draftStorage';
import { useMessages } from '../i18n';

const draftLifetimeDays = Math.round(draftLifetimeMs / (24 * 60 * 60 * 1000));

type ComposerFooterProps = {
    /** Describe the text box (`aria-describedby`): the keys, and the saved draft */
    keysId: string;
    draftId: string;
    /** A keyboard is likely (`useKeyboardLikely`): Enter and Shift+Enter are described */
    keyboard: boolean;
    /** What Enter does: send new text or save an edit */
    submitVerb: 'send' | 'save';
    /** The text came back from a draft saved in this browser */
    draftSaved: boolean;
};

/**
 * Under a composer's box: that a restored draft is kept in this browser (only there: drafts are never
 * sent to uier before they are posted). What Enter and Shift+Enter do is said to screen readers only,
 * since Enter in a text box usually adds a line; everyone else finds the keys in the keyboard
 * shortcuts list (`toolbarShortcuts`), not under every text box.
 */
export function ComposerFooter({ keysId, draftId, keyboard, submitVerb, draftSaved }: ComposerFooterProps) {
    const t = useMessages();
    return (
        <>
            {/* Out of the layout: no empty line under the box */}
            {keyboard && <span id={keysId} className="sr-only">{submitVerb === 'save' ? t.composer.keysSave : t.composer.keysSend}</span>}
            {draftSaved && (
                <p
                    id={draftId}
                    title={t.composer.draftLifetime(draftLifetimeDays)}
                    className="m-0 px-0.5 text-xs text-muted-foreground">
                    {t.composer.draftSaved}
                </p>
            )}
        </>
    );
}
