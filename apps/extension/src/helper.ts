import { MARK_PATH, MARK_VIEWBOX } from '@uier/brand';
import { apiOrigin, message } from './environment';
import { followSystemTheme } from './theme';

followSystemTheme();
const nonce = location.hash.slice(1);
const root = document.getElementById('root')!;
const svg = (viewBox: string, content: string, className: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" class="${className}" aria-hidden="true">${content}</svg>`;
const icons = {
    // Lucide loader-circle and circle-check / circle-alert at the brand's 1.75 stroke
    working: svg('0 0 24 24', '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>', 'size-4 shrink-0 animate-spin fill-none stroke-current [stroke-linecap:round] [stroke-width:1.75]'),
    done: svg('0 0 24 24', '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>', 'size-4 shrink-0 fill-none stroke-[hsl(var(--brand-success))] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.75]'),
    failed: svg('0 0 24 24', '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>', 'size-4 shrink-0 fill-none stroke-[hsl(var(--brand-warning))] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.75]')
};
// Static markup only: every dynamic string below is set as text.
root.innerHTML = `<main class="relative flex min-h-screen flex-col justify-center gap-4 bg-background px-6 py-5 text-foreground">
    <div class="flex items-center gap-3">
        <div class="flex size-10 shrink-0 items-center justify-center rounded-xl border">${svg(MARK_VIEWBOX, `<path fill="currentColor" d="${MARK_PATH}"/>`, 'size-4')}</div>
        <div class="flex min-w-0 flex-col">
            <h1 class="m-0 text-base leading-6 font-semibold tracking-[-0.01em]">Verifying your browser</h1>
            <p class="m-0 text-sm text-muted-foreground">uier checks it before saving your comments.</p>
        </div>
    </div>
    <p class="m-0 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm" role="status"><span data-icon></span><span data-text></span></p>
    <p class="m-0 text-xs text-muted-foreground">This window closes by itself.</p>
</main>`;
const icon = root.querySelector<HTMLElement>('[data-icon]')!;
const text = root.querySelector<HTMLElement>('[data-text]')!;
const show = (value: string, tone: keyof typeof icons = 'working') => {
    icon.innerHTML = icons[tone];
    text.textContent = value;
};

// The uier-origin frame runs the bot check and has nothing to show. It keeps the window's full size
// and stays in the viewport (so the browser runs it like any visible frame), under the status card.
const frame = document.createElement('iframe');
frame.title = 'uier browser verification';
frame.src = `${apiOrigin}/extension-verification`;
frame.tabIndex = -1;
frame.setAttribute('aria-hidden', 'true');
frame.className = 'pointer-events-none fixed inset-0 -z-10 size-full border-0';
let job: { token: string } | undefined;
let sent = false;
show('Starting the check.');
const ready = message<{ token: string }>({ type: 'helper-job', nonce }).then(result => { job = result; if (job) show('Connected to verification.'); else show('Verification request expired.', 'failed'); }).catch(error => { show(error.message, 'failed'); });
window.addEventListener('message', event => {
    if (event.source !== frame.contentWindow || event.origin !== apiOrigin) return;
    if (event.data?.type === 'uier:extension-verification-ready') {
        void ready.then(() => {
            if (sent || !job) return;
            sent = true; show('Checking your browser.');
            frame.contentWindow?.postMessage({ type: 'uier:extension-verify', id: nonce, token: job.token }, apiOrigin);
        });
    }
    if (event.data?.type === 'uier:extension-verified' && event.data.id === nonce) {
        if (event.data.result) show('Verification complete.', 'done');
        else show('Browser verification was not confirmed.', 'failed');
        void message({ type: 'verified', nonce, proof: event.data.result });
    }
});
document.body.append(frame);
