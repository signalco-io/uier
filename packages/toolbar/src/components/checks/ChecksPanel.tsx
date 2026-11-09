import { useContext, useState, type ReactNode } from 'react';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Row } from '@signalco/ui-primitives/Row';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Typography } from '@signalco/ui-primitives/Typography';
import { cx } from '@signalco/ui-primitives/cx';
import { PanelRightClose, Reset } from '@signalco/ui-icons';
import { DockablePanel, PanelHandle } from '../DockablePanel';
import { IconTooltip } from '../IconTooltip';
import { InkScope } from '../InkScope';
import { RestoredPanelContext } from '../../openPanel';

/**
 * The Accessibility and SEO panels' shell: docked like the inbox (`DockablePanel`, its own side),
 * ink, sliding in from its side; the title row with the handle and the icon buttons Check again and Close, which has
 * the focus when it opens. Escape closes it. One that stays open from the previous page does neither.
 */
export function ChecksPanel({ id, title, checking, onCheckAgain, onClose, children }: {
    id: 'accessibility' | 'seo';
    title: string;
    /** A check is running (Check again gets its result) */
    checking?: boolean;
    onCheckAgain: () => void;
    onClose: () => void;
    children: ReactNode;
}) {
    const [hiding, setHiding] = useState(false);
    const restored = useContext(RestoredPanelContext) === id;
    const close = () => {
        setHiding(true);
        window.setTimeout(onClose, 150);
    };
    return (
        <InkScope>
            <DockablePanel id={id} label={title}
                onKeyDown={event => {
                    if (event.key === 'Escape') {
                        event.stopPropagation();
                        close();
                    }
                }}
                className={cx(hiding
                    ? 'animate-out fade-out fill-mode-forwards duration-150 ease-in motion-safe:data-[side=left]:slide-out-to-left motion-safe:data-[side=right]:slide-out-to-right'
                    : !restored && 'animate-in fade-in duration-200 ease-out motion-safe:data-[side=left]:slide-in-from-left motion-safe:data-[side=right]:slide-in-from-right')}>
                {/* Focusable so a long report scrolls with the keyboard */}
                <Stack tabIndex={0} className="h-full overflow-y-auto rounded-b-2xl outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <Row justifyContent="space-between" className="shrink-0 px-4 pt-3">
                        <Row spacing={0.5} className="min-w-0">
                            <PanelHandle />
                            <Typography component="h2" level="body1" semiBold className="text-foreground">{title}</Typography>
                        </Row>
                        <Row>
                            {/* Never disabled, so it keeps the focus: a check already running is the one it gets */}
                            <IconTooltip label="Check again">
                                <IconButton variant="plain" aria-label="Check again" aria-busy={checking || undefined} onClick={onCheckAgain}>
                                    <Reset aria-hidden="true" />
                                </IconButton>
                            </IconTooltip>
                            <IconTooltip label="Close panel">
                                <IconButton variant="plain" aria-label={`Close ${title} panel`} autoFocus={!restored} onClick={close}>
                                    <PanelRightClose />
                                </IconButton>
                            </IconTooltip>
                        </Row>
                    </Row>
                    <Stack spacing={3} className="shrink-0 px-4 pb-4 pt-2">
                        {children}
                    </Stack>
                </Stack>
            </DockablePanel>
        </InkScope>
    );
}
