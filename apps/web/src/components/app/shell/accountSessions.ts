'use client';

const changedKey = 'uier:account-changed';
export const accountChangedKey = changedKey;

/** Every identity change leaves the current React tree and router cache behind. */
export async function changeAccount(input: { action: 'switch'; userId: string; next?: string } | { action: 'sign-out' | 'sign-out-all' }) {
    const response = await fetch('/api/account/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
    });
    const result = await response.json() as { next: string; message?: string };
    if (!response.ok) throw new Error(result.message ?? 'Could not change accounts. Try again.');
    try { localStorage.setItem(changedKey, crypto.randomUUID()); } catch { /* Focus checks cover blocked storage. */ }
    window.location.assign(result.next);
}
