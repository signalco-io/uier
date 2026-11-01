import { Badge } from '@/src/components/ui/badge';

/** The badge's id: the last used option's button points `aria-describedby` at it (one per page) */
export const LAST_USED_ID = 'sign-in-last-used';

/**
 * "Last used" at the right edge of the sign-in option this browser signed in with last
 * (`getLastSignInMethod`). The button is `relative` and described by it.
 */
export function LastUsedBadge() {
    return (
        <Badge id={LAST_USED_ID} variant="outline" className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground">
            Last used
        </Badge>
    );
}
