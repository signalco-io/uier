import type { CSSProperties, HTMLAttributes } from 'react';
import { PIN_PATH, PIN_VIEWBOX } from './brand';

export type PinProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
    /** Number shown inside the pin (the thread length). */
    count?: number;
    /** Rendered width and height in px. */
    size?: number;
    /** Accessible name; defaults to "Comment, N messages". */
    label?: string;
};

/**
 * The product pin: the mark on a 32 grid, ink fill, 2px white ring, thread count inside.
 * Always ink, whatever the host page looks like (see BRAND.md, "The review layer").
 */
export function Pin({ count, size = 32, label, style, ...rest }: PinProps) {
    const name = label ?? (count === undefined ? 'Comment' : `Comment, ${count} ${count === 1 ? 'message' : 'messages'}`);
    // The outer span carries no `position`, so a consumer can place it with a class (e.g. `absolute`);
    // the inner span is the positioning context for the count.
    const outer: CSSProperties = { display: 'inline-block', width: size, height: size, lineHeight: 1, verticalAlign: 'middle', ...style };
    const inner: CSSProperties = { position: 'relative', display: 'block', width: size, height: size };
    return (
        <span role="img" aria-label={name} style={outer} {...rest}>
            <span style={inner}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox={PIN_VIEWBOX} width={size} height={size} aria-hidden="true" style={{ display: 'block' }}>
                    <path d={PIN_PATH} fill="#0A0A0A" stroke="#FFFFFF" strokeWidth="2" />
                </svg>
                {count !== undefined && (
                    <span
                        aria-hidden="true"
                        style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#FFFFFF',
                            fontSize: Math.round(size * 0.375),
                            fontWeight: 600,
                            fontVariantNumeric: 'tabular-nums'
                        }}>
                        {count}
                    </span>
                )}
            </span>
        </span>
    );
}
