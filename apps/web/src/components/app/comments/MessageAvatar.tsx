import { Avatar, AvatarFallback, AvatarImage } from '@/src/components/ui/avatar';
import { initials } from '../initials';

/**
 * A message author's 24px avatar beside their name, in the app's thread (`Message`) and the MCP thread card:
 * their profile picture, or the initial of their name. Decorative: the name is written beside it.
 */
export function MessageAvatar({ name, avatarUrl, className }: { name: string; avatarUrl?: string; className?: string }) {
    return (
        <Avatar size="sm" aria-hidden="true" className={className}>
            {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
            <AvatarFallback className="font-semibold text-foreground">{initials(name)}</AvatarFallback>
        </Avatar>
    );
}
