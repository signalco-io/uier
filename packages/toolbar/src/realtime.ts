/** Provider-neutral browser boundary, shared by the embedded toolbar and the app. */
export type RealtimeTicket = { url: string; token: string };
export type RealtimeEvent = { type: 'ready' | 'comments.changed' };

export type RealtimeSubscription = {
    ticket: () => Promise<RealtimeTicket | undefined>;
    changed: () => void;
    connected?: (value: boolean) => void;
    /** The toolbar already owns foreground reconciliation in its HTTP scheduler. */
    refreshOnForeground?: boolean;
};

/** One socket per active review/app view. Background tabs close instead of consuming Functions. */
export function subscribeToComments({ ticket, changed, connected, refreshOnForeground = true }: RealtimeSubscription) {
    let disposed = false;
    let generation = 0;
    let connecting = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let handshake: ReturnType<typeof setTimeout> | undefined;
    let notification: ReturnType<typeof setTimeout> | undefined;
    let delay = 1_000;
    const active = () => !disposed && document.visibilityState === 'visible' && navigator.onLine;
    const notify = () => {
        if (notification) return;
        notification = setTimeout(() => { notification = undefined; if (active()) changed(); }, 150);
    };
    const stop = () => {
        generation++;
        connecting = false;
        clearTimeout(retry); retry = undefined;
        clearTimeout(handshake); handshake = undefined;
        clearTimeout(notification); notification = undefined;
        const previous = socket;
        socket = undefined;
        previous?.close();
        connected?.(false);
    };
    const schedule = () => {
        if (!active() || retry) return;
        retry = setTimeout(() => { retry = undefined; void connect(); }, delay + Math.random() * delay * 0.25);
        delay = Math.min(delay * 2, 30_000);
    };
    const connect = async () => {
        if (!active() || connecting || socket) return;
        connecting = true;
        const attempt = ++generation;
        try {
            const capability = await ticket();
            if (attempt !== generation || !active()) return;
            if (!capability) throw new Error('Realtime unavailable.');
            // Only the authenticated API chooses the transport endpoint. No identity in its URL.
            const url = new URL(capability.url);
            if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
                throw new Error('Invalid realtime endpoint.');
            const current = new WebSocket(url);
            let ready = false;
            socket = current;
            handshake = setTimeout(() => current.close(), 8_000);
            current.onopen = () => {
                if (attempt !== generation || !active()) { current.close(); return; }
                current.send(JSON.stringify({ type: 'subscribe', token: capability.token }));
            };
            current.onmessage = event => {
                if (attempt !== generation || !active() || typeof event.data !== 'string' || event.data.length > 128) return;
                try {
                    const data = JSON.parse(event.data) as { type?: unknown } | null;
                    if (data?.type === 'ready') {
                        ready = true;
                        clearTimeout(handshake); handshake = undefined;
                        delay = 1_000;
                        connected?.(true);
                        // Subscribe, then read: covers edits between the initial HTTP snapshot and
                        // the subscription, and anything missed during a disconnect or deployment.
                        notify();
                    } else if (data?.type === 'comments.changed') notify();
                } catch { /* Ignore unknown provider frames. */ }
            };
            current.onerror = () => current.close();
            current.onclose = () => {
                if (attempt !== generation) return;
                clearTimeout(handshake); handshake = undefined;
                socket = undefined;
                connected?.(false);
                // An ended authorized session can mean revoked access. Reconcile it immediately;
                // failed upgrades keep the normal polling cadence instead of causing read bursts.
                if (ready) notify();
                schedule();
            };
        } catch {
            if (attempt === generation) { connected?.(false); schedule(); }
        } finally { if (attempt === generation) connecting = false; }
    };
    const foreground = () => {
        if (!active()) { stop(); return; }
        // Focus can occur while a healthy connection is open. Reuse it and reconcile HTTP state.
        if (refreshOnForeground) notify();
        if (!socket && !connecting) { clearTimeout(retry); retry = undefined; void connect(); }
    };
    document.addEventListener('visibilitychange', foreground);
    window.addEventListener('online', foreground);
    window.addEventListener('offline', foreground);
    window.addEventListener('focus', foreground);
    void connect();
    return () => {
        disposed = true;
        stop();
        document.removeEventListener('visibilitychange', foreground);
        window.removeEventListener('online', foreground);
        window.removeEventListener('offline', foreground);
        window.removeEventListener('focus', foreground);
    };
}
