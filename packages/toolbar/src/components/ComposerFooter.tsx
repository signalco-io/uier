'use client';

import { useMessages } from '../i18n';

type ComposerFooterProps = {
    /** Describes the text box (`aria-describedby`): the keys */
    keysId: string;
    /** A keyboard is likely (`useKeyboardLikely`): Enter and Shift+Enter are described */
    keyboard: boolean;
    /** What Enter does: send new text or save an edit */
    submitVerb: 'send' | 'save';
};

/**
 * Under a composer's box, for screen readers only: what Enter and Shift+Enter do, since Enter in a
 * text box usually adds a line; everyone else finds the keys in the keyboard shortcuts list
 * (`toolbarShortcuts`), not under every text box. A restored draft needs no line: its kept text is
 * the cue.
 */
export function ComposerFooter({ keysId, keyboard, submitVerb }: ComposerFooterProps) {
    const t = useMessages();
    // Out of the layout: no empty line under the box
    return keyboard ? <span id={keysId} className="sr-only">{submitVerb === 'save' ? t.composer.keysSave : t.composer.keysSend}</span> : null;
}
