'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import { useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Button } from '@/src/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/src/components/ui/dialog';
import { Spinner } from '@/src/components/ui/spinner';
import { FormMessage } from '../FormMessage';
import type { ActionState } from '@/src/lib/app/actionResult';

export function ConfirmAccess({
    label,
    accessibleName,
    size,
    title,
    description,
    children,
    action,
    onSuccess,
    disabled
}: {
    label: string;
    /** When the label alone is ambiguous, such as one Remove per row */
    accessibleName?: string;
    size?: 'sm';
    title: string;
    description: string;
    children?: ReactNode;
    action: () => Promise<ActionState<unknown>>;
    onSuccess?: () => void;
    disabled?: boolean;
}) {
    const { t } = useAppI18n();
    const [open, setOpen] = useState(false),
        [pending, startTransition] = useTransition();
    const [result, setResult] = useState<ActionState<unknown>>(null);
    const router = useRouter();
    return (
        <Dialog
            open={open}
            onOpenChange={(value) => {
                if (!pending) {
                    setOpen(value);
                    if (value) setResult(null);
                }
            }}
        >
            <DialogTrigger render={<Button type="button" variant="outline" size={size} aria-label={accessibleName} disabled={disabled || pending} />}>
                {label}
            </DialogTrigger>
            <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                {children}
                <FormMessage state={result?.ok ? { ok: true, data: undefined, message: t("Access updated.") } : result} />
                <DialogFooter>
                    <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>{t("Cancel")}</Button>
                    <Button
                        disabled={pending}
                        onClick={() =>
                            startTransition(async () => {
                                const outcome = await action();
                                setResult(outcome);
                                if (outcome?.ok) {
                                    toast.success(t("Changes processed."));
                                    setOpen(false);
                                    router.refresh();
                                    onSuccess?.();
                                }
                            })
                        }
                    >
                        {pending && <Spinner />}{t("Confirm changes")}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
