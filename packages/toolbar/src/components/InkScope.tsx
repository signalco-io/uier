import { createContext, PropsWithChildren, useContext, useState } from 'react';

const InkContainerContext = createContext<HTMLElement | null>(null);

/**
 * Where the review layer's popovers and menus go (`Popper`'s `container`): inside the ink scope,
 * so they are dark like the pill they open from. `null` outside one (or before it mounted).
 */
export function useInkContainer() {
    return useContext(InkContainerContext);
}

/**
 * The review layer is always ink (packages/brand/BRAND.md, "The review layer"): the toolbar pill
 * and the inbox sidebar use the dark tokens whatever the system theme, while threads follow it.
 * The UI kit's `dark:` variants match `[class="dark"]`, so the class has to be exactly `dark`.
 */
export function InkScope({ children }: PropsWithChildren) {
    const [element, setElement] = useState<HTMLDivElement | null>(null);
    return (
        <div ref={setElement} className="dark" style={{ display: 'contents' }}>
            <InkContainerContext value={element}>
                {children}
            </InkContainerContext>
        </div>
    );
}
