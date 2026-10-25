'use client';

import { useContext, useEffect, useRef, useState } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { Button } from '@signalco/ui-primitives/Button';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { useQuery } from '@tanstack/react-query';
import { getCommentScreenshot } from '../hooks/useComments';
import { screenshotQueryKey } from '../hooks/api';
import type { CommentItem } from './@types/Comments';

export const screenshotAlt = 'Screenshot of the commented part of the page';

/** Whether the element is in (or near) the window, once; scrolled containers count (the inbox) */
function useSeen<T extends Element>() {
    const ref = useRef<T>(null);
    const [seen, setSeen] = useState(false);
    useEffect(() => {
        const element = ref.current;
        if (!element || seen) {
            return;
        }
        const observer = new IntersectionObserver((entries) => {
            if (entries.some(entry => entry.isIntersecting)) {
                setSeen(true);
                observer.disconnect();
            }
        }, { rootMargin: '200px' });
        observer.observe(element);
        return () => observer.disconnect();
    }, [seen]);
    return [ref, seen] as const;
}

/**
 * The screenshot under a thread's first message. The image is fetched when it comes into view (the
 * inbox lists many threads), once per comment (it never changes); until then a placeholder of its
 * size keeps the thread from jumping.
 */
export function CommentScreenshot({ comment }: { comment: CommentItem }) {
    const size = comment.screenshot;
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const [open, setOpen] = useState(false);
    const [placeholderRef, seen] = useSeen<HTMLDivElement>();
    const { data, isError } = useQuery({
        queryKey: screenshotQueryKey(comment.id),
        queryFn: () => getCommentScreenshot(comment.id),
        enabled: Boolean(size) && seen,
        staleTime: Infinity,
        retry: 1
    });
    if (!size) {
        return <p className="m-0 text-xs text-muted-foreground">No screenshot available.</p>;
    }

    if (isError) {
        return <p className="m-0 text-xs text-muted-foreground">The screenshot is no longer available.</p>;
    }

    return data
        ? (
            <Popper
                container={rootElement}
                open={open}
                onOpenChange={setOpen}
                aria-label="Screenshot"
                className="z-[70] flex max-h-[min(var(--radix-popover-content-available-height),85vh)] w-[min(88vw,64rem)] flex-col gap-2 overflow-auto rounded-xl p-3"
                trigger={(
                    <Button variant="plain" className="block h-auto w-24 cursor-zoom-in p-0" aria-label={screenshotAlt} title="Expand screenshot">
                        <img src={data} width={size.width} height={size.height} alt={screenshotAlt}
                            className="block h-16 w-24 rounded-md border object-contain" />
                    </Button>
                )}>
                <Button variant="plain" size="sm" className="self-end" onClick={() => setOpen(false)}>Close screenshot</Button>
                <img src={data} width={size.width} height={size.height} alt="Expanded screenshot"
                    className="block min-h-0 w-full object-contain" />
            </Popper>
        )
        : (
            <div
                ref={placeholderRef}
                aria-hidden="true"
                className="h-16 w-24 animate-pulse rounded-md border bg-muted"
                style={{ aspectRatio: `${size.width} / ${size.height}` }} />
        );
}
