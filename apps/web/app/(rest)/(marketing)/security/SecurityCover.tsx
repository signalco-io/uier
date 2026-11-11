import { MARK_PATH } from '@uier/brand';
import type { CSSProperties } from 'react';

/** A shield with rounded shoulders on a 200 × 240 grid, centred on (100, 120) */
const SHIELD_PATH = 'M100 10C128 24 156 32 178 34Q186 35 186 43V112C186 168 150 208 100 230C50 208 14 168 14 112V43Q14 35 22 34C44 32 72 24 100 10Z';

/** Outlines around the shield, fading outwards */
const echoes = [
    { scale: 1.3, opacity: 0.35 },
    { scale: 1.65, opacity: 0.2 },
    { scale: 2.05, opacity: 0.1 }
];

/** The mark at 60 units, in the middle of the shield */
const MARK_SIZE = 60;

/** A dot grid that fades out towards the edges */
const pattern: CSSProperties = {
    backgroundImage: 'radial-gradient(hsl(var(--muted-foreground) / 0.35) 1px, transparent 1.5px)',
    backgroundSize: '20px 20px',
    backgroundPosition: 'center',
    maskImage: 'radial-gradient(ellipse at center, black 20%, transparent 72%)'
};

/**
 * The security page's cover: the uier mark inside a large shield, over a dot grid. Static and
 * decorative (hidden from assistive technology), drawn only from the brand tokens, so it follows
 * the theme. Its height is fixed per breakpoint, so it never shifts the page.
 */
export function SecurityCover() {
    return (
        <div
            aria-hidden
            className="relative flex h-56 w-full items-center justify-center overflow-hidden rounded-3xl border bg-card sm:h-64 lg:mt-12 lg:h-72">
            <div className="absolute inset-0" style={pattern} />
            <svg
                viewBox="0 0 200 240"
                focusable="false"
                className="relative h-[72%] w-auto overflow-visible"
                fill="none">
                {echoes.map(({ scale, opacity }) => (
                    <path
                        key={scale}
                        d={SHIELD_PATH}
                        transform={`translate(100 120) scale(${scale}) translate(-100 -120)`}
                        vectorEffect="non-scaling-stroke"
                        strokeWidth={1}
                        className="stroke-foreground"
                        style={{ strokeOpacity: opacity }} />
                ))}
                <path d={SHIELD_PATH} strokeWidth={3} strokeLinejoin="round" className="fill-card stroke-foreground" />
                <path
                    d={SHIELD_PATH}
                    transform="translate(100 120) scale(0.84) translate(-100 -120)"
                    vectorEffect="non-scaling-stroke"
                    strokeWidth={1}
                    className="stroke-border" />
                <path
                    d={MARK_PATH}
                    transform={`translate(${100 - MARK_SIZE / 2} ${116 - MARK_SIZE / 2}) scale(${MARK_SIZE / 24})`}
                    className="fill-foreground" />
            </svg>
        </div>
    );
}
