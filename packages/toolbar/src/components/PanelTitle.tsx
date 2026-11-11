import { createContext, useContext, useRef, useState } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { Button } from '@signalco/ui-primitives/Button';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Typography } from '@signalco/ui-primitives/Typography';
import { cx } from '@signalco/ui-primitives/cx';
import { Check, ExpandDown } from '@signalco/ui-icons';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { useInkContainer } from './InkScope';
import { floatingShadowClassName } from './@types/Comments';
import { toolbarSurface } from '../toolbarReview';
import { moveFocusInMenu } from '../focusKeys';
import { useMessages } from '../i18n';
import type { DockPanelId } from '../openPanel';

/** The docked panels this review can show (the inbox, and the Accessibility and SEO panels when they are on), and how a panel's title shows another in its place */
export const PanelSwitchContext = createContext<{
    panels: { id: DockPanelId; label: string }[];
    switchTo: (from: DockPanelId, to: DockPanelId) => void;
} | undefined>(undefined);

/**
 * A docked panel's title (h2). With other panels to show, it is a menu button: the panels, this one checked; choosing
 * another closes this one and opens that one (its Close then has the focus, as when its pill button opens it).
 * ↑ and ↓ move between them; Escape closes only the menu.
 */
export function PanelTitle({ id, title }: { id: DockPanelId; title: string }) {
    const t = useMessages();
    const switcher = useContext(PanelSwitchContext);
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const container = useInkContainer() ?? rootElement;
    const [open, setOpen] = useState(false);
    const currentRef = useRef<HTMLButtonElement>(null);
    const panels = switcher?.panels ?? [];
    if (!switcher || panels.length < 2 || !panels.some(panel => panel.id === id)) {
        return <Typography component="h2" level="body1" semiBold className="min-w-0 truncate text-foreground">{title}</Typography>;
    }
    const choose = (to: DockPanelId) => {
        setOpen(false);
        if (to !== id) switcher.switchTo(id, to);
    };
    return (
        <Typography component="h2" level="body1" semiBold className="min-w-0 text-foreground">
            <Popper
                container={container ?? undefined}
                open={open}
                onOpenChange={setOpen}
                align="start"
                aria-label={t.panel.switch}
                onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); else moveFocusInMenu(event); }}
                {...toolbarSurface('uier-panel-switch', cx('z-[70] w-48 max-w-[calc(100vw-1rem)] rounded-xl p-1', floatingShadowClassName))}
                {...{
                    onOpenAutoFocus: (event: Event) => {
                        event.preventDefault();
                        currentRef.current?.focus();
                    }
                }}
                trigger={(
                    <Button variant="plain" size="sm" data-uier-panel-switch=""
                        className="h-7 max-w-full gap-1 px-1.5 text-base font-semibold text-foreground pointer-coarse:h-11"
                        endDecorator={<ExpandDown size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />}>
                        <span className="min-w-0 truncate">{title}</span>
                    </Button>
                )}>
                <Stack role="group" aria-label={t.panel.switch}>
                    {panels.map(panel => (
                        <Button key={panel.id} ref={panel.id === id ? currentRef : undefined} variant="plain" size="sm" fullWidth
                            className="justify-start font-normal pointer-coarse:min-h-11" aria-pressed={panel.id === id}
                            endDecorator={<Check size={14} aria-hidden="true" className={cx('ml-auto shrink-0 text-muted-foreground', panel.id !== id && 'invisible')} />}
                            onClick={() => choose(panel.id)}>
                            {panel.label}
                        </Button>
                    ))}
                </Stack>
            </Popper>
        </Typography>
    );
}
