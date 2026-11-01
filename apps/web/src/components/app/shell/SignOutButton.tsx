'use client';

import { LogOutIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { signOutAction } from './actions';
import { clearAppReplyDrafts } from '../comments/replyDrafts';

export function SignOutButton() {
    return (
        <form action={signOutAction} onSubmit={clearAppReplyDrafts}>
            <Button type="submit" variant="outline">
                <LogOutIcon data-icon="inline-start" />
                Sign out
            </Button>
        </form>
    );
}
