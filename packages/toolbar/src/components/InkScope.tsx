import { PropsWithChildren } from 'react';

/**
 * The review layer is always ink (packages/brand/BRAND.md, "The review layer"): the toolbar pill
 * and the inbox sidebar use the dark tokens whatever the system theme, while threads follow it.
 * The UI kit's `dark:` variants match `[class="dark"]`, so the class has to be exactly `dark`.
 */
export function InkScope({ children }: PropsWithChildren) {
    return (
        <div className="dark" style={{ display: 'contents' }}>
            {children}
        </div>
    );
}
