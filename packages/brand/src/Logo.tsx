import type { HTMLAttributes } from 'react';
import { Mark } from './Mark';
import { brand } from './brand';

export type LogoProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
    /** Wordmark font size in px. The mark (0.8×) and the gap (0.4×) scale with it. */
    size?: number;
    /** Render the mark alone (with an accessible name). */
    markOnly?: boolean;
};

/**
 * The uier lockup: mark + lowercase wordmark.
 *
 * Inherits `color` and `font-family` from its parent on purpose: it is ink on light and white
 * on dark, and it picks up Geist from the page (next/font in the web app, the injected
 * stylesheet in the toolbar). Styles are inline because the toolbar renders inside a shadow
 * root where no Tailwind classes exist.
 */
export function Logo({ size = 20, markOnly = false, style, ...rest }: LogoProps) {
    return (
        <span
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: Math.round(size * 0.4),
                lineHeight: 1,
                color: 'inherit',
                ...style
            }}
            {...rest}>
            <Mark size={Math.round(size * 0.8)} title={markOnly ? brand.name : undefined} />
            {!markOnly && (
                <span style={{ fontSize: size, fontWeight: 600, letterSpacing: '-0.03em' }}>
                    {brand.name}
                </span>
            )}
        </span>
    );
}
