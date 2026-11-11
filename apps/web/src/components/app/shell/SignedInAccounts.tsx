'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/src/components/ui/button';
import type { BrowserAccount } from '@/src/lib/app/browserAccounts';
import { PersonAvatar } from '../PersonAvatar';
import { changeAccount } from './accountSessions';

/** Also usable when the primary credential expired but another account is still signed in. */
export function SignedInAccounts({ accounts, next }: { accounts: BrowserAccount[]; next?: string }) {
    const { t } = useAppI18n();
    const [pending, startTransition] = useTransition();
    if (!accounts.length) return null;
    return <section aria-label={t("Signed-in accounts")} className="flex w-full flex-col gap-3 border-b p-4">
        <h2 className="text-sm font-medium">{t("Signed-in accounts")}</h2>
        {accounts.map(account => <Button key={account.id} variant="ghost" disabled={pending}
            className="h-auto justify-start whitespace-normal py-2 text-left"
            onClick={() => startTransition(async () => {
                try { await changeAccount({ action: 'switch', userId: account.id, next }); }
                catch (error) { toast.error(error instanceof Error ? error.message : t("Could not change accounts.")); }
            })}>
            <PersonAvatar name={account.name} avatarUrl={account.avatarUrl} size="sm" aria-hidden="true" />
            <span className="grid min-w-0"><span className="truncate">{account.name}</span><span className="truncate text-xs text-muted-foreground">{account.email}</span></span>
        </Button>)}
    </section>;
}
