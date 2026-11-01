import { runtimeAdapters } from './adapters';

// Public coordination only. No identity, access or project data is exchanged across worlds.
const claim = 'uier:review-layer:claim:v1';
const probe = 'uier:review-layer:probe:v1';
let extensionPresent = false;
if (typeof window !== 'undefined') {
    window.addEventListener(claim, () => { extensionPresent = true; });
    window.dispatchEvent(new Event(probe));
}
export function extensionOwnsReviewLayer() { return !runtimeAdapters() && extensionPresent; }
export function claimReviewLayer(yieldLayer: () => void) {
    const extension = Boolean(runtimeAdapters());
    const receive = () => { if (!extension) yieldLayer(); };
    const announce = () => { if (extension) window.dispatchEvent(new Event(claim)); };
    window.addEventListener(claim, receive);
    window.addEventListener(probe, announce);
    announce();
    return () => {
        window.removeEventListener(claim, receive);
        window.removeEventListener(probe, announce);
    };
}
