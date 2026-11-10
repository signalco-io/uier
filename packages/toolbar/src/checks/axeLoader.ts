import { runtimeAdapters, type ToolbarAdapters } from '../adapters';
import { addAssetScript } from '../assetScript';
import { auditHandoffKey, type AuditAsset, type AuditScript, type AxeApi } from './auditHandoff';
import type { LazyChecks } from './lazy';
import { checkMessages, toolbarLanguage } from '../i18n';

/**
 * Whether the audit asset (the accessibility audit and the on-demand page checks) can load here: on
 * the web, from its published path; in packaged clients (the browser extension), which never inject
 * a remote script, only where the client packages it (`ToolbarAdapters.loadAudit`).
 */
export function auditAvailable() {
    const adapters = runtimeAdapters();
    return adapters ? Boolean(adapters.loadAudit) : Boolean(__UIER_AUDIT_PATH__);
}

let pending: Promise<AuditAsset> | undefined;

/**
 * Loads the audit asset, once: axe-core and the on-demand page checks. On the web it is
 * content-addressed and integrity-checked, added as a classic script like the review script itself,
 * so a site's CSP that allows the toolbar allows it too; a packaged client runs its own packaged copy
 * (`packagedAudit`). A failed load lets a later request try again.
 */
export function loadAudit(): Promise<AuditAsset> {
    return loadedAudit().then(asset => {
        // The checks that run next write in the toolbar's language (an older packaged asset has no locale: English)
        asset.checks.locale?.use(toolbarLanguage(), checkMessages());
        return asset;
    });
}

function loadedAudit(): Promise<AuditAsset> {
    if (pending) return pending;
    const adapters = runtimeAdapters();
    const attempt = adapters ? packagedAudit(adapters) : scriptAudit();
    pending = attempt;
    void attempt.catch(() => {
        if (pending === attempt) pending = undefined;
    });
    return attempt;
}

/** A packaged client's own copy of the asset, never a script added to the page */
async function packagedAudit({ loadAudit }: ToolbarAdapters): Promise<AuditAsset> {
    if (!loadAudit) throw new Error('Accessibility checks are not available here.');
    const asset = await loadAudit();
    if (!asset?.axe || !asset.checks) throw new Error('The accessibility checks did not start.');
    return asset;
}

/** The web's asset: a classic script from the published path, next to the review script */
function scriptAudit() {
    if (!auditAvailable())
        return Promise.reject(new Error('Accessibility checks are not available here.'));
    let loaded: AuditAsset | undefined;
    return addAssetScript<AuditAsset>({
        path: __UIER_AUDIT_PATH__,
        integrity: __UIER_AUDIT_INTEGRITY__,
        prepare: script => { (script as AuditScript)[auditHandoffKey] = (axe, checks) => { loaded = { axe, checks }; }; },
        received: () => loaded,
        errors: { notStarted: 'The accessibility checks did not start.', notLoaded: 'The accessibility checks could not be loaded.' }
    });
}

/** axe-core, from the audit asset */
export function loadAxe(): Promise<AxeApi> {
    return loadAudit().then(asset => asset.axe);
}

/** The page checks that run on demand (`lazy/index.ts`), from the audit asset */
export function loadChecks(): Promise<LazyChecks> {
    return loadAudit().then(asset => asset.checks);
}
