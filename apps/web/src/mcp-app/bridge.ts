/** The MCP Apps 2026-01-26 iframe bridge. No credentials or direct network requests. */
type JsonObject = Record<string, unknown>;
export function object(value: unknown): JsonObject | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}
export class HostRequestError extends Error {}

export class AppBridge {
    private sequence = 0;
    private pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    private active = true;
    onNotification: (method: string, params: unknown) => void = () => {};

    constructor() { window.addEventListener('message', this.receive); }

    private receive = (event: MessageEvent) => {
        // Sandboxed hosts can have opaque origins. Bind to the actual parent window, never a
        // message from a sibling frame or arbitrary website. The host is the trust boundary.
        if (event.source !== window.parent || !this.active) return;
        const data = object(event.data);
        if (data?.jsonrpc !== '2.0') return;
        if (typeof data.method === 'string') {
            if (data.method === 'ping' || data.method === 'ui/resource-teardown') {
                this.post({ id: data.id, result: {} });
                if (data.method === 'ui/resource-teardown') {
                    this.onNotification(data.method, data.params);
                    this.dispose();
                }
            } else this.onNotification(data.method, data.params);
            return;
        }
        if (typeof data.id !== 'string') return;
        const pending = this.pending.get(data.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(data.id);
        if (data.error) pending.reject(new HostRequestError('The host could not complete this request.'));
        else pending.resolve(data.result);
    };

    private post(message: JsonObject) { window.parent.postMessage({ jsonrpc: '2.0', ...message }, '*'); }

    notify(method: string, params: JsonObject = {}) {
        if (this.active) this.post({ method, params });
    }

    request(method: string, params: JsonObject): Promise<unknown> {
        if (!this.active || window.parent === window) return Promise.reject(new Error('Open this card in a connected client.'));
        const id = `uier-${++this.sequence}`;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('The host did not respond.'));
            }, 15_000);
            this.pending.set(id, { resolve, reject, timer });
            this.post({ id, method, params });
        });
    }

    dispose() {
        this.active = false;
        window.removeEventListener('message', this.receive);
        for (const { timer, reject } of this.pending.values()) {
            clearTimeout(timer);
            reject(new Error('The card was closed.'));
        }
        this.pending.clear();
    }
}
