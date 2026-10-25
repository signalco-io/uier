import { createRoot } from 'react-dom/client';
import { GEIST_FONTS_URL } from '@uier/brand';
import './index.css';
import { CommentsBootstrapper } from './components/CommentsBootstrapper';
import { toolbarConfig, ToolbarMode } from './config';
import { endReviewSession, resolveReviewSession, ReviewSession } from './review';

const containerId = 'uier-toolbar';

/**
 * Loads Geist into the reviewed page so the toolbar can use it (BRAND.md, "Typography").
 * `@font-face` rules inside a shadow root are not applied reliably, so the stylesheet goes into
 * the host document instead. If the host's CSP blocks it the toolbar falls back to system-ui.
 * uier.io already has Geist through next/font (`--font-geist-sans`, used by toolbar-theme.css).
 */
function ensureBrandFont() {
    try {
        if (getComputedStyle(document.documentElement).getPropertyValue('--font-geist-sans').trim()) {
            return;
        }
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

function MountOnPage(mode: ToolbarMode, review: ReviewSession | null) {
    // The script can be included more than once (or re-run by client-side navigation)
    if (document.getElementById(containerId)) {
        console.debug('uier-toolbar: Already mounted');
        return;
    }

    // Create root container and attach shadow DOM. The shadow root is open so assistive
    // technologies, accessibility checkers and end-to-end tests can reach the toolbar UI.
    const container = document.createElement('div');
    container.setAttribute('id', containerId);
    const shadowRoot = container.attachShadow({ mode: 'open' });

    // Create style element in shadow dom
    const style = document.createElement('style');
    style.innerHTML = '__uier_toolbar_css__/*\"\"*/';
    shadowRoot.appendChild(style);

    // Create inner container (in shadow DOM); styles/toolbar-theme.css resets the text styles it
    // would otherwise inherit from the reviewed page
    const shadowDomContainer = document.createElement('div');
    shadowDomContainer.setAttribute('data-uier-root', '');
    shadowRoot.appendChild(shadowDomContainer);

    // Threads follow the system theme (the toolbar, pins and sidebar are always ink, see
    // components/InkScope.tsx). The UI kit's `dark:` variants match `[class="dark"]` exactly.
    const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');
    const applyScheme = () => { shadowDomContainer.className = darkScheme.matches ? 'dark' : ''; };
    applyScheme();
    darkScheme.addEventListener('change', applyScheme);

    // Inject root container into body
    ensureBrandFont();
    document.body.appendChild(container);

    // Run React
    const root = createRoot(shadowDomContainer);

    // "Exit review": the review ends for this tab and the toolbar leaves the page
    const handleExitReview = () => {
        endReviewSession();
        darkScheme.removeEventListener('change', applyScheme);
        // After the click that asked for it has been handled
        window.setTimeout(() => {
            root.unmount();
            container.remove();
        }, 0);
    };

    root.render(<CommentsBootstrapper
        mode={mode}
        review={review}
        rootElement={shadowDomContainer}
        onExitReview={mode === 'review' ? handleExitReview : undefined} />);
}

function whenBodyReady(callback: () => void) {
    if (document.body) {
        callback();
    } else {
        document.addEventListener('DOMContentLoaded', callback, { once: true });
    }
}

if (toolbarConfig.mode === 'showcase') {
    const review = resolveReviewSession();
    whenBodyReady(() => MountOnPage(review ? 'review' : 'showcase', review));
} else {
    console.debug('uier-toolbar: Checking for a review link...');
    const review = resolveReviewSession();
    if (review) {
        console.debug('uier-toolbar: In review, mounting...');
        whenBodyReady(() => MountOnPage('review', review));
    }
}
