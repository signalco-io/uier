'use client';

import type { SVGProps } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCommentScreenshot } from '../hooks/useComments';
import { screenshotQueryKey } from '../hooks/api';
import { openImageInNewTab } from '../screenshot';
import type { CommentItem } from './@types/Comments';

/** Lucide's camera (the UI kit has none) */
export function CameraIcon({ size = 24, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            {...rest}>
            <path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" />
            <circle cx="12" cy="13" r="3" />
        </svg>
    );
}

export const screenshotAlt = 'Screenshot of the commented part of the page';

/**
 * The screenshot under a thread's first message. The image is fetched once per comment (it never
 * changes); while it loads, a placeholder of its size keeps the thread from jumping.
 */
export function CommentScreenshot({ comment }: { comment: CommentItem }) {
    const size = comment.screenshot;
    const { data, isError } = useQuery({
        queryKey: screenshotQueryKey(comment.id),
        queryFn: () => getCommentScreenshot(comment.id),
        enabled: Boolean(size),
        staleTime: Infinity,
        retry: 1
    });
    if (!size) {
        return null;
    }

    if (isError) {
        return <p className="m-0 text-xs text-muted-foreground">The screenshot is no longer available.</p>;
    }

    return data
        ? (
            <button
                type="button"
                title="Open the screenshot full size"
                className="block w-full cursor-zoom-in rounded-md p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                onClick={() => openImageInNewTab(data)}>
                <img
                    src={data}
                    width={size.width}
                    height={size.height}
                    alt={screenshotAlt}
                    className="block h-auto max-h-80 w-full rounded-md border object-contain object-left-top" />
            </button>
        )
        : (
            <div
                aria-hidden="true"
                className="w-full max-h-80 animate-pulse rounded-md border bg-muted"
                style={{ aspectRatio: `${size.width} / ${size.height}` }} />
        );
}
