'use client';

import { useContext } from 'react';
import { useIconTooltip } from './IconTooltip';
import { Popper } from '@signalco/ui-primitives/Popper';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Row } from '@signalco/ui-primitives/Row';
import { Avatar } from '@signalco/ui-primitives/Avatar';
import { Typography } from '@signalco/ui-primitives/Typography';
import { cx } from '@signalco/ui-primitives/cx';
import { UserCircle } from '@signalco/ui-icons';
import { useVisitor } from '../hooks/useVisitor';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { useInkContainer } from './InkScope';
import { avatarText } from './CommentThreadItem';
import { floatingShadowClassName } from './@types/Comments';
import { toolbarSurface } from '../toolbarReview';
import { useMessages } from '../i18n';

/** The toolbar's profile button: who the visitor comments as. Signed in, it shows their avatar (the app's initial), otherwise a person icon */
export function ToolbarProfile() {
    const { rootElement } = useContext(CommentsBootstrapperContext);
    // Dark like the pill it opens from
    const container = useInkContainer() ?? rootElement;
    const { query } = useVisitor();
    const t = useMessages();
    const name = query.data?.name;
    const signedIn = Boolean(query.data?.member && name);

    const tip = useIconTooltip(signedIn ? t.profile.signedInAs(name!) : t.profile.label);
    return (
        <>{tip.tooltip}<Popper
            container={container}
            side="top"
            sideOffset={12}
            aria-label={t.profile.label}
            {...toolbarSurface('uier-profile', cx('w-72 rounded-xl p-4', floatingShadowClassName))}
            trigger={(
                <IconButton
                    variant="plain"
                    className="rounded-full"
                    {...tip.triggerProps}
                    aria-label={t.profile.label}>
                    {signedIn
                        ? <Avatar size="sm" aria-hidden="true" className="border bg-accent text-[11px] font-semibold text-foreground">{avatarText(name!)}</Avatar>
                        : <UserCircle />}
                </IconButton>
            )}>
            <Stack spacing={1.5}>
                <Row spacing={1} className="min-w-0">
                    <Avatar size="sm" aria-hidden="true" className="shrink-0 font-semibold">{avatarText(name ?? t.common.guest)}</Avatar>
                    <Typography level="body2" semiBold noWrap className="text-foreground">
                        {name ?? t.common.guest}
                    </Typography>
                </Row>
                <Typography level="body2" className="text-secondary-foreground">
                    {query.data?.member
                        ? t.profile.member
                        : name
                            ? t.profile.guest
                            : t.profile.newGuest}
                </Typography>
            </Stack>
        </Popper></>
    );
}
