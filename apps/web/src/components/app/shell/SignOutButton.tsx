import { Button } from '@signalco/ui-primitives/Button';
import { signOutAction } from './actions';

export function SignOutButton() {
    return (
        <form action={signOutAction}>
            <Button type="submit" variant="outlined">Sign out</Button>
        </form>
    );
}
