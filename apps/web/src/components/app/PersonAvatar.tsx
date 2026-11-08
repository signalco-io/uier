import type { ComponentProps } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/src/components/ui/avatar';
import { initials } from './initials';

/**
 * A person's avatar: their profile picture (`avatarUrl`, from `avatarUrl()` on the server), with
 * the initial of their name while it loads, if it fails, and for people without one.
 */
export function PersonAvatar({ name, avatarUrl, fallbackClassName, ...props }: ComponentProps<typeof Avatar> & {
    name: string;
    avatarUrl?: string;
    fallbackClassName?: string;
}) {
    return (
        <Avatar {...props}>
            {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
            <AvatarFallback className={fallbackClassName}>{initials(name)}</AvatarFallback>
        </Avatar>
    );
}
