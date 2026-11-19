'use client';

import { useId, useRef, useState, useTransition } from 'react';
import { LogInIcon } from 'lucide-react';
import { destructiveTextClassName, Section } from '@/src/components/app/PageHeader';
import { accountTitles } from '@/src/components/app/account/accountSections';
import { changeAccount } from '@/src/components/app/shell/accountSessions';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/src/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Field, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Spinner } from '@/src/components/ui/spinner';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import { DELETE_ACCOUNT_SIGN_IN_AGAIN } from '@/src/lib/app/limits';
import { useAppI18n } from '@/src/lib/i18n/client';
import { cn } from '@/src/lib/utils';

/**
 * Account → General's last card. Deleting needs a recent sign-in (`recentSignIn`, as the page rendered) and the
 * account's email typed. The server checks both again, and answers with every workspace that needs a handoff
 * first, one per line.
 */
export function DeleteAccountSection({ email, userId, recentSignIn }: { email: string; userId: string; recentSignIn: boolean }) {
    const { t } = useAppI18n();
    const [open, setOpen] = useState(false);
    const [confirmation, setConfirmation] = useState('');
    const [problems, setProblems] = useState<string[]>([]);
    // The sign-in got too old while the page was open
    const [expired, setExpired] = useState(false);
    const [pending, startTransition] = useTransition();
    // Deleted: the browser is on its way to the next page, so nothing can be sent again
    const [leaving, setLeaving] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    const inputId = useId();
    const busy = pending || leaving;
    const signInAgain = !recentSignIn || expired;
    const confirmed = confirmation.trim().toLowerCase() === email;
    const title = t(accountTitles.deleteAccount);
    return (
        <Section id="delete-account" title={title}>
            {/* The row of a project's danger zone: what it does, then its button, under it on a phone */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="m-0 min-w-0 flex-1 basis-64 text-sm text-muted-foreground">
                    {t("Removes your profile, sign-in methods and workspace access. Projects and feedback stay in their workspaces. This can't be undone.")}
                </p>
                <AlertDialog open={open} onOpenChange={next => {
                    if (busy) return;
                    setOpen(next);
                    setConfirmation('');
                    setProblems([]);
                }}>
                    {/* Outlined like a project's Delete; the destructive variant's tinted fill leaves its red text under 4.5:1 */}
                    <AlertDialogTrigger render={<Button variant="outline" className={destructiveTextClassName} />}>{title}</AlertDialogTrigger>
                    <AlertDialogContent initialFocus={signInAgain ? undefined : input} className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
                        <form className="contents" onSubmit={event => {
                            event.preventDefault();
                            if (!confirmed || busy || signInAgain) return;
                            setProblems([]);
                            startTransition(async () => {
                                try {
                                    await changeAccount({ action: 'delete-account', expectedUserId: userId, confirmation });
                                    setLeaving(true);
                                } catch (failure) {
                                    const message = failure instanceof Error ? failure.message : 'Something went wrong. Try again.';
                                    if (message === DELETE_ACCOUNT_SIGN_IN_AGAIN) setExpired(true);
                                    else setProblems(message.split('\n').filter(Boolean));
                                }
                            });
                        }}>
                            <AlertDialogHeader>
                                <AlertDialogTitle>{t('Delete your account?')}</AlertDialogTitle>
                                <AlertDialogDescription>
                                    {t('Your profile, sign-in methods and workspace access will be removed. Projects and feedback stay in their workspaces. Empty workspaces where you are the only member will close. This is permanent.')}
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            {signInAgain
                                ? <p className="m-0 text-sm">{t('To delete your account, sign in again. Deleting it needs a sign-in from the last 10 minutes.')}</p>
                                : (
                                    <Field>
                                        {/* An address has no spaces to wrap at */}
                                        <FieldLabel htmlFor={inputId} className="[overflow-wrap:anywhere]">{t('Type {email} to confirm.', { email })}</FieldLabel>
                                        <Input ref={input} id={inputId} type="email" value={confirmation} onChange={event => setConfirmation(event.target.value)}
                                            autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy} />
                                    </Field>
                                )}
                            {problems.length > 0 && !signInAgain && (
                                <div role="alert" className={cn('text-sm', destructiveTextClassName)}>
                                    {problems.length === 1
                                        ? <p className="m-0">{t(problems[0]!)}</p>
                                        : <ul className="m-0 flex list-disc flex-col gap-1 pl-5">{problems.map(problem => <li key={problem}>{t(problem)}</li>)}</ul>}
                                </div>
                            )}
                            <AlertDialogFooter>
                                <AlertDialogCancel disabled={busy}>{t('Cancel')}</AlertDialogCancel>
                                {signInAgain
                                    ? (
                                        <a className={buttonVariants()} href={KnownPageLinks.signInAgain(KnownPages.AppAccount)}>
                                            <LogInIcon data-icon="inline-start" />{t('Sign in again')}
                                        </a>
                                    )
                                    : (
                                        <Button type="submit" variant="outline" className={destructiveTextClassName} disabled={!confirmed || busy}>
                                            {busy && <Spinner data-icon="inline-start" />}{title}
                                        </Button>
                                    )}
                            </AlertDialogFooter>
                        </form>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </Section>
    );
}
