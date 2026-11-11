'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useState } from 'react';
import { Button } from '@/src/components/ui/button';
import { Spinner } from '@/src/components/ui/spinner';
import type { ActionState } from '../../lib/app/actionResult';
import { FormMessage } from './FormMessage';

/**
 * The values of a settings form against the `saved` ones (the server's, after normalization). A
 * successful save (`result`) or new saved values start the draft over from what was saved, so the
 * form shows what the server kept and has no changes left.
 */
export function useSettingsDraft<T>(saved: T, result: ActionState<unknown>) {
    const savedKey = JSON.stringify(saved);
    const [state, setState] = useState({ savedKey, result, draft: saved });
    let current = state;
    if (state.savedKey !== savedKey || (state.result !== result && result?.ok)) {
        current = { savedKey, result, draft: saved };
        setState(current);
    } else if (state.result !== result) {
        current = { ...state, result };
        setState(current);
    }

    return {
        draft: current.draft,
        dirty: JSON.stringify(current.draft) !== savedKey,
        update: (change: (draft: T) => T) => setState(previous => ({ ...previous, draft: change(previous.draft) })),
        discard: () => setState(previous => ({ ...previous, draft: saved }))
    };
}

/**
 * The footer of a settings form, its only save: the outcome or "Unsaved changes" on the left,
 * Discard and Save (of the form `formId`) on the right. Save is off until something changed.
 */
export function SaveFooter({ formId, state, pending, dirty, onDiscard }: {
    formId: string;
    state: ActionState<unknown>;
    pending: boolean;
    dirty: boolean;
    onDiscard: () => void;
}) {
    const { t, language } = useAppI18n();
    return (
        <>
            {/* A failed save keeps the changes, so its error shows while they do; Discard clears both */}
            <div className="mr-auto min-w-0">
                {dirty
                    ? state && !state.ok
                        ? <FormMessage state={state} />
                        : <p className="m-0 flex items-center gap-2 text-sm font-medium"><span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-[hsl(var(--brand-warning))]" />{t("Unsaved changes")}</p>
                    : state?.ok && <FormMessage state={state} />}
            </div>
            {dirty && !pending && <Button variant="ghost" onClick={onDiscard}>{t("Discard")}</Button>}
            <Button type="submit" form={formId} disabled={!dirty || pending}>
                {pending && <Spinner data-icon="inline-start" />}
                {t("Save")}{' '}</Button>
        </>
    );
}
