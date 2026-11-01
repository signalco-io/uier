import { apiOrigin, message } from './environment';

const nonce = location.hash.slice(1);
const frame = document.createElement('iframe');
frame.title = 'uier browser verification';
frame.src = `${apiOrigin}/extension-verification`;
let job: { token: string } | undefined;
let sent = false;
const status = document.getElementById('root')!;
status.textContent = 'Verifying your browser.';
const ready = message<{ token: string }>({ type: 'helper-job', nonce }).then(result => { job = result; status.textContent = job ? 'Connected to verification.' : 'Verification request expired.'; }).catch(error => { status.textContent = error.message; });
window.addEventListener('message', event => {
    if (event.source !== frame.contentWindow || event.origin !== apiOrigin) return;
    if (event.data?.type === 'uier:extension-verification-ready') {
        void ready.then(() => {
            if (sent || !job) return;
            sent = true; status.textContent = 'Checking your browser.';
            frame.contentWindow?.postMessage({ type: 'uier:extension-verify', id: nonce, token: job.token }, apiOrigin);
        });
    }
    if (event.data?.type === 'uier:extension-verified' && event.data.id === nonce) {
        status.textContent = event.data.result ? 'Verification complete.' : 'Browser verification was not confirmed.';
        void message({ type: 'verified', nonce, proof: event.data.result });
    }
});
document.body.append(frame);
