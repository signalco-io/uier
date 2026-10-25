import { toolbarConfig } from '../config';
import { apiRequest, CommentsApiError } from '../hooks/api';
import { reviewVerification } from './verification';

type Report = { stage: 'loaded' | 'api' | 'ready' | 'failed'; code?: string };
const param = 'uier-check';
let nonce: string | undefined;
let latest: Report = { stage: 'loaded' };
let started = false;
let receiver: { window: Window; origin: string } | undefined;

function send(target: Window, origin: string, report: Report) {
    target.postMessage({ type: 'uier:installation', nonce, project: toolbarConfig.project ?? null,
        apiOrigin: new URL(toolbarConfig.apiUrl).origin, ...report }, origin);
}

function report(next: Report) {
    if (!nonce || latest.stage === 'ready') return;
    // Browser CSP events can arrive after fetch rejects. Prefer that concrete evidence over a generic failure.
    if (latest.stage === 'failed' && !(next.stage === 'failed' && next.code?.startsWith('csp_') && !latest.code?.startsWith('csp_'))) return;
    latest = next;
    if (receiver) send(receiver.window, receiver.origin, latest);
}

/** Only explicit checks emit public diagnostics. Tokens, reviewer identity and page URLs never leave the page. */
export function startInstallationCheck() {
    const url = new URL(location.href);
    const value = url.searchParams.get(param);
    if (value === null) return;
    url.searchParams.delete(param);
    history.replaceState(history.state, '', url);
    if (!/^[a-f0-9-]{36}$/.test(value)) return;
    nonce = value;
    const apiOrigin = new URL(toolbarConfig.apiUrl).origin;
    const receive = (event: MessageEvent) => {
        if (event.data?.type !== 'uier:installation-ping' || event.data.nonce !== nonce || !event.source || !/^https?:\/\//.test(event.origin)) return;
        // The loaded report contains only public script configuration, allowing a mismatched API to be diagnosed.
        send(event.source as Window, event.origin, { stage: 'loaded' });
        if (event.origin !== apiOrigin) return;
        receiver = { window: event.source as Window, origin: event.origin };
        send(receiver.window, receiver.origin, latest);
    };
    const blocked = (event: SecurityPolicyViolationEvent) => {
        let relevant = false;
        try { relevant = new URL(event.blockedURI).origin === apiOrigin; } catch { /* Non-URL CSP sources. */ }
        if (!relevant || event.disposition !== 'enforce') return;
        const directive = event.effectiveDirective.split('-')[0];
        if (directive === 'connect' || directive === 'frame' || directive === 'script')
            report({ stage: 'failed', code: `csp_${directive}` });
    };
    window.addEventListener('message', receive);
    document.addEventListener('securitypolicyviolation', blocked);
    window.setTimeout(() => {
        window.removeEventListener('message', receive);
        document.removeEventListener('securitypolicyviolation', blocked);
        receiver = undefined;
        nonce = undefined;
    }, 35_000);
}

/** Called after the project gate commits the toolbar UI. Does not create a test comment. */
export async function checkInstallationReady(info?: { canComment: boolean; project: { access: string } }, error?: unknown) {
    if (!nonce || started || latest.stage === 'failed') return;
    if (error) {
        if (error instanceof CommentsApiError && error.code === 'bot_detected') report({ stage: 'failed', code: 'verification_failed' });
        else window.setTimeout(() => report({ stage: 'failed', code: 'api_unreachable' }), 100);
        return;
    }
    if (!info) return;
    started = true;
    report({ stage: 'api' });
    if (!info.canComment) {
        report({ stage: 'failed', code: info.project.access === 'disabled' ? 'comments_disabled' : 'sign_in_required' });
        return;
    }
    try {
        await apiRequest(`${toolbarConfig.apiUrl}/api/review/${toolbarConfig.project}/comments?path=${encodeURIComponent(location.pathname)}`);
    } catch { report({ stage: 'failed', code: 'api_unreachable' }); return; }
    try {
        await reviewVerification();
        report({ stage: 'ready' });
    } catch { report({ stage: 'failed', code: 'verification_failed' }); }
}
