import { toolbarConfig } from '../config';
import { projectHeaders } from './projectSession';

type Verification = { token: string; expiresAt: number };
let cached: { identity: string; proof: Verification } | undefined;
let pending: { identity: string; promise: Promise<string> } | undefined;

/** Runs BotID on the API's own origin. No cookies, storage access or host-site script proxy. */
export async function reviewVerification() {
    const headers = projectHeaders();
    const identity = JSON.stringify(headers);
    if (cached?.identity === identity && cached.proof.expiresAt > Date.now() + 30_000)
        return cached.proof.token;
    if (pending?.identity === identity)
        return pending.promise;

    const promise = new Promise<string>((resolve, reject) => {
        const origin = new URL(toolbarConfig.apiUrl).origin;
        const frame = document.createElement('iframe');
        frame.src = `${origin}/review-verification`;
        frame.title = 'uier browser verification';
        frame.hidden = true;
        const id = crypto.randomUUID();
        const finish = (proof?: Verification) => {
            clearTimeout(timeout);
            window.removeEventListener('message', receive);
            frame.remove();
            if (proof) {
                cached = { identity, proof };
                resolve(proof.token);
            } else {
                reject(new Error('Browser verification failed.'));
            }
        };
        const receive = (event: MessageEvent) => {
            if (event.origin !== origin || event.source !== frame.contentWindow)
                return;
            if (event.data?.type === 'uier:verification-ready') {
                frame.contentWindow?.postMessage({
                    type: 'uier:verify', id, project: toolbarConfig.project,
                    visitor: headers['X-Uier-Visitor'], authorization: headers.Authorization
                }, origin);
            } else if (event.data?.type === 'uier:verified' && event.data.id === id) {
                const proof = event.data.result;
                finish(typeof proof?.token === 'string' && typeof proof.expiresAt === 'number' ? proof : undefined);
            }
        };
        const timeout = window.setTimeout(() => finish(), 20_000);
        window.addEventListener('message', receive);
        document.body.appendChild(frame);
    });
    pending = { identity, promise };
    try {
        return await promise;
    } finally {
        if (pending?.promise === promise)
            pending = undefined;
    }
}
