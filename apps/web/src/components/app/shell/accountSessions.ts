'use client';

import { beginShellSwitch, endShellSwitch, forgetCurrentShell, forgetShells, liveShell, restoreCurrentShell, selectAccountShell } from '@/src/lib/app/shellCache';

const changedKey = 'uier:account-changed';
export const accountChangedKey = changedKey;

/**
 * Every identity change leaves the current React tree and router cache behind. A switch draws the account's copy of
 * the shell at once when this browser has one, and the next document starts from it (`shellCache`); signing out
 * or deleting the account removes the account's copies, and every copy once no account is left.
 */
export async function changeAccount(input: { action: 'switch'; userId: string; next?: string } | { action: 'open-project-link'; next: string } | { action: 'delete-account'; expectedUserId: string; confirmation: string } | { action: 'sign-out' | 'sign-out-all' }) {
    const signedOut = liveShell()?.userId;
    if (input.action === 'switch') {
        const destination = await selectAccountShell(input.userId);
        if (destination)
            void beginShellSwitch(destination);
    }
    let result: { next: string; message?: string };
    try {
        const response = await fetch('/api/account/sessions', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
        });
        result = await response.json() as { next: string; message?: string };
        if (!response.ok) throw new Error(result.message ?? 'Could not change accounts. Try again.');
    } catch (error) {
        endShellSwitch();
        await restoreCurrentShell();
        throw error;
    }
    // A deleted account leaves this browser like one that signed out, and its id is known without the live shell
    const leaves = input.action === 'sign-out' || input.action === 'delete-account';
    const left = input.action === 'delete-account' ? input.expectedUserId : signedOut;
    if (input.action === 'sign-out-all' || (leaves && (!left || result.next.startsWith('/app/sign-in'))))
        await forgetShells();
    else if (leaves)
        await forgetShells(left);
    else if (input.action === 'open-project-link')
        await forgetCurrentShell();
    try { localStorage.setItem(changedKey, crypto.randomUUID()); } catch { /* Focus checks cover blocked storage. */ }
    window.location.assign(result.next);
}
