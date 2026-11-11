'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { KeyRoundIcon } from 'lucide-react';
import { browserSupportsWebAuthn, browserSupportsWebAuthnAutofill, startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser';
import { Button } from '@/src/components/ui/button';
import { Spinner } from '@/src/components/ui/spinner';
import { FormMessage } from '@/src/components/app/FormMessage';
import { forgetPasskey, passkeyPromptError } from '@/src/components/app/passkeyCeremony';
import { passkeySignInAction, passkeySignInOptionsAction } from './passkeyActions';
import { LAST_USED_ID, LastUsedBadge } from './LastUsedBadge';

const subscribe = () => () => undefined;

/**
 * "Passkey" ("Sign in with a passkey" to assistive technologies), the first sign-in option, and with `autofill` (once the email form is
 * open) the passkeys the browser offers in the email field's autofill (conditional mediation: the
 * field has `autocomplete="email webauthn"`). Hidden in browsers without WebAuthn. Each prompt gets
 * a new challenge, which replaces the earlier one.
 */
export function PasskeySignIn({ next, autofill, lastUsed }: { next?: string; autofill: boolean; lastUsed?: boolean }) {
    const { t, language } = useAppI18n();
    // Rendered on the server as supported (nearly every browser is), so the card doesn't shift.
    const supported = useSyncExternalStore(subscribe, browserSupportsWebAuthn, () => true);
    const [error, setError] = useState<string>();
    const [pending, setPending] = useState(false);
    // Only the latest prompt may continue: the email step unmounting or a click replaces it.
    const generation = useRef(0);

    /** One prompt; resolves to whether the email field should offer passkeys again */
    async function prompt(autofill: boolean) {
        const current = ++generation.current;
        const options = await passkeySignInOptionsAction();
        if (current !== generation.current)
            return false;
        if (!options?.ok) {
            if (!autofill) setError(options?.error);
            return false;
        }
        let response;
        try {
            response = await startAuthentication({ optionsJSON: options.data, useBrowserAutofill: autofill });
        } catch (cause) {
            const message = passkeyPromptError(cause, 'sign-in');
            if (message && !autofill) setError(message);
            return !autofill && message !== null;
        }
        // A click replaced this prompt's challenge while the answer was on its way.
        if (current !== generation.current)
            return false;
        setPending(true);
        setError(undefined);
        // Returns only on failure; a successful sign-in continues to the next page.
        const result = await passkeySignInAction(response, next);
        setPending(false);
        setError(result.error);
        if (result.unknownCredential)
            forgetPasskey(result.unknownCredential.rpId, result.unknownCredential.credentialId);
        return true;
    }

    async function offerInAutofill() {
        if (!await browserSupportsWebAuthnAutofill())
            return;
        if (await prompt(true))
            void offerInAutofill();
    }

    async function signInWithButton() {
        setPending(true);
        setError(undefined);
        const again = await prompt(false);
        setPending(false);
        if (again)
            void offerInAutofill();
    }

    useEffect(() => {
        if (autofill && browserSupportsWebAuthn())
            void offerInAutofill();
        return () => {
            generation.current++;
            WebAuthnAbortService.cancelCeremony();
        };
        // Once the email field shows: each prompt restarts the autofill itself.
    }, [autofill]);

    if (!supported)
        return null;
    return (
        <>
            <Button type="button" variant="outline" size="lg" className="relative w-full" disabled={pending} onClick={() => void signInWithButton()}
                aria-label={t("Sign in with a passkey")} aria-describedby={lastUsed ? LAST_USED_ID : undefined}>
                {pending ? <Spinner data-icon="inline-start" /> : <KeyRoundIcon data-icon="inline-start" />}
                {t("Passkey")}{' '}{lastUsed && <LastUsedBadge />}
            </Button>
            <FormMessage state={error ? { ok: false, error } : null} />
        </>
    );
}
