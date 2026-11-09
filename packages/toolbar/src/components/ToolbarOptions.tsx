'use client';

import { Fragment, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { useIconTooltip } from './IconTooltip';
import { Popper } from '@signalco/ui-primitives/Popper';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Row } from '@signalco/ui-primitives/Row';
import { Divider } from '@signalco/ui-primitives/Divider';
import { cx } from '@signalco/ui-primitives/cx';
import { ArrowLeft, Close, ExternalLink, LayoutList, LogOut, MoreHorizontal, Reset } from '@signalco/ui-icons';
import { BRAND_URL, Mark } from '@uier/brand';
import { useDrafts } from '../hooks/useDrafts';
import { useVisitor } from '../hooks/useVisitor';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { useInkContainer } from './InkScope';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { useAnnounce } from './Announcer';
import { floatingShadowClassName } from './@types/Comments';
import { toolbarConfig } from '../config';
import { setShortcutsEnabled, toolbarShortcuts, useKeyboardLikely, useShortcutsEnabled } from '../shortcuts';
import { moveFocusInMenu } from '../focusKeys';
import { toolbarSurface } from '../toolbarReview';

type ToolbarOptionsProps = {
    /** The reviewed project in the uier app (a review of a project's site, or a link with a project code) */
    projectUrl?: string;
    onResetPosition?: () => void;
    /** Ends the review (`review` mode) or closes the toolbar (`feedback` mode) */
    onExitReview?: () => void;
    /** `?` was pressed: the options open on the keyboard shortcuts */
    shortcutsRequested?: boolean;
    onShortcutsRequestHandled?: () => void;
};

/** The keyboard shortcuts, by what they do (`toolbarShortcuts`); the single keys are marked off while they are */
function ShortcutList({ enabled }: { enabled: boolean }) {
    return (
        <dl className="m-0 flex flex-col gap-1 px-2 text-sm text-foreground">
            {toolbarShortcuts.map(shortcut => (
                <div key={shortcut.label} className="flex min-h-6 items-center justify-between gap-4">
                    <dt className={cx(shortcut.letter && !enabled && 'text-muted-foreground')}>
                        {shortcut.label}
                        {shortcut.letter && !enabled && <span className="sr-only"> (off)</span>}
                    </dt>
                    <dd className="m-0 flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        {shortcut.keys.map((key, index) => (
                            <Fragment key={index}>
                                {index > 0 && shortcut.join && <span>{shortcut.join}</span>}
                                {/* Mono means machine (BRAND.md) */}
                                <kbd className="min-w-5 rounded-sm border px-1 text-center font-mono text-foreground">
                                    {typeof key === 'string' ? key : <><span aria-hidden="true">{key.print}</span><span className="sr-only">{key.name}</span></>}
                                </kbd>
                            </Fragment>
                        ))}
                    </dd>
                </div>
            ))}
        </dl>
    );
}

/**
 * One row of the options: its 16 px icon first, so every row's icon (and the mark in
 * "Powered by uier") lines up in one column, 8 px from its label.
 */
function OptionButton({ icon, className, ...props }: ComponentProps<typeof Button> & { icon: ReactNode }) {
    return (
        <Button
            {...props}
            variant="plain"
            size="sm"
            fullWidth
            className={cx('justify-start gap-2', className)}
            startDecorator={<span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">{icon}</span>} />
    );
}

/**
 * A row that turns something on or off: one fixed label and a switch at its end with the current state
 * (`role="switch"`, so it is announced as on or off; Enter and Space toggle it). The menu stays open, so
 * the new state shows in place.
 */
function OptionSwitch({ checked, onClick, children }: { checked: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <OptionButton
            // No icon of its own: the switch shows the state, the label stays in the icons' column
            icon={null}
            onClick={onClick}
            role="switch"
            aria-checked={checked}
            endDecorator={(
                <span
                    aria-hidden="true"
                    className={cx(
                        'ml-auto flex h-4 w-7 shrink-0 items-center rounded-full border p-px',
                        checked ? 'border-primary bg-primary' : 'border-muted-foreground bg-transparent')}>
                    <span className={cx(
                        'size-3 rounded-full motion-safe:transition-transform',
                        checked ? 'translate-x-3 bg-primary-foreground' : 'bg-muted-foreground')} />
                </span>
            )}>
            <span className="mr-3">{children}</span>
        </OptionButton>
    );
}

/**
 * The toolbar's options: the switches (single-key shortcuts on or off) in their own group, then the actions
 * (the keyboard shortcuts' list, also on `?`, view the project, exit the review, sign out; only the ones that
 * apply), and always a link to uier.io, since the toolbar shows on other people's sites. ↑ and ↓ move
 * between its buttons.
 */
export function ToolbarOptions({ projectUrl, onExitReview, onResetPosition, shortcutsRequested = false, onShortcutsRequestHandled }: ToolbarOptionsProps) {
    const { rootElement, mode } = useContext(CommentsBootstrapperContext);
    // Dark like the pill it opens from
    const container = useInkContainer() ?? rootElement;
    const drafts = useDrafts();
    const { query: visitor, signOut } = useVisitor({ onSignedOut: () => drafts.clear() });
    const announce = useAnnounce();
    const [open, setOpen] = useState(false);
    const [confirmingSignOut, setConfirmingSignOut] = useState(false);
    // The keyboard shortcuts in place of the options (Keyboard shortcuts, or `?`)
    const [showingShortcuts, setShowingShortcuts] = useState(false);
    const confirmRef = useRef<HTMLButtonElement>(null);
    const shortcutsHeadingRef = useRef<HTMLHeadingElement>(null);
    const shortcutsButtonRef = useRef<HTMLButtonElement>(null);
    // The button that showed them is gone: the list's heading takes the focus, and Keyboard shortcuts again after
    // it (opened on them, `onOpenAutoFocus` does it once the popover is there)
    const shownRef = useRef(false);
    useEffect(() => {
        if (!open) {
            shownRef.current = false;
            return;
        }
        if (showingShortcuts) shortcutsHeadingRef.current?.focus();
        else if (shownRef.current) shortcutsButtonRef.current?.focus();
        shownRef.current = showingShortcuts;
    }, [open, showingShortcuts]);
    const name = visitor.data?.name;
    // Account sessions on uier's own pages are managed by the app's account menu. Clearing a
    // guest cookie here would leave that account signed in while claiming to have signed it out.
    const canSignOut = Boolean(name && (!visitor.data?.member || toolbarConfig.project));

    const handleOpenChange = (next: boolean) => {
        setOpen(next);
        if (!next) {
            setConfirmingSignOut(false);
            setShowingShortcuts(false);
            signOut.reset();
        }
    };

    useEffect(() => {
        if (!shortcutsRequested) return;
        setConfirmingSignOut(false);
        setShowingShortcuts(true);
        setOpen(true);
        onShortcutsRequestHandled?.();
    }, [shortcutsRequested, onShortcutsRequestHandled]);

    const handleAskSignOut = () => {
        setConfirmingSignOut(true);
        // After the confirmation renders
        window.setTimeout(() => confirmRef.current?.focus(), 0);
    };

    const handleSignOut = async () => {
        try {
            await signOut.mutateAsync();
            handleOpenChange(false);
            announce('Signed out');
        } catch {
            // Shown below
        }
    };

    const handleExitReview = () => {
        handleOpenChange(false);
        onExitReview?.();
    };

    const hasActions = Boolean(projectUrl || onExitReview || canSignOut || onResetPosition);

    // One-letter shortcuts can be turned off (WCAG 2.1.4): speech input or the page's own keys may need the letters
    const shortcutsEnabled = useShortcutsEnabled();
    // Where a keyboard is likely (composers use the same check); always while they are off
    const showShortcutSwitch = useKeyboardLikely() || !shortcutsEnabled;
    // The switch announces its new state; the menu stays open
    const shortcutSwitch = (
        <OptionSwitch
            checked={shortcutsEnabled}
            onClick={() => setShortcutsEnabled(!shortcutsEnabled)}>
            Shortcuts
        </OptionSwitch>
    );

    const tip = useIconTooltip('Options');
    return (
        <>{tip.tooltip}<Popper
            container={container}
            open={open}
            onOpenChange={handleOpenChange}
            side="top"
            sideOffset={12}
            align="end"
            aria-label={showingShortcuts ? 'Keyboard shortcuts' : 'Options'}
            onKeyDown={moveFocusInMenu}
            // Opened on the shortcuts (`?`): their heading has the focus, not the switch that turns them off.
            // Radix props passed through the Popper to the popover content.
            {...{ onOpenAutoFocus: (event: Event) => {
                if (!showingShortcuts) return;
                event.preventDefault();
                shortcutsHeadingRef.current?.focus();
            } }}
            {...toolbarSurface('uier-options', cx('w-auto min-w-48 max-w-80 rounded-xl p-1', floatingShadowClassName))}
            trigger={(
                <IconButton
                    variant="plain"
                    className="rounded-full"
                    {...tip.triggerProps}
                    aria-label="Options">
                    <MoreHorizontal />
                </IconButton>
            )}>
            {showingShortcuts ? (
                <Stack spacing={1} className="pt-2">
                    <h2 ref={shortcutsHeadingRef} tabIndex={-1} className="m-0 rounded-md px-2 text-sm font-semibold text-foreground outline-none">Keyboard shortcuts</h2>
                    <ShortcutList enabled={shortcutsEnabled} />
                    <Divider role="separator" className="my-1" />
                    <Stack>
                        {shortcutSwitch}
                        <Divider role="separator" className="my-1" />
                        <OptionButton icon={<ArrowLeft size={16} />} onClick={() => setShowingShortcuts(false)}>
                            All options
                        </OptionButton>
                    </Stack>
                </Stack>
            ) : confirmingSignOut ? (
                <Stack spacing={1} className="p-2">
                    <p className="m-0 text-sm text-foreground">
                        Sign out of uier in this browser? You get a new guest name and can no longer
                        resolve or delete the comments you left as {name}.
                    </p>
                    <CommentsErrorMessage error={signOut.error} />
                    <Row spacing={1} justifyContent="end">
                        <Button variant="plain" size="sm" onClick={() => handleOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button
                            ref={confirmRef}
                            variant="outlined"
                            size="sm"
                            loading={signOut.isPending}
                            onClick={handleSignOut}>
                            Sign out
                        </Button>
                    </Row>
                </Stack>
            ) : (
                <Stack>
                    {/* Switches first, in their own group */}
                    {showShortcutSwitch && <>
                        {shortcutSwitch}
                        <Divider role="separator" className="my-1" />
                        <OptionButton ref={shortcutsButtonRef} icon={<LayoutList size={16} />} onClick={() => setShowingShortcuts(true)}>
                            Keyboard shortcuts
                            {shortcutsEnabled && <kbd aria-hidden="true" className="ml-auto pl-3 font-mono font-normal text-muted-foreground">?</kbd>}
                        </OptionButton>
                    </>}
                    {onResetPosition && (
                        <OptionButton icon={<Reset size={16} />} onClick={() => { handleOpenChange(false); onResetPosition(); }}>
                            Reset toolbar position
                        </OptionButton>
                    )}
                    {projectUrl && (
                        <OptionButton
                            icon={<ExternalLink size={16} />}
                            href={projectUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => handleOpenChange(false)}>
                            View project
                        </OptionButton>
                    )}
                    {onExitReview && (
                        <OptionButton icon={<Close size={16} />} onClick={handleExitReview}>
                            {mode === 'feedback' ? 'Close toolbar' : 'Exit review'}
                        </OptionButton>
                    )}
                    {canSignOut && (
                        <OptionButton icon={<LogOut size={16} />} onClick={handleAskSignOut}>
                            Sign out...
                        </OptionButton>
                    )}
                    {(hasActions || showShortcutSwitch) && <Divider role="separator" className="my-1" />}
                    {/* The referrer (the reviewed site's origin) tells uier.io where people came from */}
                    <OptionButton
                        icon={<Mark size={16} />}
                        className="text-muted-foreground hover:text-foreground"
                        href={BRAND_URL}
                        target="_blank"
                        rel="noopener"
                        onClick={() => handleOpenChange(false)}>
                        Powered by uier
                    </OptionButton>
                </Stack>
            )}
        </Popper></>
    );
}
