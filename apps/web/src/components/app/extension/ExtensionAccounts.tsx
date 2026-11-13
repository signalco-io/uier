'use client';

import { useState, useTransition } from 'react';
import { useAppI18n } from '@/src/lib/i18n/client';
import { Button } from '@/src/components/ui/button';
import { Alert, AlertDescription } from '@/src/components/ui/alert';
import { changeAccount } from '../shell/accountSessions';

type Account = { id: string; name: string; email: string; active: boolean;
    projects?: { id: string; name: string; workspaceName: string }[] };

/** Only first-party, validated browser sessions reach this explicit account selection. */
export function ExtensionAccounts({ accounts, next, siteOrigin }: { accounts: Account[]; next: string; siteOrigin?: string }) {
    const { t } = useAppI18n();
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState('');
    if (accounts.length < 2 && !siteOrigin) return null;
    return <section aria-label={t('Signed-in accounts')} className="mb-6 flex flex-col gap-3">
        <p className="m-0 text-sm text-muted-foreground">{siteOrigin
            ? t('Projects for {site}', { site: siteOrigin }) : t('Signed-in accounts')}</p>
        {accounts.map(account => <div key={account.id} className="flex min-w-0 flex-col gap-1 rounded-lg border p-3">
            <p className="m-0 break-words text-sm font-medium">{account.name}</p>
            <p className="m-0 break-all text-xs text-muted-foreground">{account.email}</p>
            {account.projects && (account.projects.length ? <ul className="my-1 flex list-none flex-col gap-1 p-0 text-sm">
                {account.projects.map(project => <li key={project.id} className="break-words">{project.name} · {project.workspaceName}</li>)}
            </ul> : <p className="m-0 text-sm text-muted-foreground">{t('No project includes this address')}</p>)}
            {!account.active && <Button variant="outline" disabled={pending} onClick={() => {
                setError('');
                startTransition(async () => {
                    try { await changeAccount({ action: 'switch', userId: account.id, next }); }
                    catch (error) { setError(error instanceof Error ? error.message : 'Could not change accounts.'); }
                });
            }}>{t('Use this account')}</Button>}
            {account.active && <p className="m-0 text-xs text-muted-foreground">{t('active')}</p>}
        </div>)}
        {error && <Alert variant="destructive"><AlertDescription>{t(error)}</AlertDescription></Alert>}
    </section>;
}
