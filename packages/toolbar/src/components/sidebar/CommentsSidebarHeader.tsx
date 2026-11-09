import { useRef, useState } from 'react';
import { IconTooltip } from '../IconTooltip';
import { useProjectViewer } from '../../project/ProjectGate';
import { Row } from '@signalco/ui-primitives/Row';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Typography } from '@signalco/ui-primitives/Typography';
import { cx } from '@signalco/ui-primitives/cx';
import { PanelRightClose } from '@signalco/ui-icons';
import { CommentsStatusFilter } from './CommentsFilter';
import { PanelHandle } from '../DockablePanel';
import { useRovingFocus } from '../../focusKeys';

/** The inbox's title row: the handle that moves it, its name and Close (with the focus when it opens, unless `autoFocus` is false) */
export function CommentsSidebarHeader({ onClose, autoFocus = true }: { onClose: () => void; autoFocus?: boolean }) {
    const { brief } = useProjectViewer();
    const [briefOpen, setBriefOpen] = useState(false);
    return (
        <div>
            <Row justifyContent="space-between">
                <Row spacing={0.5} className="min-w-0">
                    <PanelHandle />
                    <Typography component="h2" level="body1" semiBold className="text-foreground">Comments</Typography>
                </Row>
                <Row>
                    {brief && <Button size="sm" variant="plain" aria-expanded={briefOpen} onClick={() => setBriefOpen(!briefOpen)}>Review brief</Button>}
                    <IconTooltip label="Close sidebar">
                        <IconButton onClick={onClose} variant="plain" aria-label="Close sidebar" autoFocus={autoFocus}>
                            <PanelRightClose />
                        </IconButton>
                    </IconTooltip>
                </Row>
            </Row>
            {brief && briefOpen && <section aria-label="Review brief" className="mt-3 whitespace-pre-wrap break-words text-sm text-foreground">{brief}</section>}
        </div>
    );
}

const statuses = [
    { value: 'unresolved', label: 'Open' },
    { value: 'in-progress', label: 'In progress' },
    { value: 'ready', label: 'Ready to verify' },
    { value: 'resolved', label: 'Done' },
    { value: 'all', label: 'All' }
] as const;

/** Open, In progress, Ready to verify, Done and All, with their counts for the chosen pages: underlined tabs right above the list, one tab stop */
export function CommentsStatusTabs({ status, counts, onStatusChange }: {
    status: CommentsStatusFilter;
    counts: Record<CommentsStatusFilter, number>;
    onStatusChange: (status: CommentsStatusFilter) => void;
}) {
    // One tab stop, like tabs: the chosen one; ← and → move between them, Enter or Space chooses
    const ref = useRef<HTMLDivElement>(null);
    const roving = useRovingFocus(ref, { orientation: 'horizontal', preferred: () => ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]') });
    return (
        <Row ref={ref} role="group" aria-label="Show comments" spacing={2} className="flex-wrap border-b" onFocus={roving.onFocus} onKeyDown={roving.onKeyDown}>
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

/** A filter that is on or off, an outlined toggle like the page picker beside it (and the app's Unread filter) */
export function FilterChip({ pressed, onClick, children }: {
    pressed: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <Button variant="outlined" aria-pressed={pressed} onClick={onClick}
            className={cx('shrink-0 rounded-md font-normal', pressed && 'bg-accent')}>
            {children}
        </Button>
    );
}
