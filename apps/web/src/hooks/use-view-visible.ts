'use client';

import { useLayoutEffect, useState, useSyncExternalStore } from 'react';

const subscribeNothing = () => () => {};

/**
 * False while Next keeps this view mounted but hidden. With Cache Components, Next keeps up to three visited routes in
 * the document under a hidden `<Activity>` (`display: none`) instead of unmounting them, so a hidden page would still
 * add its h1 and its fixed ids (`#comments`) to the visible one's. Activity runs layout effect cleanups when it hides a
 * view, so this turns false then, and true again before the view is shown.
 *
 * The server and hydration render it true. A view can also mount while hidden (Next refreshing a kept route), where no
 * effect runs: with `untilShown` a client mount starts false and turns true in the layout effect, before it paints,
 * so a view mounted hidden stays false. Without it a client mount starts true, so an id is there in the commit that
 * mounts it (Next scrolls to `#comments` then), at the cost of a view mounted hidden keeping it.
 */
export function useViewVisible({ untilShown = false }: { untilShown?: boolean } = {}) {
    const hydrating = useSyncExternalStore(subscribeNothing, () => false, () => true);
    const [shown, setShown] = useState<boolean>();
    useLayoutEffect(() => {
        setShown(true);
        return () => setShown(false);
    }, []);
    return shown ?? (hydrating || !untilShown);
}
