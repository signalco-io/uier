import { HTMLAttributes } from 'react';
import { PIN_PATH, PIN_VIEWBOX } from '@uier/brand';

// The pin: the brand mark on a 32 grid with a white ring (packages/brand/BRAND.md, "The review layer").
// The outlined variant is an icon (the toolbar's "Add comment"): it is drawn in the current text colour.
export function CommentIcon({ icon, size, variant, ...rest }: HTMLAttributes<SVGElement> & { icon?: 'add' | undefined, size?: number | undefined, variant?: 'outlined' }) {
    const outlined = variant === 'outlined';
    const strokeColor = outlined ? 'currentColor' : '#fff';
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size ?? 32}
            height={size ?? 32}
            fill="none"
            viewBox={PIN_VIEWBOX}
            {...rest}
        >
            <path
                fill={outlined ? undefined : '#0A0A0A'}
                stroke={strokeColor}
                strokeWidth={outlined ? 1.75 : 2}
                d={PIN_PATH}
            />
            {icon && (
                <path
                    stroke={strokeColor}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 16h14M16 9v14"
                />
            )}
        </svg>
    );
}
