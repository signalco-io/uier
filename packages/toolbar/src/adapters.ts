import type { ToolbarConfig } from './config';
import type { CapturedScreenshot, ScreenshotRegion } from './screenshot';

/** Explicit runtime boundary for packaged clients. Never populated from the host page. */
export type ToolbarAdapters = {
    config: ToolbarConfig;
    request: (url: string, init?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; accept?: string }) => Promise<Response>;
    image: (url: string) => Promise<string>;
    capture: (region: ScreenshotRegion) => Promise<CapturedScreenshot>;
    draftStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
    signOut: () => Promise<void>;
};
let adapters: ToolbarAdapters | undefined;
export const runtimeAdapters = () => adapters;
export function configureToolbarRuntime(value: ToolbarAdapters) {
    if (adapters) throw new Error('Toolbar runtime already configured');
    adapters = value;
}
