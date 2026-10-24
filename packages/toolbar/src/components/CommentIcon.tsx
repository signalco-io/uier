import { HTMLAttributes } from 'react';
import { PIN_PATH, PIN_VIEWBOX } from '@uier/brand';

// The pin: the brand mark on a 32 grid with a white ring (packages/brand/BRAND.md, "The review layer").
export function CommentIcon({ icon, size, variant, ...rest }: HTMLAttributes<SVGElement> & { icon?: 'add' | undefined, size?: number | undefined, variant?: 'outlined' }) {
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
                fill={variant === 'outlined' ? undefined : '#0A0A0A'}
                stroke="#fff"
                strokeWidth={variant === 'outlined' ? 1.75 : 2}
                d={PIN_PATH}
            />
            {icon && (
                <path
                    stroke="#fff"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 16h14M16 9v14"
                />
            )}
        </svg>
    );
}
