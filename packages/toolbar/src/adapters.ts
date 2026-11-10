import type { ToolbarConfig } from './config';
import type { CapturedScreenshot, ScreenshotRegion } from './screenshot';
import type { AuditAsset } from './checks/auditHandoff';
import type { ToolbarLanguage } from './languages';
import type { LanguageAsset } from './i18n/languageHandoff';

/** Explicit runtime boundary for packaged clients. Never populated from the host page. */
export type ToolbarAdapters = {
    config: ToolbarConfig;
    request: (url: string, init?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; accept?: string }) => Promise<Response>;
    image: (url: string) => Promise<string>;
    capture: (region: ScreenshotRegion) => Promise<CapturedScreenshot>;
    draftStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
    signOut: () => Promise<void>;
    /**
     * Runs the audit asset packaged with the client (axe-core and the on-demand page checks) in the
     * toolbar's own world, and resolves with what it hands over. Called only when a check runs, and
     * again after a failure (`checks/axeLoader.ts`). Never a remote script or a page-visible global:
     * without it, the client has no audit (no Accessibility button, on-demand sections `unavailable`).
     */
    loadAudit?: () => Promise<AuditAsset>;
    /**
     * A language other than English, packaged with the client (`i18n/packaged.ts`): the web loads it as an
     * asset next to the review bundle, a packaged client never adds remote scripts. Without it, English.
     */
    loadLanguage?: (language: ToolbarLanguage) => Promise<LanguageAsset>;
};
let adapters: ToolbarAdapters | undefined;
export const runtimeAdapters = () => adapters;
export function configureToolbarRuntime(value: ToolbarAdapters) {
    if (adapters) throw new Error('Toolbar runtime already configured');
    adapters = value;
}
