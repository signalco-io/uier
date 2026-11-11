import type { SVGAttributes } from 'react';

type IconProps = SVGAttributes<SVGElement> & { size?: number | undefined };

// Drawn like the UI kit's Lucide icons (24 grid, 1.75 stroke, round caps) in the current text colour: the kit
// has only a few of the drawing tools, and one set keeps the panel's strokes even. The paths are Lucide's
// (ISC licence), except the line.
function Icon({ size, children, ...rest }: IconProps) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={size ?? 20} height={size ?? 20} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
            {children}
        </svg>
    );
}

/** Draw on the page (the pill): Lucide's pen-line */
export function DrawIcon(props: IconProps) {
    return <Icon {...props}><path d="M12 20h9" /><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" /></Icon>;
}

/** Select: Lucide's mouse-pointer-2 */
export function SelectIcon(props: IconProps) {
    return <Icon {...props}><path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" /></Icon>;
}

/** Pen: Lucide's pen */
export function PenIcon(props: IconProps) {
    return <Icon {...props}><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /></Icon>;
}

/** Marker: Lucide's highlighter */
export function MarkerIcon(props: IconProps) {
    return <Icon {...props}><path d="m9 11-6 6v3h9l3-3" /><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" /></Icon>;
}

/** Brush: Lucide's brush */
export function BrushIcon(props: IconProps) {
    return <Icon {...props}><path d="m11 10 3 3" /><path d="M6.5 21A3.5 3.5 0 1 0 3 17.5a2.62 2.62 0 0 1-.708 1.792A1 1 0 0 0 3 21z" /><path d="M9.969 17.031 21.378 5.624a1 1 0 0 0-3.002-3.002L6.967 14.031" /></Icon>;
}

/** Line: a plain diagonal */
export function LineIcon(props: IconProps) {
    return <Icon {...props}><path d="M5 19 19 5" /></Icon>;
}

/** Arrow: Lucide's move-up-right */
export function ArrowIcon(props: IconProps) {
    return <Icon {...props}><path d="M13 5h6v6" /><path d="M19 5 5 19" /></Icon>;
}

/** Rectangle: Lucide's square */
export function RectangleIcon(props: IconProps) {
    return <Icon {...props}><rect width="18" height="18" x="3" y="3" rx="2" /></Icon>;
}

/** Ellipse: Lucide's circle */
export function EllipseIcon(props: IconProps) {
    return <Icon {...props}><circle cx="12" cy="12" r="9" /></Icon>;
}

/** Diamond: Lucide's diamond */
export function DiamondIcon(props: IconProps) {
    return <Icon {...props}><path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z" /></Icon>;
}

/** Text note: Lucide's type */
export function TextIcon(props: IconProps) {
    return <Icon {...props}><path d="M12 4v16" /><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" /><path d="M9 20h6" /></Icon>;
}

/** Blur: Lucide's eye-off */
export function BlurIcon(props: IconProps) {
    return <Icon {...props}><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" /><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" /><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" /><path d="m2 2 20 20" /></Icon>;
}

/** Eraser: Lucide's eraser */
export function EraserIcon(props: IconProps) {
    return <Icon {...props}><path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21" /><path d="m5.082 11.09 8.828 8.828" /></Icon>;
}

/** Style: Lucide's palette */
export function StyleIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" />
            <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
            <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
            <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
            <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
        </Icon>
    );
}
