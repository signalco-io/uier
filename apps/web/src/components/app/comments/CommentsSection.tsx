'use client';

import { useId, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { useAppI18n } from '@/src/lib/i18n/client';

const subscribeNothing = () => () => {};

/**
 * The project page's comments region, named by its visually hidden heading. Part of the page's static shell: it needs no
 * data, so the page renders it outside its data boundary and the comments' loading state and the loaded comments both
 * stream inside it (uier #439). Its heading id is unique to this view and the `#comments` anchor belongs to the visible
 * view only: Next keeps a previously visited project page in the document while hidden (Cache Components' Activity),
 * and fixed ids would repeat there (uier #328).
 *
 * The anchor is set in a layout effect, which Activity runs only while the view is shown: it is there in the commit that
 * mounts a visible region (before Next scrolls to `#comments`, an ancestor's effect), goes when the view is hidden, and
 * a region that mounts while hidden (a page that finishes loading after it was left) never gets it. The server and
 * hydration render it, so a document's own `#comments` scroll finds it.
 */
export function CommentsSection({ children }: { children: ReactNode }) {
    const { t } = useAppI18n();
    const headingId = useId();
    const hydrating = useSyncExternalStore(subscribeNothing, () => false, () => true);
    const sectionRef = useRef<HTMLElement>(null);
    useLayoutEffect(() => {
        const section = sectionRef.current;
        if (!section) return;
        section.id = 'comments';
        return () => section.removeAttribute('id');
        // Again after hydration, whose render that drops the server's id attribute runs before this
    }, [hydrating]);
    return (
        <section ref={sectionRef} id={hydrating ? 'comments' : undefined} aria-labelledby={headingId} className="flex scroll-mt-6 flex-col gap-4">
            <h2 id={headingId} className="sr-only">{t("Comments")}</h2>
            {children}
        </section>
    );
}
