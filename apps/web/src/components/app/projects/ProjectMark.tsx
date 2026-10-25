import { cn } from '@/src/lib/utils';

/** A project's tile: the first letter of its name (uier has no site favicons, by design: no third-party requests) */
export function ProjectMark({ name, className }: { name: string; className?: string }) {
    return (
        <span
            aria-hidden="true"
            className={cn('flex size-4 shrink-0 items-center justify-center rounded-[4px] border bg-background text-[10px] leading-none font-semibold text-foreground uppercase', className)}>
            {name.trim()[0] ?? '?'}
        </span>
    );
}
