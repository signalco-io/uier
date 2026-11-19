'use client';

import { useEffect } from 'react';
import { readProofLinkGrant } from './client';

export function ProofShareNavigation() {
    useEffect(() => {
        const reopen = (event: HashChangeEvent) => {
            if (event.newURL !== window.location.href || !readProofLinkGrant(window.location.hash)) return;
            // A pasted review link can change only the fragment. Start the normal exchange and
            // discard all data read under the previous grant, including the thread and approval panels.
            window.location.reload();
        };
        window.addEventListener('hashchange', reopen);
        return () => window.removeEventListener('hashchange', reopen);
    }, []);
    return null;
}
