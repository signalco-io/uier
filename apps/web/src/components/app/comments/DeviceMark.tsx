import { browserKind, browserMarks, osKind, osMarks, type DeviceMark as Mark } from '@uier/toolbar/devices';
import { cn } from '@/src/lib/utils';

function MarkSvg({ mark, className, ...data }: { mark: Mark; className?: string } & Record<`data-${string}`, string>) {
    return (
        <svg aria-hidden="true" viewBox={mark.viewBox} focusable="false" className={cn('size-4 shrink-0', className)} {...data}
            fill={mark.stroke ? 'none' : 'currentColor'}
            {...(mark.stroke ? { stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const } : {})}>
            {mark.paths.map(d => <path key={d} d={d} />)}
        </svg>
    );
}

/**
 * The mark of the browser a comment was left from ("Microsoft Edge (156)"), one colour in the text
 * colour like `AgentMark`, a globe when unknown. Decorative: the browser's name is always written beside it.
 */
export function BrowserMark({ name, className }: { name?: string; className?: string }) {
    const kind = browserKind(name);
    return <MarkSvg mark={browserMarks[kind]} className={className} data-browser-mark={kind} />;
}

/** The mark of the operating system a comment was left from ("macOS"), a window when unknown. Decorative, like `BrowserMark`. */
export function OsMark({ name, className }: { name?: string; className?: string }) {
    const kind = osKind(name);
    return <MarkSvg mark={osMarks[kind]} className={className} data-os-mark={kind} />;
}
