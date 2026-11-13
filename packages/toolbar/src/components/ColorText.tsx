import { Fragment, type ReactNode } from 'react';
import { colorParts } from '../colorValues';

// The app's `ColorText` (apps/web/src/components/app/comments) renders the same markup: change both together.

/** As many characters of a value stay on the swatch's line; the rest wraps like any text */
const HEAD_LENGTH = 8;

/**
 * Text someone wrote, with a small swatch before each colour value in it (`colorValues.ts`): the colour itself
 * in a hairline border, so one close to the surface still shows (and it keeps its colour in forced colours).
 * The swatch is decoration: the value is read and copied as written.
 */
export function ColorText({ text }: { text: string }): ReactNode {
    const parts = colorParts(text);
    if (parts.length === 1 && !parts[0]!.color) return text;
    return parts.map((part, index) => part.color ? (
        <Fragment key={index}>
            <span className="whitespace-nowrap">
                <span aria-hidden="true" data-color-swatch="" style={{ backgroundColor: part.color }}
                    className="mr-1 inline-block size-3 rounded-[4px] border border-border align-[-1px] forced-color-adjust-none" />
                {part.text.slice(0, HEAD_LENGTH)}
            </span>
            {part.text.slice(HEAD_LENGTH)}
        </Fragment>
    ) : <Fragment key={index}>{part.text}</Fragment>);
}
