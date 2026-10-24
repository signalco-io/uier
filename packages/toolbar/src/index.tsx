import { createRoot } from 'react-dom/client';
import { GEIST_FONTS_URL } from '@uier/brand';
import './index.css';
import { CommentsBootstrapper } from './components/CommentsBootstrapper';

const reviewParamKey = 'review';

/**
 * Loads Geist into the reviewed page so the toolbar can use it (BRAND.md, "Typography").
 * `@font-face` rules inside a shadow root are not applied reliably, so the stylesheet goes into
 * the host document instead. If the host's CSP blocks it the toolbar falls back to system-ui.
 */
function ensureBrandFont() {
    try {
        if (document.querySelector(`link[href="${GEIST_FONTS_URL}"]`)) {
            return;
        }
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = GEIST_FONTS_URL;
        document.head.appendChild(link);
    } catch (error) {
        console.debug('uier-toolbar: Could not load the brand font', error);
    }
}

function MountOnPage() {
    // Create root container and attach shadow DOM
    const container = document.createElement('div');
    container.setAttribute('id', 'uier-toolbar');
    const shadowRoot = container.attachShadow({ mode: 'closed' });

    // Create style element in shadow dom
    const style = document.createElement('style');
    style.innerHTML = '__uier_toolbar_css__/*\"\"*/';
    shadowRoot.appendChild(style);

    // Create inner container (in shadow DOM)
    const shadowDomContainer = document.createElement('main');
    shadowDomContainer.style.fontFamily = 'Geist, system-ui, -apple-system, "Segoe UI", sans-serif';
    shadowRoot.appendChild(shadowDomContainer);

    // Threads follow the system theme (the toolbar and pins are always ink): toggle the UI kit's `dark` class
    const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');
    const applyScheme = () => shadowDomContainer.classList.toggle('dark', darkScheme.matches);
    applyScheme();
    darkScheme.addEventListener('change', applyScheme);

    // Inject root container into body
    ensureBrandFont();
    document.body.appendChild(container);

    // Run React
    const root = createRoot(shadowDomContainer);
    root.render(<CommentsBootstrapper
        rootElement={shadowDomContainer}
        reviewParamKey={reviewParamKey} />);
}

console.debug('uier-toolbar: Checking review param...')
const urlInReview = new URL(window.location.href).searchParams.get(reviewParamKey) === 'true';
if (urlInReview) {
    console.debug('uier-toolbar: In review, mounting...');
    MountOnPage();
}
