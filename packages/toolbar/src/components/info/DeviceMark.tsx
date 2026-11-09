import { cx } from '@signalco/ui-primitives/cx';
import { browserKind, browserMarks, osKind, osMarks, type DeviceMark as Mark } from '../../devices';

function MarkSvg({ mark, size, className, ...data }: { mark: Mark; size: number; className?: string } & Record<`data-${string}`, string>) {
    return (
        <svg aria-hidden="true" viewBox={mark.viewBox} width={size} height={size} focusable="false" className={cx('shrink-0', className)} {...data}
            fill={mark.stroke ? 'none' : 'currentColor'}
            {...(mark.stroke ? { stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const } : {})}>
            {mark.paths.map(d => <path key={d} d={d} />)}
        </svg>
    );
}

/** The browser's mark (`devices.ts`), one colour in the text colour, a globe when unknown. Decorative: the name is written beside it. */
export function BrowserMark({ name, size = 16, className }: { name?: string; size?: number; className?: string }) {
    const kind = browserKind(name);
    return <MarkSvg mark={browserMarks[kind]} size={size} className={className} data-browser-mark={kind} />;
}

/** The operating system's mark (`devices.ts`), a window when unknown. Decorative, like `BrowserMark`. */
export function OsMark({ name, size = 16, className }: { name?: string; size?: number; className?: string }) {
    const kind = osKind(name);
    return <MarkSvg mark={osMarks[kind]} size={size} className={className} data-os-mark={kind} />;
}
