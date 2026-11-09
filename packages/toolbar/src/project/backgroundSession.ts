import { runtimeAdapters } from '../adapters';
import { toolbarConfig } from '../config';
import { runtimeContext } from '../runtimeContext';
import { backgroundSignInDisabled, getReviewToken, setReviewToken } from './projectSession';

/** Bounded silent checks, deduplicated per page and on foreground identity refreshes. */
export function backgroundSignIn(): Promise<boolean> {
    if (runtimeAdapters()) return Promise.resolve(false);
    if (!toolbarConfig.project || backgroundSignInDisabled()) return Promise.resolve(false);
    return runtimeContext.signIn ??= new Promise<boolean>(resolve => {
        const origin = new URL(toolbarConfig.apiUrl).origin;
        const id = crypto.randomUUID();
        const frame = document.createElement('iframe');
        frame.src = `${origin}/review-session`;
        frame.title = 'uier background sign-in';
        frame.hidden = true;
        let finished = false;
        const finish = (token?: string, activeAccount = false) => {
            if (finished) return;
            finished = true;
            clearTimeout(timeout);
            window.removeEventListener('message', receive);
            frame.remove();
            if ((token || activeAccount) && !backgroundSignInDisabled()) setReviewToken(token);
            resolve(Boolean(getReviewToken() && !backgroundSignInDisabled()));
        };
        const receive = (event: MessageEvent) => {
            if (event.origin !== origin || event.source !== frame.contentWindow) return;
            if (event.data?.type === 'uier:session-ready') {
                frame.contentWindow?.postMessage({ type: 'uier:session', id, project: toolbarConfig.project }, origin);
            } else if (event.data?.type === 'uier:session-result' && event.data.id === id) {
                const token = event.data.token;
                finish(typeof token === 'string' && token.length <= 2048 && /^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(token) ? token : undefined, event.data.account === true);
            }
        };
        const timeout = window.setTimeout(() => finish(), 3000);
        frame.addEventListener('error', () => finish(), { once: true });
        window.addEventListener('message', receive);
        document.body.appendChild(frame);
    }).catch(() => false);
}

/** Only the loaded review UI needs foreground refreshes; keep this helper out of the bootstrap. */
export async function refreshBackgroundSignIn() {
    await runtimeContext.signIn;
    runtimeContext.signIn = undefined;
    return backgroundSignIn();
}
