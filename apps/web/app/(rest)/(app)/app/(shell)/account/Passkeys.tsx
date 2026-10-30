'use client';

import { useId, useState, useSyncExternalStore, useTransition } from 'react';
import { KeyRoundIcon, LogInIcon, PencilIcon, PlusIcon } from 'lucide-react';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/src/components/ui/alert-dialog';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/src/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/src/components/ui/item';
import { Spinner } from '@/src/components/ui/spinner';
import { Section } from '@/src/components/app/PageHeader';
import { FormMessage } from '@/src/components/app/FormMessage';
import { DateTime } from '@/src/components/app/comments/DateTime';
import { forgetPasskey, passkeyPromptError } from '@/src/components/app/passkeyCeremony';
import type { ActionState } from '@/src/lib/app/actionResult';
import { MAX_PASSKEY_NAME_LENGTH } from '@/src/lib/app/limits';
import type { PasskeyView } from '@/src/lib/app/passkeys';
import { addPasskeyAction, passkeyRegistrationOptionsAction, removePasskeyAction, renamePasskeyAction, signInAgainAction, type PasskeyState } from './passkeyActions';

const subscribe = () => () => undefined;

export function Passkeys({ passkeys, recentSignIn }: { passkeys: PasskeyView[]; recentSignIn: boolean }) {
    // Rendered on the server as supported (nearly every browser is); hidden after hydration otherwise.
    const supported = useSyncExternalStore(subscribe, browserSupportsWebAuthn, () => true);
    const [state, setState] = useState<ActionState<unknown>>(null);
    const [expired, setExpired] = useState(false);
    const [pending, setPending] = useState(false);
    const signInAgain = !recentSignIn || expired;

    function finish(result: PasskeyState<unknown>) {
        setPending(false);
        // The sign-in panel below explains it; no second message.
        setExpired(previous => previous || !!result.signInAgain);
        setState(result.signInAgain ? null : result);
    }

    async function add() {
        setPending(true);
        setState(null);
        const options = await passkeyRegistrationOptionsAction();
        if (!options.ok)
            return finish(options);
        let response;
        try {
            response = await startRegistration({ optionsJSON: options.data });
        } catch (cause) {
            return finish({ ok: false, error: passkeyPromptError(cause, 'register') ?? 'No passkey was added. The prompt was closed or timed out.' });
        }
        finish(await addPasskeyAction(response));
    }

    return (
        <Section
            id="passkeys"
            title="Passkeys"
            description="Sign in with your fingerprint, face or screen lock instead of an email code. Those never leave your device."
            actions={supported && !signInAgain ? (
                <Button variant="outline" disabled={pending} onClick={() => void add()}>
                    {pending ? <Spinner data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
                    Add a passkey
                </Button>
            ) : undefined}>
            <div className="flex flex-col gap-4">
                {passkeys.length
                    ? <ItemGroup aria-label="Your passkeys" className="gap-3">
                        {passkeys.map(passkey => <PasskeyRow key={passkey.id} passkey={passkey} />)}
                    </ItemGroup>
                    : <p className="m-0 text-sm text-muted-foreground">No passkeys yet.</p>}
                {!supported && <p className="m-0 text-sm text-muted-foreground">This browser does not support passkeys. You can still sign in with an email code.</p>}
                {supported && signInAgain && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
                        <p className="m-0 min-w-0 flex-1 text-sm text-muted-foreground">To add a passkey, sign in again. Adding one needs a sign-in from the last 10 minutes.</p>
                        <form action={signInAgainAction}>
                            <Button type="submit" variant="outline">
                                <LogInIcon data-icon="inline-start" />
                                Sign in again
                            </Button>
                        </form>
                    </div>
                )}
                <FormMessage state={state} />
            </div>
        </Section>
    );
}

function PasskeyRow({ passkey }: { passkey: PasskeyView }) {
    return (
        <Item variant="outline" role="listitem" className="items-start">
            <ItemMedia variant="icon"><KeyRoundIcon /></ItemMedia>
            <ItemContent className="min-w-0">
                <ItemTitle className="line-clamp-none break-words">
                    {passkey.name}
                    {passkey.backedUp && <Badge variant="secondary">Synced</Badge>}
                </ItemTitle>
                <ItemDescription className="line-clamp-none">
                    Added <DateTime value={passkey.createdAt} />
                    {' · '}{passkey.lastUsedAt ? <>Last used <DateTime value={passkey.lastUsedAt} /></> : 'Not used yet'}
                </ItemDescription>
            </ItemContent>
            <ItemActions>
                <RenamePasskey passkey={passkey} />
                <RemovePasskey passkey={passkey} />
            </ItemActions>
        </Item>
    );
}

function RenamePasskey({ passkey }: { passkey: PasskeyView }) {
    const [open, setOpen] = useState(false);
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Rename ${passkey.name}`}>
                    <PencilIcon />
                </Button>
            </DialogTrigger>
            <DialogContent>
                {/* Unmounted when closed, so every opening starts from the saved name */}
                <RenameForm passkey={passkey} onSaved={() => setOpen(false)} />
            </DialogContent>
        </Dialog>
    );
}

function RenameForm({ passkey, onSaved }: { passkey: PasskeyView; onSaved: () => void }) {
    const id = useId();
    const [name, setName] = useState(passkey.name);
    const [state, setState] = useState<ActionState>(null);
    const [pending, startTransition] = useTransition();
    const save = (event: React.FormEvent) => {
        event.preventDefault();
        startTransition(async () => {
            const result = await renamePasskeyAction(passkey.id, name);
            setState(result);
            if (result?.ok)
                onSaved();
        });
    };
    return (
        <form onSubmit={save} className="flex flex-col gap-6">
            <DialogHeader>
                <DialogTitle>Rename passkey</DialogTitle>
                <DialogDescription>A name helps you tell your passkeys apart, such as the device or password manager it is on.</DialogDescription>
            </DialogHeader>
            <FieldGroup>
                <Field>
                    <FieldLabel htmlFor={`${id}-name`}>Passkey name</FieldLabel>
                    <Input id={`${id}-name`} value={name} onChange={event => setName(event.target.value)} required maxLength={MAX_PASSKEY_NAME_LENGTH} />
                </Field>
            </FieldGroup>
            <FormMessage state={state} />
            <DialogFooter>
                <DialogClose asChild>
                    <Button type="button" variant="outline">Cancel</Button>
                </DialogClose>
                <Button type="submit" disabled={pending}>
                    {pending && <Spinner data-icon="inline-start" />}
                    Save
                </Button>
            </DialogFooter>
        </form>
    );
}

function RemovePasskey({ passkey }: { passkey: PasskeyView }) {
    const [confirming, setConfirming] = useState(false);
    const [state, setState] = useState<ActionState>(null);
    const [pending, startTransition] = useTransition();
    const remove = () => startTransition(async () => {
        const result = await removePasskeyAction(passkey.id);
        if (result?.ok) {
            if (result.data)
                forgetPasskey(result.data.rpId, result.data.credentialId);
            setConfirming(false);
            setState(null);
        } else setState(result);
    });
    return (
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <AlertDialogTrigger asChild>
                <Button variant="outline" aria-label={`Remove ${passkey.name}`}>Remove</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle className="break-words">Remove {passkey.name}?</AlertDialogTitle>
                    <AlertDialogDescription>It stops working for uier right away. Your browser or password manager may still list it until you delete it there.</AlertDialogDescription>
                </AlertDialogHeader>
                <FormMessage state={state} />
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={pending}>Keep passkey</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" disabled={pending} onClick={event => { event.preventDefault(); remove(); }}>
                        {pending && <Spinner data-icon="inline-start" />}
                        Remove
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
