export { Shield as ConsentIcon } from '@signalco/ui-icons';
import type { SVGAttributes } from 'react';

type IconProps = SVGAttributes<SVGElement> & { size?: number | undefined };

// Drawn like the UI kit's Lucide icons (24 grid, 1.75 stroke, round caps) in the current text
// colour: the kit has no accessibility, page-scan, octagon-alert, circle-alert, list-ordered or focus icon.
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

/** A critical accessibility issue: Lucide's octagon-alert (the kit has none) */
export function OctagonAlertIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M12 16h.01" />
            <path d="M12 8v4" />
            <path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z" />
        </Icon>
    );
}

/** A moderate accessibility issue: Lucide's circle-alert (the kit has none) */
export function CircleAlertIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
        </Icon>
    );
}

/** The tab order: Lucide's list-ordered (the kit has none) */
export function TabOrderIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M10 12h11" />
            <path d="M10 18h11" />
            <path d="M10 6h11" />
            <path d="M4 10h2" />
            <path d="M4 6h1v4" />
            <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
        </Icon>
    );
}

/** Focus indicators: Lucide's focus, a point in its corners (the kit has none) */
export function FocusIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <circle cx="12" cy="12" r="3" />
            <path d="M3 7V5a2 2 0 0 1 2-2h2" />
            <path d="M17 3h2a2 2 0 0 1 2 2v2" />
            <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
            <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
        </Icon>
    );
}

/** Page checks (the pill's button for Accessibility, SEO and Security and compliance): a page with a check mark */
export function PageChecksIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
            <path d="M14 3v5h5" />
            <path d="m9 14.5 2 2 4-4" />
        </Icon>
    );
}
