'use client';

import { useContext } from 'react';
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

/** The toolbar's profile button: who the visitor comments as. Signed in, it shows their avatar (the app's initial), otherwise a person icon */
export function ToolbarProfile() {
    const { rootElement } = useContext(CommentsBootstrapperContext);
    // Dark like the pill it opens from
    const container = useInkContainer() ?? rootElement;
    const { query } = useVisitor();
    const name = query.data?.name;
    const signedIn = Boolean(query.data?.member && name);

    return (
        <Popper
            container={container}
            side="top"
            sideOffset={12}
            aria-label="Profile"
            className={cx('w-72 rounded-xl p-4', floatingShadowClassName)}
            trigger={(
                <IconButton
                    variant="plain"
                    className="rounded-full"
                    title={signedIn ? `Signed in as ${name}` : 'Profile'}
                    aria-label="Profile">
                    {signedIn
                        ? <Avatar size="sm" aria-hidden="true" className="border bg-accent text-[11px] font-semibold text-foreground">{avatarText(name!)}</Avatar>
                        : <UserCircle />}
                </IconButton>
            )}>
            <Stack spacing={1.5}>
                <Row spacing={1} className="min-w-0">
                    <Avatar size="sm" aria-hidden="true" className="shrink-0 font-semibold">{avatarText(name ?? 'Guest')}</Avatar>
                    <Typography level="body2" semiBold noWrap className="text-foreground">
                        {name ?? 'Guest'}
                    </Typography>
                </Row>
                <Typography level="body2" className="text-secondary-foreground">
                    {query.data?.member
                        ? 'You are signed in to uier. Your comments show your account name.'
                        : name
                            ? 'You comment as a guest. The name stays with this browser until you sign out.'
                            : 'You have not commented yet. Your first comment or reply gives you a guest name.'}
                </Typography>
            </Stack>
        </Popper>
    );
}
