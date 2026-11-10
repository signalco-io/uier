import { Fragment, useContext, useRef, useState } from 'react';
import { IconTooltip, useIconTooltip } from '../IconTooltip';
import { useProjectViewer } from '../../project/ProjectGate';
import { Row } from '@signalco/ui-primitives/Row';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Typography } from '@signalco/ui-primitives/Typography';
import { cx } from '@signalco/ui-primitives/cx';
import { ExpandDown, PanelRightClose } from '@signalco/ui-icons';
import { Popper } from '@signalco/ui-primitives/Popper';
import { Stack } from '@signalco/ui-primitives/Stack';
import { activeStatusFilters, isActiveStatusFilter, type CommentsStatusFilter } from './CommentsFilter';
import { CommentsBootstrapperContext } from '../CommentsBootstrapperContext';
import { StatusDot } from '../CommentThreadHeader';
import { floatingShadowClassName } from '../@types/Comments';
import { toolbarSurface } from '../../toolbarReview';
import { PanelHandle } from '../DockablePanel';
import { moveFocusInMenu, useRovingFocus } from '../../focusKeys';

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

const statusLabels: Record<CommentsStatusFilter, string> = {
    unresolved: 'Active',
    open: 'Open',
    'in-progress': 'In progress',
    ready: 'Ready to verify',
    resolved: 'Done',
    all: 'All'
};

const tabClassName = 'gap-1.5 rounded-none border-b-2 px-0.5 hover:bg-transparent active:bg-transparent pointer-coarse:h-11 pointer-coarse:min-w-11';
const tabStateClassName = (pressed: boolean) => pressed ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground';

/**
 * Active, Done and All, with their counts for the chosen pages, as the app's status tabs: underlined tabs right above
 * the list, one tab stop. Active (the default) is every status but Done; the Active statuses menu beside it picks one
 * of the statuses folded under it (Open, In progress, Ready to verify), which the Active tab then names ("Active: In
 * progress 4"); pressing that tab goes back to every active status. The menu button keeps its own tab stop: the arrow
 * keys move between the tabs only.
 */
export function CommentsStatusTabs({ status, counts, onStatusChange }: {
    status: CommentsStatusFilter;
    counts: Record<CommentsStatusFilter, number>;
    onStatusChange: (status: CommentsStatusFilter) => void;
}) {
    // One tab stop, like tabs: the chosen one; ← and → move between them, Enter or Space chooses
    const ref = useRef<HTMLDivElement>(null);
    const roving = useRovingFocus(ref, { orientation: 'horizontal', preferred: () => ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]') });
    const activeShown = isActiveStatusFilter(status);
    const activeValue = activeShown ? status : 'unresolved';
    const activeLabel = activeValue === 'unresolved' ? statusLabels.unresolved : `${statusLabels.unresolved}: ${statusLabels[activeValue]}`;
    return (
        <Row ref={ref} role="group" aria-label="Show comments" spacing={2} className="flex-wrap border-b" onFocus={roving.onFocus} onKeyDown={roving.onKeyDown}>
            <Row className="-mb-px">
                <Button size="sm" variant="plain" aria-pressed={activeShown}
                    className={cx(tabClassName, tabStateClassName(activeShown))}
                    // Pressed again while it shows one of its statuses: back to every active status
                    onClick={() => onStatusChange('unresolved')}>
                    {activeLabel} <span className="font-normal tabular-nums text-muted-foreground">{counts[activeValue]}</span>
                </Button>
                <ActiveStatusesMenu status={status} counts={counts} onStatusChange={onStatusChange} />
            </Row>
            {(['resolved', 'all'] as const).map(value => (
                <Button key={value} size="sm" variant="plain" aria-pressed={status === value}
                    className={cx('-mb-px', tabClassName, tabStateClassName(status === value))}
                    onClick={() => onStatusChange(value)}>
                    {statusLabels[value]} <span className="font-normal tabular-nums text-muted-foreground">{counts[value]}</span>
                </Button>
            ))}
        </Row>
    );
}

/** The chevron beside the Active tab: a menu of Active and the statuses folded under it, each with its count; a choice closes it */
function ActiveStatusesMenu({ status, counts, onStatusChange }: {
    status: CommentsStatusFilter;
    counts: Record<CommentsStatusFilter, number>;
    onStatusChange: (status: CommentsStatusFilter) => void;
}) {
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const [open, setOpen] = useState(false);
    const currentRef = useRef<HTMLButtonElement>(null);
    const firstRef = useRef<HTMLButtonElement>(null);
    const { triggerProps, tooltip } = useIconTooltip('Active statuses');
    const choose = (value: CommentsStatusFilter) => {
        setOpen(false);
        onStatusChange(value);
    };
    return <>
        <Popper
            container={rootElement}
            open={open}
            onOpenChange={setOpen}
            align="start"
            aria-label="Active statuses"
            // Like a menu: ↑ and ↓ move between its choices. Escape closes only the menu, not the inbox
            onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); else moveFocusInMenu(event); }}
            {...toolbarSurface('uier-status-filter-menu', cx('z-[70] w-52 max-w-[calc(100vw-1rem)] rounded-xl p-1', floatingShadowClassName))}
            {...{
                onOpenAutoFocus: (event: Event) => {
                    event.preventDefault();
                    (currentRef.current ?? firstRef.current)?.focus();
                }
            }}
            trigger={(
                <IconButton size="sm" variant="plain" aria-label="Active statuses" data-roving-skip="" {...triggerProps}
                    className={cx('h-8 w-5 min-w-5 rounded-none border-b-2 border-transparent px-0 text-muted-foreground hover:bg-transparent hover:text-foreground active:bg-transparent pointer-coarse:h-11 pointer-coarse:min-w-8',
                        open && 'text-foreground')}>
                    <ExpandDown aria-hidden="true" size={14} />
                </IconButton>
            )}>
            <Stack role="group" aria-label="Active statuses">
                {(['unresolved', ...activeStatusFilters] as const).map((value, index) => {
                    const current = value === status;
                    return (
                        <Fragment key={value}>
                            {index === 1 && <div role="separator" className="my-1 h-px bg-border" />}
                            <Button ref={current ? currentRef : index === 0 ? firstRef : undefined} variant="plain" size="sm" fullWidth
                                className="justify-start pointer-coarse:min-h-11" aria-pressed={current}
                                startDecorator={value === 'unresolved' ? undefined : <StatusDot stage={value} />}
                                endDecorator={<span className="ml-auto font-normal tabular-nums text-muted-foreground">{counts[value]}</span>}
                                onClick={() => choose(value)}>
                                {statusLabels[value]}
                            </Button>
                        </Fragment>
                    );
                })}
            </Stack>
        </Popper>
        {tooltip}
    </>;
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
