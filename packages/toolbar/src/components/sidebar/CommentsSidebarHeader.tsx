import { Fragment, useContext, useId, useRef, useState } from 'react';
import { IconTooltip, useIconTooltip } from '../IconTooltip';
import { Row } from '@signalco/ui-primitives/Row';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Typography } from '@signalco/ui-primitives/Typography';
import { cx } from '@signalco/ui-primitives/cx';
import { ExpandDown, PanelRightClose } from '@signalco/ui-icons';
import { Popper } from '@signalco/ui-primitives/Popper';
import { Stack } from '@signalco/ui-primitives/Stack';
import { useProjectViewer } from '../../project/ProjectGate';
import { activeStatusFilters, doneStatusFilters, isActiveStatusFilter, isDoneStatusFilter, type CommentsStatusFilter } from './CommentsFilter';
import { CommentsBootstrapperContext } from '../CommentsBootstrapperContext';
import { StatusDot } from '../CommentThreadHeader';
import { floatingShadowClassName } from '../@types/Comments';
import { toolbarSurface } from '../../toolbarReview';
import { PanelHandle } from '../DockablePanel';
import { PanelTitle } from '../PanelTitle';
import { moveFocusInMenu, useRovingFocus } from '../../focusKeys';
import { useMessages } from '../../i18n';

/**
 * The inbox's title row: the handle that moves it, its name (a menu of the other panels, `PanelTitle`), the search (`InboxSearch`, its popover under this row) and
 * Close (with the focus when it opens, unless `autoFocus` is false)
 */
export function CommentsSidebarHeader({ onClose, autoFocus = true, search }: { onClose: () => void; autoFocus?: boolean; search?: React.ReactNode }) {
    const { brief } = useProjectViewer();
    const t = useMessages();
    const [briefOpen, setBriefOpen] = useState(false);
    return (
        <div className="relative">
            <Row justifyContent="space-between">
                <Row spacing={0.5} className="min-w-0">
                    <PanelHandle />
                    <PanelTitle id="inbox" title={t.inbox.label} />
                </Row>
                <Row>
                    {search}
                    {brief && <Button size="sm" variant="plain" aria-expanded={briefOpen} onClick={() => setBriefOpen(!briefOpen)}>{t.inbox.reviewBrief}</Button>}
                    <IconTooltip label={t.inbox.close}>
                        <IconButton onClick={onClose} variant="plain" size="sm" aria-label={t.inbox.close} autoFocus={autoFocus} data-uier-close-inbox="" data-uier-panel-close="">
                            <PanelRightClose size={16} aria-hidden="true" />
                        </IconButton>
                    </IconTooltip>
                </Row>
            </Row>
            {brief && briefOpen && <section aria-label={t.inbox.reviewBrief} className="mt-3 whitespace-pre-wrap break-words text-sm text-foreground">{brief}</section>}
        </div>
    );
}

/**
 * A status tab's or menu item's unread dot (uier #346): shown whenever its listed comments include unread ones, chosen or
 * not, like a thread's (the brand accent). Assistive tech hears "Unread" as the tab's description (`aria-describedby`),
 * so its name stays its label and count.
 */
function TabUnread({ unread }: { unread?: boolean }) {
    if (!unread) return null;
    return <span aria-hidden="true" data-uier-tab-unread="" className="size-1.5 shrink-0 rounded-full bg-[hsl(var(--brand-accent))]" />;
}

const tabClassName = 'gap-1.5 rounded-none border-b-2 px-0.5 hover:bg-transparent active:bg-transparent pointer-coarse:h-11 pointer-coarse:min-w-11';
const tabStateClassName = (pressed: boolean) => pressed ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground';

/**
 * Active, Done and All, with their counts for the chosen pages, as the app's status tabs: underlined tabs right above
 * the list, one tab stop. Active (the default) is every status but Done; the Active statuses menu beside it picks one
 * of the statuses folded under it (Open, In progress, Ready to verify), which the Active tab then names ("Active: In
 * progress 4"); pressing that tab goes back to every active status. Done holds Archive the same way (uier #302): its
 * menu picks Done or Archive, the tab then reads "Archive 2", and pressing it goes back to Done. The menu buttons keep
 * their own tab stops: the arrow keys move between the tabs only. A tab whose listed comments include unread ones has
 * the unread dot after its count, chosen or not (`unread`, uier #346), and so do the menus' items.
 */
export function CommentsStatusTabs({ status, counts, unread = {}, onStatusChange }: {
    status: CommentsStatusFilter;
    counts: Record<CommentsStatusFilter, number>;
    unread?: Partial<Record<CommentsStatusFilter, boolean>>;
    onStatusChange: (status: CommentsStatusFilter) => void;
}) {
    const t = useMessages();
    const statusLabels: Record<CommentsStatusFilter, string> = t.inbox.filters;
    // One tab stop, like tabs: the chosen one; ← and → move between them, Enter or Space chooses
    const ref = useRef<HTMLDivElement>(null);
    const roving = useRovingFocus(ref, { orientation: 'horizontal', preferred: () => ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]') });
    const verificationEnabled = useProjectViewer().verificationEnabled === true;
    const activeShown = isActiveStatusFilter(status);
    const activeValue = activeShown ? status : 'unresolved';
    const activeLabel = activeValue === 'unresolved' ? statusLabels.unresolved : t.inbox.activeOne(statusLabels[activeValue]);
    const doneShown = isDoneStatusFilter(status);
    const doneValue = doneShown ? status : 'resolved';
    // What a tab with the unread dot is described by
    const unreadId = useId();
    const described = (value: CommentsStatusFilter) => unread[value] ? unreadId : undefined;
    return (
        <Row ref={ref} role="group" aria-label={t.inbox.showComments} data-uier-status-tabs="" spacing={2} className="flex-wrap border-b" onFocus={roving.onFocus} onKeyDown={roving.onKeyDown}>
            <span id={unreadId} hidden>{t.inbox.hasUnread}</span>
            <Row className="-mb-px">
                <Button size="sm" variant="plain" aria-pressed={activeShown} aria-describedby={described(activeValue)}
                    className={cx(tabClassName, tabStateClassName(activeShown))}
                    // Pressed again while it shows one of its statuses: back to every active status
                    onClick={() => onStatusChange('unresolved')}>
                    {activeLabel} <span className="font-normal tabular-nums text-muted-foreground">{counts[activeValue]}</span><TabUnread unread={unread[activeValue]} />
                </Button>
                <StatusesMenu label={t.inbox.activeStatuses} values={['unresolved', ...activeStatusFilters.filter(value => verificationEnabled || value !== 'ready')]} status={status} counts={counts} unread={unread} unreadId={unreadId} onStatusChange={onStatusChange} />
            </Row>
            <Row className="-mb-px">
                <Button size="sm" variant="plain" aria-pressed={doneShown} aria-describedby={described(doneValue)}
                    className={cx(tabClassName, tabStateClassName(doneShown))}
                    // Pressed again while it shows Archive: back to Done
                    onClick={() => onStatusChange('resolved')}>
                    {statusLabels[doneValue]} <span className="font-normal tabular-nums text-muted-foreground">{counts[doneValue]}</span><TabUnread unread={unread[doneValue]} />
                </Button>
                <StatusesMenu label={t.inbox.doneStatuses} values={doneStatusFilters} status={status} counts={counts} unread={unread} unreadId={unreadId} onStatusChange={onStatusChange} />
            </Row>
            <Button size="sm" variant="plain" aria-pressed={status === 'all'} aria-describedby={described('all')}
                className={cx('-mb-px', tabClassName, tabStateClassName(status === 'all'))}
                onClick={() => onStatusChange('all')}>
                {statusLabels.all} <span className="font-normal tabular-nums text-muted-foreground">{counts.all}</span><TabUnread unread={unread.all} />
            </Button>
        </Row>
    );
}

/**
 * The chevron beside a tab: a menu of the tab's own filter, then the ones folded under it, each with its count (Active,
 * then Open, In progress and Ready to verify with their status dots; Done, then Archive); a choice closes it
 */
function StatusesMenu({ label, values, status, counts, unread, unreadId, onStatusChange }: {
    label: string;
    values: readonly CommentsStatusFilter[];
    status: CommentsStatusFilter;
    counts: Record<CommentsStatusFilter, number>;
    unread: Partial<Record<CommentsStatusFilter, boolean>>;
    /** The tabs' "Unread" description */
    unreadId: string;
    onStatusChange: (status: CommentsStatusFilter) => void;
}) {
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const t = useMessages();
    const statusLabels: Record<CommentsStatusFilter, string> = t.inbox.filters;
    const [open, setOpen] = useState(false);
    const currentRef = useRef<HTMLButtonElement>(null);
    const firstRef = useRef<HTMLButtonElement>(null);
    const { triggerProps, tooltip } = useIconTooltip(label);
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
            aria-label={label}
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
                <IconButton size="sm" variant="plain" aria-label={label} data-roving-skip="" {...triggerProps}
                    className={cx('h-8 w-6 min-w-6 rounded-none border-b-2 border-transparent px-0 text-muted-foreground hover:bg-transparent hover:text-foreground active:bg-transparent pointer-coarse:h-11 pointer-coarse:min-w-8',
                        open && 'text-foreground')}>
                    <ExpandDown aria-hidden="true" size={14} />
                </IconButton>
            )}>
            <Stack role="group" aria-label={label}>
                {values.map((value, index) => {
                    const current = value === status;
                    const stage = (activeStatusFilters as readonly CommentsStatusFilter[]).includes(value) ? value as typeof activeStatusFilters[number] : undefined;
                    return (
                        <Fragment key={value}>
                            {index === 1 && <div role="separator" className="my-1 h-px bg-border" />}
                            <Button ref={current ? currentRef : index === 0 ? firstRef : undefined} variant="plain" size="sm" fullWidth
                                className="justify-start pointer-coarse:min-h-11" aria-pressed={current} aria-describedby={unread[value] ? unreadId : undefined}
                                startDecorator={stage ? <StatusDot stage={stage} /> : undefined}
                                endDecorator={<span className="ml-auto flex items-center gap-1.5 font-normal tabular-nums text-muted-foreground">{counts[value]}
                                    {/* Its own room, so the counts line up whether or not an item has unread comments */}
                                    <span className="flex w-1.5 shrink-0 justify-center"><TabUnread unread={unread[value]} /></span></span>}
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
