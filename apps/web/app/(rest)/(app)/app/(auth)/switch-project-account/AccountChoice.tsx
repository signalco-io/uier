'use client';

import { useFormStatus } from 'react-dom';
import { ChevronRightIcon } from 'lucide-react';
import { PersonAvatar } from '@/src/components/app/PersonAvatar';
import { Button } from '@/src/components/ui/button';
import { Spinner } from '@/src/components/ui/spinner';

/**
 * One account of the picker: the whole row is its form's submit button (picture or initial, name and
 * email). The email is never cut short, since the domain is what tells one person's accounts apart:
 * a long one wraps, before the @ first. The chevron becomes a spinner while the switch is under way.
 */
export function AccountChoice({ name, email, avatarUrl }: { name: string; email: string; avatarUrl?: string }) {
    const { pending } = useFormStatus();
    const at = email.lastIndexOf('@');
    return (
        <Button type="submit" variant="outline" disabled={pending}
            className="h-auto w-full justify-start gap-3 rounded-lg px-3 py-2.5 text-left font-normal whitespace-normal">
            <PersonAvatar name={name} avatarUrl={avatarUrl} size="lg" aria-hidden="true" />
            <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="font-medium break-words">{name}</span>
                {email !== name && (
                    <span className="text-xs wrap-anywhere text-muted-foreground">
                        {at > 0 ? <>{email.slice(0, at)}<wbr />{email.slice(at)}</> : email}
                    </span>
                )}
            </span>
            {pending ? <Spinner className="text-muted-foreground" /> : <ChevronRightIcon aria-hidden="true" className="text-muted-foreground" />}
        </Button>
    );
}
