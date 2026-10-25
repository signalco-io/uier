import { LogOutIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { signOutAction } from './actions';

export function SignOutButton() {
    return (
        <form action={signOutAction}>
            <Button type="submit" variant="outline">
                <LogOutIcon data-icon="inline-start" />
                Sign out
            </Button>
        </form>
    );
}
