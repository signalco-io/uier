'use client';

import { useId, useOptimistic, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/src/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/src/components/ui/field';
import { Spinner } from '@/src/components/ui/spinner';
import { Switch } from '@/src/components/ui/switch';
import type { ActionState } from '@/src/lib/app/actionResult';
import { useAppI18n } from '@/src/lib/i18n/client';
import { FormMessage } from '../FormMessage';
import { IntegrationDetail } from './IntegrationDetails';
import { MoreOptions } from './MoreOptions';

type Operation = 'enable' | 'disable' | 'disconnect' | 'backfill';
type Result = ActionState<{ message: string }>;

/** The one switch of a connection that people change, saved at once: its name and what turning it off keeps */
export function ConnectionSwitch({ label, description, checked, disabled, onCheckedChange }: {
    label: string; description: string; checked: boolean; disabled?: boolean; onCheckedChange: (checked: boolean) => void;
}) {
    const id = useId();
    return <Field orientation="horizontal">
        <FieldContent>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <FieldDescription>{description}</FieldDescription>
        </FieldContent>
        <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </Field>;
}

/** The backfill row of a connection's details: how many of the selected threads are queued so far */
export function BackfillDetail({ backfill }: { backfill?: { queued: number; total?: number; done: boolean } }) {
    const { t } = useAppI18n();
    if (!backfill) return null;
    return <IntegrationDetail term={t("Backfill")}>
        {backfill.queued}{backfill.total === undefined ? ' ' : <> {t("of")}{' '}{backfill.total} </>}{t("selected threads queued for delivery.")}{' '}
        {backfill.done ? t("Queueing is complete.") : t("Queueing continues in the background.")}
    </IntegrationDetail>;
}

/**
 * What every issue and page connection is managed with, in the order of the card: the Sync switch that saves
 * at once, the outcome of an action, then the rare actions (backfill, reconnect, disconnect) under More options.
 * The provider names its buttons and adds its own notes; the manage action is the provider's.
 */
export function ConnectionControls({ projectId, manage, sync, backfill, reconnect, disconnect, children }: {
    projectId: string;
    manage: (state: Result, form: FormData) => Promise<Result>;
    /** The Sync switch; left out while there is nothing to turn on or off */
    sync?: { checked: boolean };
    /** Left out while a backfill cannot start; off while one is still queueing */
    backfill?: { label: string; queueing: boolean };
    /** A reconnect nothing asks for. One the connection needs belongs on the card itself */
    reconnect?: { label: string; href: string };
    disconnect: { label: string; title: string; description: string };
    /** The provider's notes and its own rare actions, under the shared ones */
    children?: ReactNode;
}) {
    const { t } = useAppI18n();
    const router = useRouter();
    const [pending, start] = useTransition();
    const [operation, setOperation] = useState<Operation | null>(null);
    const [result, setResult] = useState<Result>(null);
    const [confirming, setConfirming] = useState(false);
    const [checked, setChecked] = useOptimistic(sync?.checked ?? false);
    function change(next: Operation) {
        setOperation(next);
        start(async () => {
            const toggled = next === 'enable' || next === 'disable';
            if (toggled) setChecked(next === 'enable');
            const form = new FormData(); form.set('projectId', projectId); form.set('operation', next);
            const response = await manage(null, form);
            // The switch and the badge show on and off themselves; say only what nothing else shows
            setResult(response?.ok && toggled ? null : response);
            if (response?.ok) { setConfirming(false); router.refresh(); }
        });
    }
    return <>
        {sync && <ConnectionSwitch label={t("Sync")} description={t("Pause sync without disconnecting. Existing copies stay.")}
            checked={checked} disabled={pending} onCheckedChange={on => change(on ? 'enable' : 'disable')} />}
        <FormMessage state={result?.ok ? { ...result, message: result.data.message } : result} />
        <MoreOptions>
            <div className="flex flex-wrap gap-2">
                {backfill && <Button type="button" variant="outline" disabled={pending || backfill.queueing} onClick={() => change('backfill')}>
                    {pending && operation === 'backfill' && <Spinner data-icon="inline-start" />}{backfill.label}
                </Button>}
                {reconnect && <a href={reconnect.href} className={buttonVariants({ variant: 'outline' })}>
                    {reconnect.label}<ArrowUpRight data-icon="inline-end" />
                </a>}
                <AlertDialog open={confirming} onOpenChange={setConfirming}>
                    <AlertDialogTrigger render={<Button type="button" variant="outline" disabled={pending} />}>{disconnect.label}</AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>{disconnect.title}</AlertDialogTitle>
                            <AlertDialogDescription>{disconnect.description}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <FormMessage state={result && !result.ok ? result : null} />
                        <AlertDialogFooter>
                            <AlertDialogCancel disabled={pending}>{t("Keep connected")}</AlertDialogCancel>
                            <AlertDialogAction variant="outline" disabled={pending} onClick={() => change('disconnect')}>
                                {pending && <Spinner data-icon="inline-start" />}{disconnect.label}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
            {children}
        </MoreOptions>
    </>;
}

/** A note under More options: what an action selects, what stays private, whose settings the copies follow */
export function ConnectionNote({ children }: { children: ReactNode }) {
    return <p className="m-0 text-sm text-muted-foreground">{children}</p>;
}
