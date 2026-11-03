import type { CSSProperties, HTMLAttributes } from 'react';
import { PIN_PATH, PIN_VIEWBOX } from './brand';

export type PinProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
    /** The thread's public number (`#12`, the same one the inbox and the app show), inside the pin. */
    number?: number;
    /** Messages in the thread: from two on, a small count badge on the pin's top-right corner. */
    messages?: number;
    /** Rendered width and height in px. */
    size?: number;
    /** Accessible name; defaults to `pinLabel` ("Comment #12, 3 messages"). */
    label?: string;
};

/** The pin's accessible name: "Comment #12, 3 messages", "Comment, 1 message" without a number. */
export function pinLabel({ number, messages, done }: { number?: number; messages?: number; done?: boolean }) {
    const parts = [number === undefined ? 'Comment' : `Comment #${number}`];
    if (messages !== undefined) parts.push(`${messages} ${messages === 1 ? 'message' : 'messages'}`);
    if (done) parts.push('done');
    return parts.join(', ');
}

/** The number's size for its digits: 12 px at 32 up to two digits, smaller so five digits still fit. */
function numberFontSize(number: number, size: number) {
    const digits = String(number).length;
    const scale = digits <= 2 ? 0.375 : digits === 3 ? 0.34 : digits === 4 ? 0.28 : 0.22;
    return Math.round(size * scale);
}

/**
 * The product pin: the mark on a 32 grid, ink fill, 2px white ring, the thread's number inside and
 * its message count as a white badge. Always ink, whatever the host page looks like (see BRAND.md,
 * "The review layer").
 */
export function Pin({ number, messages, size = 32, label, style, ...rest }: PinProps) {
    const name = label ?? pinLabel({ number, messages });
    // The outer span carries no `position`, so a consumer can place it with a class (e.g. `absolute`);
    // the inner span is the positioning context for the number and the badge.
    const outer: CSSProperties = { display: 'inline-block', width: size, height: size, lineHeight: 1, verticalAlign: 'middle', ...style };
    const inner: CSSProperties = { position: 'relative', display: 'block', width: size, height: size };
    // Inverted (white, ink text and outline) and off the pin's corner, so it never reads as the number
    const badge = Math.round(size * 0.4375);
    const overhang = Math.round(size * 0.15);
    return (
        <span role="img" aria-label={name} style={outer} {...rest}>
            <span style={inner}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox={PIN_VIEWBOX} width={size} height={size} aria-hidden="true" style={{ display: 'block' }}>
                    <path d={PIN_PATH} fill="#0A0A0A" stroke="#FFFFFF" strokeWidth="2" />
                </svg>
                {number !== undefined && (
                    <span
                        aria-hidden="true"
                        style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#FFFFFF',
                            fontSize: numberFontSize(number, size),
                            fontWeight: 600,
                            fontVariantNumeric: 'tabular-nums',
                            letterSpacing: '-0.02em'
                        }}>
                        {number}
                    </span>
                )}
                {/* Keeps the visible text "6 3", not "63": it stays part of the name "Comment #6, 3 messages" */}
                {number !== undefined && messages !== undefined && messages > 1 && ' '}
                {messages !== undefined && messages > 1 && (
                    <span
                        aria-hidden="true"
                        style={{
                            position: 'absolute',
                            top: -overhang,
                            right: -overhang,
                            boxSizing: 'border-box',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            minWidth: badge,
                            height: badge,
                            padding: '0 3px',
                            borderRadius: 9999,
                            border: '1px solid #0A0A0A',
                            background: '#FFFFFF',
                            color: '#0A0A0A',
                            fontSize: Math.round(size * 0.28),
                            fontWeight: 600,
                            fontVariantNumeric: 'tabular-nums'
                        }}>
                        {messages}
                    </span>
                )}
            </span>
        </span>
    );
}
