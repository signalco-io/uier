import type { SVGAttributes } from 'react';

type IconProps = SVGAttributes<SVGElement> & { size?: number | undefined };

// Drawn like the UI kit's Lucide icons (24 grid, 1.75 stroke, round caps) in the current text
// colour: the kit has no accessibility or page-scan icon.
function Icon({ size, children, ...rest }: IconProps) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={size ?? 24} height={size ?? 24} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...rest}>
            {children}
        </svg>
    );
}

/** Accessibility: the standing figure with open arms */
export function AccessibilityIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <circle cx="12" cy="4.5" r="1.5" />
            <path d="M5 8.5 12 10l7-1.5" />
            <path d="M12 10v4.5" />
            <path d="m8.5 20.5 3.5-6 3.5 6" />
        </Icon>
    );
}

/** SEO: a page scanned by a search, its corners and a magnifier */
export function SeoIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M3 7V5a2 2 0 0 1 2-2h2" />
            <path d="M17 3h2a2 2 0 0 1 2 2v2" />
            <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
            <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
            <circle cx="11.5" cy="11.5" r="3.5" />
            <path d="m16.5 16.5-2.5-2.5" />
        </Icon>
    );
}
