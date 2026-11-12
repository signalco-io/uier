import { useContext, useRef, useState, type Ref } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { Button } from '@signalco/ui-primitives/Button';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Stack } from '@signalco/ui-primitives/Stack';
import { cx } from '@signalco/ui-primitives/cx';
import { CommentsBootstrapperContext } from '../CommentsBootstrapperContext';
import { useInkContainer } from '../InkScope';
import { useIconTooltip } from '../IconTooltip';
import { floatingShadowClassName } from '../@types/Comments';
import { keepMovedFocus, toolbarSurface } from '../../toolbarReview';
import { moveFocusInMenu } from '../../focusKeys';
import { messages, useMessages } from '../../i18n';
import { AccessibilityIcon, ConsentIcon, PageChecksIcon, SeoIcon } from './ChecksIcons';
import { AttentionDot, checksButtonLabel } from './ChecksAttention';
import type { ChecksAttention, ChecksPanelId } from './PageChecks';

const icons = { accessibility: AccessibilityIcon, seo: SeoIcon, consent: ConsentIcon };

/** The group button's name: "Page checks", then what its panels found to act on in all ("Page checks, 5 to look at") */
export function pageChecksLabel(tools: readonly ChecksPanelId[], attention?: ChecksAttention) {
    const t = messages();
    const count = tools.reduce((sum, panel) => sum + (attention?.[panel] ?? 0), 0);
    return count ? t.checks.attentionLook(t.toolbar.pageChecks, count) : t.toolbar.pageChecks;
}

/**
 * Accessibility, SEO and Security and compliance in the pill behind one button, so the pill does not grow with every
 * page tool (uier #353). It opens a menu of the tools this review shows: each with its icon, its amber dot and its name
 * with what it found ("SEO, 2 to look at"), like the buttons were; an open panel's item is expanded and controls it.
 * Choosing one opens its panel (its Close takes the focus) or closes it. The button is highlighted while one of its
 * panels is open and has a dot while one of them found something; closing a panel gives it the focus back
 * (`buttonRef`). ↑ ↓ move between the items, Escape closes only the menu.
 */
export function PageChecksMenu({ tools, openPanels, attention, onToggle, buttonRef }: {
    tools: readonly ChecksPanelId[];
    openPanels: readonly ChecksPanelId[];
    attention?: ChecksAttention;
    onToggle: (panel: ChecksPanelId) => void;
    buttonRef?: Ref<HTMLButtonElement>;
}) {
    const t = useMessages();
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const container = useInkContainer() ?? rootElement;
    const [open, setOpen] = useState(false);
    const tip = useIconTooltip(t.toolbar.pageChecks);
    // An opened panel's Close has the focus: closing the menu leaves it there
    const openingRef = useRef(false);
    const anyOpen = tools.some(panel => openPanels.includes(panel));
    const anyAttention = tools.some(panel => attention?.[panel]);
    const choose = (panel: ChecksPanelId) => {
        openingRef.current = !openPanels.includes(panel);
        setOpen(false);
        onToggle(panel);
    };
    return <>{tip.tooltip}<Popper
        container={container ?? undefined}
        open={open}
        onOpenChange={setOpen}
        side="top"
        sideOffset={12}
        align="center"
        aria-label={t.toolbar.pageChecks}
        onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); else moveFocusInMenu(event); }}
        {...toolbarSurface('uier-page-checks-menu', cx('w-max min-w-48 max-w-[calc(100vw-1rem)] rounded-xl p-1', floatingShadowClassName))}
        {...{ onCloseAutoFocus: (event: Event) => {
            if (openingRef.current) {
                openingRef.current = false;
                event.preventDefault();
            } else keepMovedFocus(event);
        } }}
        trigger={(
            <IconButton
                ref={buttonRef}
                data-uier-page-checks=""
                // Which of its tools found something to act on ("accessibility seo"), for tests and tools; the name says it in words
                data-uier-attention-panels={tools.filter(panel => attention?.[panel]).join(' ') || undefined}
                // Highlighted while one of its panels is open, like the inbox's button
                variant={anyOpen ? 'soft' : 'plain'}
                className="relative rounded-full"
                {...tip.triggerProps}
                aria-label={pageChecksLabel(tools, attention)}>
                <PageChecksIcon />
                {anyAttention && <span aria-hidden="true" data-uier-attention="page-checks"
                    className="pointer-events-none absolute right-1.5 top-1.5 size-2 rounded-full bg-[hsl(var(--brand-warning))] ring-2 ring-[hsl(var(--background))]" />}
            </IconButton>
        )}>
        <Stack role="group" aria-label={t.toolbar.pageChecks}>
            {tools.map(panel => {
                const Icon = icons[panel];
                const panelOpen = openPanels.includes(panel);
                return (
                    <Button key={panel} variant={panelOpen ? 'soft' : 'plain'} size="sm" fullWidth
                        className="justify-start gap-2 font-normal pointer-coarse:min-h-11"
                        data-uier-page-check={panel}
                        aria-label={checksButtonLabel(panel, attention)}
                        aria-expanded={panelOpen}
                        aria-controls={panelOpen ? `uier-panel-${panel}` : undefined}
                        startDecorator={<Icon size={16} aria-hidden="true" className="shrink-0" />}
                        endDecorator={<AttentionDot panel={panel} attention={attention} className="ml-auto ring-0" />}
                        onClick={() => choose(panel)}>
                        <span className="min-w-0 flex-1 truncate whitespace-nowrap text-left">{t.toolbar[panel]}</span>
                    </Button>
                );
            })}
        </Stack>
    </Popper></>;
}
