'use client';

import type { ReactNode } from 'react';
import { useAppI18n } from '@/src/lib/i18n/client';
import { Badge } from '@/src/components/ui/badge';

/** The badge's id: the last used option's button points `aria-describedby` at it (one per page) */
export const LAST_USED_ID = 'sign-in-last-used';

/**
 * "Last used" over the right edge of the sign-in option this browser signed in with last
 * (`getLastSignInMethod`), which is described by it. Clicks on it reach the button under it.
 */
function LastUsedBadge() {
    const { t } = useAppI18n();
    return (
        <Badge id={LAST_USED_ID} variant="outline" className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground">
            {t("Last used")}{' '}</Badge>
    );
}

/**
 * One sign-in option: its button (`children`) and, when it is the last used one, the badge beside it. The badge
 * is not inside the button: a button named "Sign in with Google" for its visible "Google" has to hold all the
 * text it shows in that name (WCAG 2.5.3, label in name), in every language, and "Last used" is its description.
 */
export function SignInOption({ lastUsed = false, children }: { lastUsed?: boolean; children: ReactNode }) {
    return (
        <div className="relative">
            {children}
            {lastUsed && <LastUsedBadge />}
        </div>
    );
}
