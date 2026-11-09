import { useSyncExternalStore } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Close, ExternalLink } from '@signalco/ui-icons';
import { cx } from '@signalco/ui-primitives/cx';
import { destructiveTextClassName } from './@types/Comments';
import { InkScope } from './InkScope';

/** A link the toast offers, opened in a new tab (uier's pages, never the reviewed site's) */
export type ToastAction = { label: string; href: string };

type Toast = { id: number; title: string; description?: string; action?: ToastAction };

// One toolbar per page: a module store, so mutations can report a failure after their form is gone
let toasts: Toast[] = [];
let nextId = 0;
const listeners = new Set<() => void>();
const timers = new Map<number, number>();
const emit = () => listeners.forEach(listener => listener());
const toastLifetimeMs = 8000;
/** A toast with a link stays longer: reading it and deciding to open the link takes time */
const actionToastLifetimeMs = 15000;

function dismiss(id: number) {
    window.clearTimeout(timers.get(id));
    timers.delete(id);
    toasts = toasts.filter(toast => toast.id !== id);
    emit();
}

function scheduleDismiss(toast: Toast) {
    window.clearTimeout(timers.get(toast.id));
    timers.set(toast.id, window.setTimeout(() => dismiss(toast.id), toast.action ? actionToastLifetimeMs : toastLifetimeMs));
}

/** Kept while the pointer is on the toast or focus is in it, so it never goes away under the person */
function hold(id: number) {
    window.clearTimeout(timers.get(id));
    timers.delete(id);
}

/** A failure the person should know about, e.g. a comment that was not posted after its form closed */
export function showErrorToast(title: string, description?: string, action?: ToastAction) {
    const toast = { id: ++nextId, title, description, action };
    toasts = [...toasts.slice(-2), toast];
    emit();
    scheduleDismiss(toast);
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
                    <div
                        key={toast.id}
                        role="alert"
                        className="flex items-start gap-2 rounded-xl border bg-background p-3 text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.16)] animate-in fade-in slide-in-from-bottom-2"
                        onPointerEnter={() => hold(toast.id)}
                        onPointerLeave={event => { if (!event.currentTarget.matches(':focus-within')) scheduleDismiss(toast); }}
                        onFocus={() => hold(toast.id)}
                        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) scheduleDismiss(toast); }}>
                        <div className="min-w-0 flex-1">
                            <p className={cx('m-0 text-sm font-medium', destructiveTextClassName)}>{toast.title}</p>
                            {toast.description && <p className="m-0 mt-0.5 text-sm text-muted-foreground">{toast.description}</p>}
                            {toast.action && (
                                <Button
                                    variant="outlined"
                                    size="xs"
                                    className="mt-2"
                                    href={toast.action.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    endDecorator={<ExternalLink size={14} />}
                                    onClick={() => dismiss(toast.id)}>
                                    {toast.action.label}
                                </Button>
                            )}
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
