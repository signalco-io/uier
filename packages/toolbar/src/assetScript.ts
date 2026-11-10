import { runtimeAdapters } from './adapters';
import { toolbarConfig } from './config';

// The review script, read while it runs: the assets published next to it (the audit and the languages)
// get its nonce and referrer policy, like the review script got the loader's (src/index.ts).
const reviewScript = runtimeAdapters() || typeof document === 'undefined' ? null
    : document.currentScript instanceof HTMLScriptElement ? document.currentScript : null;

/**
 * Adds one of the review bundle's published assets as a classic, integrity-checked script, like the
 * review script itself, so a site's CSP that allows the toolbar allows it too. `prepare` puts the
 * asset's handoff callback on the script element; `received` reads what it handed over once it ran.
 */
export function addAssetScript<T>(
    { path, integrity, prepare, received, errors }: {
        path: string;
        integrity: string;
        prepare: (script: HTMLScriptElement) => void;
        received: () => T | undefined;
        errors: { notStarted: string; notLoaded: string };
    }
) {
    return new Promise<T>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = new URL(path, reviewScript?.src || `${toolbarConfig.apiUrl}/toolbar.js`).href;
        script.async = true;
        script.integrity = integrity;
        if (script.integrity) script.crossOrigin = 'anonymous';
        if (reviewScript?.nonce) script.nonce = reviewScript.nonce;
        if (reviewScript?.referrerPolicy) script.referrerPolicy = reviewScript.referrerPolicy;
        prepare(script);
        script.onload = () => {
            script.remove();
            const value = received();
            if (value) resolve(value);
            else reject(new Error(errors.notStarted));
        };
        script.onerror = () => {
            script.remove();
            reject(new Error(errors.notLoaded));
        };
        (document.head ?? document.documentElement).appendChild(script);
    });
}
