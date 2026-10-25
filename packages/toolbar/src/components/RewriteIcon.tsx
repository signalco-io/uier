import { SVGAttributes } from 'react';

// "Rewrite": lines of text with a pencil writing the last one. Drawn like the UI kit's Lucide icons
// (24 grid, 1.75 stroke, round caps) in the current text colour.
export function RewriteIcon({ size, ...rest }: SVGAttributes<SVGElement> & { size?: number | undefined }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size ?? 24}
            height={size ?? 24}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            {...rest}
        >
            <path d="M4 5h16M4 10h9M4 19h5" />
            <path d="M17.6 10.9a1.9 1.9 0 0 1 2.7 2.7l-5.9 5.9-3.4.9.9-3.4z" />
            <path d="m16.5 12 2.7 2.7" />
        </svg>
    );
}
