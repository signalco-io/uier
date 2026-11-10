import { runtimeAdapters } from '../adapters';
import { toolbarConfig } from '../config';
import { auditHandoffKey, type AuditAsset, type AuditScript, type AxeApi } from './auditHandoff';
import type { LazyChecks } from './lazy';

// The review script, read while it runs: the audit asset is published next to it, and gets its
// nonce and referrer policy like the review script got the loader's (src/index.ts).
const reviewScript = runtimeAdapters() ? null : document.currentScript instanceof HTMLScriptElement ? document.currentScript : null;

/**
 * Whether the accessibility audit can load here. Packaged clients (the browser extension) never
 * inject a remote script, so they have no audit.
 */
export function auditAvailable() {
    return !runtimeAdapters() && Boolean(__UIER_AUDIT_PATH__);
}

let pending: Promise<AuditAsset> | undefined;

/**
 * Loads the audit asset, once: axe-core and the on-demand page checks, content-addressed and
 * integrity-checked, as a classic script like the review script itself, so a site's CSP that allows
 * the toolbar allows it too. A failed load lets a later request try again.
 */
export function loadAudit(): Promise<AuditAsset> {
    if (pending) return pending;
    const attempt = new Promise<AuditAsset>((resolve, reject) => {
        if (!auditAvailable()) {
            reject(new Error('Accessibility checks are not available here.'));
            return;
        }
        let loaded: AuditAsset | undefined;
        const script: AuditScript = document.createElement('script');
        script.src = new URL(__UIER_AUDIT_PATH__, reviewScript?.src || `${toolbarConfig.apiUrl}/toolbar.js`).href;
        script.async = true;
        script.integrity = __UIER_AUDIT_INTEGRITY__;
        if (script.integrity) script.crossOrigin = 'anonymous';
        if (reviewScript?.nonce) script.nonce = reviewScript.nonce;
        if (reviewScript?.referrerPolicy) script.referrerPolicy = reviewScript.referrerPolicy;
        script[auditHandoffKey] = (axe, checks) => { loaded = { axe, checks }; };
        script.onload = () => {
            script.remove();
            if (loaded) resolve(loaded);
            else reject(new Error('The accessibility checks did not start.'));
        };
        script.onerror = () => {
            script.remove();
            reject(new Error('The accessibility checks could not be loaded.'));
        };
        (document.head ?? document.documentElement).appendChild(script);
    });
    pending = attempt;
    void attempt.catch(() => {
        if (pending === attempt) pending = undefined;
    });
    return attempt;
}

/** axe-core, from the audit asset */
export function loadAxe(): Promise<AxeApi> {
    return loadAudit().then(asset => asset.axe);
}

/** The page checks that run on demand (`lazy/index.ts`), from the audit asset */
export function loadChecks(): Promise<LazyChecks> {
    return loadAudit().then(asset => asset.checks);
}
