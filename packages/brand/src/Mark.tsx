import type { SVGProps } from 'react';
import { MARK_PATH, MARK_VIEWBOX } from './brand';

export type MarkProps = Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'children' | 'title'> & {
    /** Rendered width and height in px (the mark is square). */
    size?: number;
    /** Accessible name. Omit when the mark is decorative, e.g. next to the wordmark. */
    title?: string;
};

/**
 * The uier mark: a square with three corners at full radius and the top-left corner sharp.
 * Fills with `currentColor`, so it is ink on light and white on dark without any props.
 */
export function Mark({ size = 24, title, ...rest }: MarkProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox={MARK_VIEWBOX}
            width={size}
            height={size}
            role={title ? 'img' : undefined}
            aria-label={title}
            aria-hidden={title ? undefined : true}
            {...rest}>
            <path d={MARK_PATH} fill="currentColor" />
        </svg>
    );
}
