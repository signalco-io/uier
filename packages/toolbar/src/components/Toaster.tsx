import { useSyncExternalStore } from 'react';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Close } from '@signalco/ui-icons';
import { cx } from '@signalco/ui-primitives/cx';
import { destructiveTextClassName } from './@types/Comments';
import { InkScope } from './InkScope';

type Toast = { id: number; title: string; description?: string };

// One toolbar per page: a module store, so mutations can report a failure after their form is gone
let toasts: Toast[] = [];
let nextId = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const toastLifetimeMs = 8000;

function dismiss(id: number) {
    toasts = toasts.filter(toast => toast.id !== id);
    emit();
}

/** A failure the person should know about, e.g. a comment that was not posted after its form closed */
export function showErrorToast(title: string, description?: string) {
    const id = ++nextId;
    toasts = [...toasts.slice(-2), { id, title, description }];
    emit();
    window.setTimeout(() => dismiss(id), toastLifetimeMs);
}

/** The toolbar's notifications, above the pill (in the review layer's ink) */
export function Toaster() {
    const items = useSyncExternalStore(
        listener => { listeners.add(listener); return () => listeners.delete(listener); },
        () => toasts);
    if (!items.length) return null;
    return (
        <InkScope>
            <section aria-label="uier notifications" className="fixed bottom-20 left-1/2 z-[53] flex w-80 max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col gap-2">
                {items.map(toast => (
                    <div key={toast.id} role="alert" className="flex items-start gap-2 rounded-xl border bg-background p-3 text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.16)] animate-in fade-in slide-in-from-bottom-2">
                        <div className="min-w-0 flex-1">
                            <p className={cx('m-0 text-sm font-medium', destructiveTextClassName)}>{toast.title}</p>
                            {toast.description && <p className="m-0 mt-0.5 text-sm text-muted-foreground">{toast.description}</p>}
                        </div>
                        <IconButton size="xs" variant="plain" title="Dismiss" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
                            <Close size={14} />
                        </IconButton>
                    </div>
                ))}
            </section>
        </InkScope>
    );
}
