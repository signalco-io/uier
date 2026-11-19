'use client';

import { useEffect } from 'react';
import { forgetCurrentShell, forgetShells } from '@/src/lib/app/shellCache';

/**
 * On the sign-in page: the account about to sign in may not be the one whose shell this browser drew last, so the
 * next load starts from the plain frame. With no account left signed in to this browser, every copy is removed.
 */
export function ForgetShellCache({ everything }: { everything: boolean }) {
    useEffect(() => {
        void (everything ? forgetShells() : forgetCurrentShell());
    }, [everything]);
    return null;
}
