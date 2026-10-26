import { Row } from '@signalco/ui-primitives/Row';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Typography } from '@signalco/ui-primitives/Typography';
import { cx } from '@signalco/ui-primitives/cx';
import { PanelRightClose } from '@signalco/ui-icons';
import { CommentsStatusFilter } from './CommentsFilter';
import { PanelHandle } from '../DockablePanel';

/** The inbox's title row: the handle that moves it, its name and Close */
export function CommentsSidebarHeader({ onClose }: { onClose: () => void }) {
    return (
        <Row justifyContent="space-between">
            <Row spacing={0.5} className="min-w-0">
                <PanelHandle />
                <Typography component="h2" level="body1" semiBold className="text-foreground">Comments</Typography>
            </Row>
            <IconButton onClick={onClose} variant="plain" title="Close sidebar" aria-label="Close sidebar" autoFocus>
                <PanelRightClose />
            </IconButton>
        </Row>
    );
}

const statuses = [
    { value: 'unresolved', label: 'Open' },
    { value: 'resolved', label: 'Done' },
    { value: 'all', label: 'All' }
] as const;

/** Open, Done and All, with their counts for the chosen pages: underlined tabs right above the list */
export function CommentsStatusTabs({ status, counts, onStatusChange }: {
    status: CommentsStatusFilter;
    counts: Record<CommentsStatusFilter, number>;
    onStatusChange: (status: CommentsStatusFilter) => void;
}) {
    return (
        <Row role="group" aria-label="Show comments" spacing={2} className="border-b">
            {statuses.map((s) => (
                <Button key={s.value} size="sm" variant="plain" aria-pressed={status === s.value}
                    className={cx('-mb-px gap-1.5 rounded-none border-b-2 px-0.5 hover:bg-transparent active:bg-transparent pointer-coarse:h-11 pointer-coarse:min-w-11',
                        status === s.value ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
                    onClick={() => onStatusChange(s.value)}>
                    {s.label} <span className="font-normal tabular-nums text-muted-foreground">{counts[s.value]}</span>
                </Button>
            ))}
        </Row>
    );
}

/** A filter that is on or off, as a small rounded toggle next to the page picker */
export function FilterChip({ pressed, onClick, className, children }: {
    pressed: boolean;
    onClick: () => void;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            aria-pressed={pressed}
            onClick={onClick}
            className={cx(
                'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                pressed ? 'border-foreground/40 bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                className
            )}>
            {children}
        </button>
    );
}
