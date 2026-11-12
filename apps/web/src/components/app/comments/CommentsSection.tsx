'use client';

import { useId, type ReactNode } from 'react';
import { useViewVisible } from '@/src/hooks/use-view-visible';

/**
 * The project page's comments region, named by its visually hidden heading. Its heading id is unique to this view and
 * the `#comments` anchor belongs to the visible view only: Next keeps a previously visited project page in the document
 * while hidden (Cache Components' Activity), and fixed ids would repeat there (uier #328).
 */
export function CommentsSection({ title, children }: { title: string; children: ReactNode }) {
    const headingId = useId();
    const visible = useViewVisible();
    return (
        <section id={visible ? 'comments' : undefined} aria-labelledby={headingId} className="flex scroll-mt-6 flex-col gap-4">
            <h2 id={headingId} className="sr-only">{title}</h2>
            {children}
        </section>
    );
}
