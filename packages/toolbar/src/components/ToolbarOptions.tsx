'use client';

import { Fragment, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode, type Ref } from 'react';
import { useIconTooltip } from './IconTooltip';
import { Popper } from '@signalco/ui-primitives/Popper';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Row } from '@signalco/ui-primitives/Row';
import { Divider } from '@signalco/ui-primitives/Divider';
import { cx } from '@signalco/ui-primitives/cx';
import { ArrowLeft, Check, Close, ExternalLink, Globe, LayoutList, LogOut, MoreHorizontal, Reset } from '@signalco/ui-icons';
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
import { keepMovedFocus, toolbarSurface } from '../toolbarReview';
import { AccessibilityIcon, SeoIcon } from './checks/ChecksIcons';
import type { ChecksAttention, ChecksPanelId } from './checks/PageChecks';
import { AttentionDot, checksButtonLabel } from './checks/ChecksAttention';
import { useMessages, type Messages } from '../i18n';
import { useLanguageChoice } from '../hooks/useLanguageChoice';
import { toolbarLanguageNames, toolbarLanguages } from '../languages';

type ToolbarOptionsProps = {
    /** The reviewed project in the uier app (a review of a project's site, or a link with a project code) */
    projectUrl?: string;
    onResetPosition?: () => void;
    /** Ends the review (`review` mode) or closes the toolbar (`feedback` mode) */
    onExitReview?: () => void;
    /** `?` was pressed: the options open on the keyboard shortcuts */
    shortcutsRequested?: boolean;
    onShortcutsRequestHandled?: () => void;
    triggerRef?: Ref<HTMLButtonElement>;
    /** A narrow screen: the Accessibility (where it can load) and SEO panels open from here, not from the pill */
    pageChecks?: { accessibility: boolean; attention?: ChecksAttention; onOpen: (panel: ChecksPanelId) => void };
};

/** The keyboard shortcuts, by what they do (`toolbarShortcuts`); the single keys are marked off while they are */
function ShortcutList({ enabled, t }: { enabled: boolean; t: Messages }) {
    return (
        <dl className="m-0 flex flex-col gap-1 px-2 text-sm text-foreground">
            {toolbarShortcuts.map(shortcut => (
                <div key={shortcut.label} className="flex min-h-6 items-center justify-between gap-4">
                    <dt className={cx(shortcut.letter && !enabled && 'text-muted-foreground')}>
                        {t.shortcutList[shortcut.label]}
                        {shortcut.letter && !enabled && <span className="sr-only">{t.common.off}</span>}
                    </dt>
                    <dd className="m-0 flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        {shortcut.keys.map((key, index) => (
                            <Fragment key={index}>
                                {index > 0 && shortcut.join && <span>{t.common[shortcut.join]}</span>}
                                {/* Mono means machine (BRAND.md) */}
                                <kbd className="min-w-5 rounded-sm border px-1 text-center font-mono text-foreground">
                                    {typeof key === 'string' ? key : <><span aria-hidden="true">{key.print}</span><span className="sr-only">{t.shortcutList[key.name]}</span></>}
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
 * One language of the Language view: a check marks the chosen one (`aria-pressed`). `lang` names the
 * language of its label, so a screen reader reads "Deutsch" in German.
 */
function LanguageOption({ selected, disabled, lang, onClick, children }: { selected: boolean; disabled?: boolean; lang?: string; onClick: () => void; children: ReactNode }) {
    return (
        <OptionButton icon={selected ? <Check size={16} /> : null} aria-pressed={selected} disabled={disabled} onClick={onClick}>
            <span lang={lang}>{children}</span>
        </OptionButton>
    );
}

/**
 * The toolbar's options: the switches (single-key shortcuts on or off) in their own group, then the actions
 * (the keyboard shortcuts' list, also on `?`, view the project, exit the review, sign out; only the ones that
 * apply), and always a link to uier.io, since the toolbar shows on other people's sites. ↑ and ↓ move
 * between its buttons.
 */
export function ToolbarOptions({ projectUrl, onExitReview, onResetPosition, shortcutsRequested = false, onShortcutsRequestHandled, triggerRef, pageChecks }: ToolbarOptionsProps) {
    const { rootElement, mode } = useContext(CommentsBootstrapperContext);
    const t = useMessages();
    const languages = useLanguageChoice();
    // Dark like the pill it opens from
    const container = useInkContainer() ?? rootElement;
    const drafts = useDrafts();
    const { query: visitor, signOut } = useVisitor({ onSignedOut: () => drafts.clear() });
    const announce = useAnnounce();
    const [open, setOpen] = useState(false);
    const [confirmingSignOut, setConfirmingSignOut] = useState(false);
    // The keyboard shortcuts in place of the options (Keyboard shortcuts, or `?`)
    const [showingShortcuts, setShowingShortcuts] = useState(false);
    // The languages in place of the options (Language)
    const [showingLanguage, setShowingLanguage] = useState(false);
    const confirmRef = useRef<HTMLButtonElement>(null);
    const shortcutsHeadingRef = useRef<HTMLHeadingElement>(null);
    const shortcutsButtonRef = useRef<HTMLButtonElement>(null);
    const languageHeadingRef = useRef<HTMLHeadingElement>(null);
    const languageButtonRef = useRef<HTMLButtonElement>(null);
    // The button that showed a view is gone: the view's heading takes the focus, and its button again after
    // it (opened on the shortcuts, `onOpenAutoFocus` does it once the popover is there)
    const shownRef = useRef<'shortcuts' | 'language' | null>(null);
    useEffect(() => {
        if (!open) {
            shownRef.current = null;
            return;
        }
        if (showingShortcuts) shortcutsHeadingRef.current?.focus();
        else if (showingLanguage) languageHeadingRef.current?.focus();
        else if (shownRef.current === 'shortcuts') shortcutsButtonRef.current?.focus();
        else if (shownRef.current === 'language') languageButtonRef.current?.focus();
        shownRef.current = showingShortcuts ? 'shortcuts' : showingLanguage ? 'language' : null;
    }, [open, showingShortcuts, showingLanguage]);
    const name = visitor.data?.name;
    // Account sessions on uier's own pages are managed by the app's account menu. Clearing a
    // guest cookie here would leave that account signed in while claiming to have signed it out.
    const canSignOut = Boolean(name && (!visitor.data?.member || toolbarConfig.project));

    const handleOpenChange = (next: boolean) => {
        setOpen(next);
        if (!next) {
            setConfirmingSignOut(false);
            setShowingShortcuts(false);
            setShowingLanguage(false);
            signOut.reset();
        }
    };

    useEffect(() => {
        if (!shortcutsRequested) return;
        setConfirmingSignOut(false);
        setShowingLanguage(false);
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
            announce(t.options.signedOut);
        } catch {
            // Shown below
        }
    };

    // The panel's Close has the focus: closing the options leaves it there
    const openingPanelRef = useRef(false);
    const handleOpenPanel = (panel: ChecksPanelId) => {
        openingPanelRef.current = true;
        handleOpenChange(false);
        pageChecks?.onOpen(panel);
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
            {t.options.shortcuts}
        </OptionSwitch>
    );

    const tip = useIconTooltip(t.options.label);
    return (
        <>{tip.tooltip}<Popper
            container={container}
            open={open}
            onOpenChange={handleOpenChange}
            side="top"
            sideOffset={12}
            align="end"
            aria-label={showingShortcuts ? t.options.keyboardShortcuts : showingLanguage ? t.options.language : t.options.label}
            onKeyDown={moveFocusInMenu}
            // Opened on the shortcuts (`?`): their heading has the focus, not the switch that turns them off.
            // Radix props passed through the Popper to the popover content.
            {...{ onOpenAutoFocus: (event: Event) => {
                if (!showingShortcuts) return;
                event.preventDefault();
                shortcutsHeadingRef.current?.focus();
            } }}
            {...toolbarSurface('uier-options', cx('w-auto min-w-48 max-w-80 rounded-xl p-1', floatingShadowClassName))}
            {...{ onCloseAutoFocus: (event: Event) => {
                if (openingPanelRef.current) {
                    openingPanelRef.current = false;
                    event.preventDefault();
                } else keepMovedFocus(event);
            } }}
            trigger={(
                <IconButton
                    ref={triggerRef}
                    variant="plain"
                    className="rounded-full"
                    {...tip.triggerProps}
                    aria-label={t.options.label}>
                    <MoreHorizontal />
                </IconButton>
            )}>
            {showingShortcuts ? (
                <Stack spacing={1} className="pt-2">
                    <h2 ref={shortcutsHeadingRef} tabIndex={-1} className="m-0 rounded-md px-2 text-sm font-semibold text-foreground outline-none">{t.options.keyboardShortcuts}</h2>
                    <ShortcutList enabled={shortcutsEnabled} t={t} />
                    <Divider role="separator" className="my-1" />
                    <Stack>
                        {shortcutSwitch}
                        <Divider role="separator" className="my-1" />
                        <OptionButton icon={<ArrowLeft size={16} />} onClick={() => setShowingShortcuts(false)}>
                            {t.options.allOptions}
                        </OptionButton>
                    </Stack>
                </Stack>
            ) : showingLanguage ? (
                <Stack spacing={1} className="pt-2">
                    <h2 ref={languageHeadingRef} tabIndex={-1} className="m-0 rounded-md px-2 text-sm font-semibold text-foreground outline-none">{t.options.language}</h2>
                    {/* Default first: it follows the project (Account → Toolbar language has the same choice) */}
                    <Stack role="group" aria-label={t.options.language}>
                        <LanguageOption disabled={languages.saving} selected={languages.state.preference === null} onClick={() => languages.choose(null)}>
                            {t.options.languageDefault(toolbarLanguageNames[languages.state.defaultLanguage])}
                        </LanguageOption>
                        {toolbarLanguages.map(language => (
                            <LanguageOption disabled={languages.saving} key={language} lang={language} selected={languages.state.preference === language} onClick={() => languages.choose(language)}>
                                {toolbarLanguageNames[language]}
                            </LanguageOption>
                        ))}
                    </Stack>
                    <p className="m-0 px-2 text-xs text-muted-foreground">
                        {t.options.languageSource[languages.state.source]}{' '}
                        {languages.state.account ? t.options.languageSavedAccount : t.options.languageSavedBrowser}
                    </p>
                    {languages.failed && <p role="alert" className="m-0 px-2 text-xs text-destructive">{t.options.languageNotSaved}</p>}
                    {languages.state.failed && <p role="alert" className="m-0 px-2 text-xs text-destructive">{t.options.languageNotLoaded}</p>}
                    <Divider role="separator" className="my-1" />
                    <OptionButton icon={<ArrowLeft size={16} />} onClick={() => setShowingLanguage(false)}>
                        {t.options.allOptions}
                    </OptionButton>
                </Stack>
            ) : confirmingSignOut ? (
                <Stack spacing={1} className="p-2">
                    <p className="m-0 text-sm text-foreground">
                        {t.options.signOutConfirm(name ?? '')}
                    </p>
                    <CommentsErrorMessage error={signOut.error} />
                    <Row spacing={1} justifyContent="end">
                        <Button variant="plain" size="sm" onClick={() => handleOpenChange(false)}>
                            {t.common.cancel}
                        </Button>
                        <Button
                            ref={confirmRef}
                            variant="outlined"
                            size="sm"
                            loading={signOut.isPending}
                            onClick={handleSignOut}>
                            {t.common.signOut}
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
                            {t.options.keyboardShortcuts}
                            {shortcutsEnabled && <kbd aria-hidden="true" className="ml-auto pl-3 font-mono font-normal text-muted-foreground">?</kbd>}
                        </OptionButton>
                    </>}
                    {/* The language in its own words, whatever the toolbar shows */}
                    <OptionButton ref={languageButtonRef} icon={<Globe size={16} />} onClick={() => setShowingLanguage(true)}>
                        {t.options.language}
                        <span lang={languages.state.language} className="ml-auto pl-3 font-normal text-muted-foreground">{toolbarLanguageNames[languages.state.language]}</span>
                    </OptionButton>
                    <Divider role="separator" className="my-1" />
                    {pageChecks && <>
                        {pageChecks.accessibility && (
                            <OptionButton icon={<AccessibilityIcon size={16} />} onClick={() => handleOpenPanel('accessibility')}
                                aria-label={checksButtonLabel('accessibility', pageChecks.attention)}>
                                {t.toolbar.accessibility}
                                <AttentionDot panel="accessibility" attention={pageChecks.attention} className="ml-auto ring-0" />
                            </OptionButton>
                        )}
                        <OptionButton icon={<SeoIcon size={16} />} onClick={() => handleOpenPanel('seo')}
                            aria-label={checksButtonLabel('seo', pageChecks.attention)}>
                            {t.toolbar.seo}
                            <AttentionDot panel="seo" attention={pageChecks.attention} className="ml-auto ring-0" />
                        </OptionButton>
                        <Divider role="separator" className="my-1" />
                    </>}
                    {onResetPosition && (
                        <OptionButton icon={<Reset size={16} />} onClick={() => { handleOpenChange(false); onResetPosition(); }}>
                            {t.options.resetPosition}
                        </OptionButton>
                    )}
                    {projectUrl && (
                        <OptionButton
                            icon={<ExternalLink size={16} />}
                            href={projectUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => handleOpenChange(false)}>
                            {t.options.viewProject}
                        </OptionButton>
                    )}
                    {onExitReview && (
                        <OptionButton icon={<Close size={16} />} onClick={handleExitReview}>
                            {mode === 'feedback' ? t.options.closeToolbar : t.options.exitReview}
                        </OptionButton>
                    )}
                    {canSignOut && (
                        <OptionButton icon={<LogOut size={16} />} onClick={handleAskSignOut}>
                            {t.options.signOutMenu}
                        </OptionButton>
                    )}
                    {hasActions && <Divider role="separator" className="my-1" />}
                    {/* The referrer (the reviewed site's origin) tells uier.io where people came from */}
                    <OptionButton
                        icon={<Mark size={16} />}
                        className="text-muted-foreground hover:text-foreground"
                        href={BRAND_URL}
                        target="_blank"
                        rel="noopener"
                        onClick={() => handleOpenChange(false)}>
                        {t.options.poweredBy}
                    </OptionButton>
                </Stack>
            )}
        </Popper></>
    );
}
