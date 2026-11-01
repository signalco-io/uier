import { toolbarConfig } from './config';
import { getToolbarHost } from './mount';
import { openFeedbackEvent } from './openFeedback';
import { backgroundSignIn } from './project/backgroundSession';
import { startInstallationCheck } from './project/installationCheck';
import { getReviewToken, setReviewToken } from './project/projectSession';
import { backgroundReviewExited, resolveReviewSession, startBackgroundReview } from './review';
import { runtimeContext, runtimeContextKey, type MountToolbar, type RuntimeScript } from './runtimeContext';

const source = document.currentScript as HTMLScriptElement | null;
runtimeContext.config = toolbarConfig;
startInstallationCheck();

// Repeated embeds and feedback requests share an in-flight download and the loaded mount.
const loaderKey = Symbol.for('uier.toolbar.loader');
const loaders = window as unknown as { [loaderKey]?: Promise<MountToolbar> };

function loadToolbar(): Promise<MountToolbar> {
    if (loaders[loaderKey]) return loaders[loaderKey];
    const pending = new Promise<MountToolbar>((resolve, reject) => {
        const script: RuntimeScript = document.createElement('script');
        script.src = new URL(__UIER_REVIEW_PATH__, source?.src || `${toolbarConfig.apiUrl}/toolbar.js`).href;
        script.async = true;
        script.integrity = __UIER_REVIEW_INTEGRITY__;
        if (script.integrity) script.crossOrigin = 'anonymous';
        if (source?.nonce) script.nonce = source.nonce;
        if (source?.referrerPolicy) script.referrerPolicy = source.referrerPolicy;
        script[runtimeContextKey] = runtimeContext;
        script.onload = () => {
            script.remove();
            if (runtimeContext.mount) resolve(runtimeContext.mount);
            else reject(new Error('The review script did not initialize.'));
        };
        script.onerror = () => {
            script.remove();
            reject(new Error('The review script could not be loaded.'));
        };
        document.head.appendChild(script);
    });
    loaders[loaderKey] = pending;
    void pending.catch(() => {
        if (loaders[loaderKey] === pending) delete loaders[loaderKey];
    });
    return pending;
}

function whenBodyReady(callback: () => void) {
    if (document.body) callback();
    else document.addEventListener('DOMContentLoaded', callback, { once: true });
}

function openToolbar(mode: Parameters<MountToolbar>[0], review: Parameters<MountToolbar>[1]) {
    whenBodyReady(() => {
        if (getToolbarHost()) return;
        void loadToolbar().then(mount => mount(mode, review)).catch(error => {
            console.warn('uier-toolbar: Could not open the toolbar', error);
        });
    });
}

if (toolbarConfig.mode === 'showcase') {
    const review = resolveReviewSession();
    openToolbar(review ? 'review' : 'showcase', review);
} else if (toolbarConfig.mode === 'feedback') {
    window.addEventListener(openFeedbackEvent, () => openToolbar('feedback', null));
    openToolbar('feedback', null);
} else {
    const review = resolveReviewSession();
    if (review) {
        openToolbar('review', review);
    } else if (toolbarConfig.project && !backgroundReviewExited()) {
        whenBodyReady(() => {
            // Ordinary visitors get only the bounded account bridge. Fetch the review UI only
            // after the API confirms this identity is a member who can comment.
            void backgroundSignIn().then(async signedIn => {
                if (!signedIn) return;
                const readInfo = async () => {
                    const response = await fetch(`${toolbarConfig.apiUrl}/api/review/${toolbarConfig.project}`, {
                        // This check only asks whether a saved/bridged token is still a member.
                        // Guest identity belongs to the review UI and is not needed here.
                        credentials: 'omit', headers: { Authorization: `Bearer ${getReviewToken()}` }
                    });
                    return response.ok ? response.json() : undefined;
                };
                let info = await readInfo();
                if (info && getReviewToken() && info.viewer?.kind !== 'member') {
                    setReviewToken(undefined);
                    if (await backgroundSignIn()) info = await readInfo();
                }
                if (info?.viewer?.kind !== 'member' || info.canComment !== true) return;
                const session = startBackgroundReview(toolbarConfig.project!);
                if (session) openToolbar('review', session);
            }).catch(() => { /* Review links remain available if background sign-in is blocked. */ });
        });
    }
}
