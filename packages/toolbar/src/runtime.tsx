import { createRoot } from 'react-dom/client';
import { GEIST_FONTS_PATH } from '@uier/brand';
import './index.css';
import { CommentsBootstrapper } from './components/CommentsBootstrapper';
import { toolbarConfig, ToolbarMode } from './config';
import { endReviewSession, type ReviewSession } from './review';
import { requestFeedbackOnMount } from './openFeedback';
import { runtimeContext } from './runtimeContext';
import { getToolbarHost, toolbarMountKey, toolbarMounts } from './mount';
import { adoptToolbarStyles } from './stylesheet';

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
        const fontUrl = `${toolbarConfig.apiUrl}${GEIST_FONTS_PATH}`;
        if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(link => (link as HTMLLinkElement).href === fontUrl)) {
            return;
        }
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = fontUrl;
        document.head.appendChild(link);
    } catch (error) {
        console.debug('uier-toolbar: Could not load the brand font', error);
    }
}

function MountOnPage(mode: ToolbarMode, review: ReviewSession | null) {
    // The script can be included more than once (or re-run by client-side navigation)
    if (getToolbarHost()) {
        console.debug('uier-toolbar: Already mounted');
        return;
    }

    // Create root container and attach shadow DOM. The shadow root is open so assistive
    // technologies, accessibility checkers and end-to-end tests can reach the toolbar UI.
    const container = document.createElement('div');
    container.setAttribute('id', containerId);
    const shadowRoot = container.attachShadow({ mode: 'open' });

    adoptToolbarStyles(shadowRoot);

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
    toolbarMounts[toolbarMountKey] = container;

    // Run React
    const root = createRoot(shadowDomContainer);

    const unmount = () => {
        darkScheme.removeEventListener('change', applyScheme);
        // After the click that asked for it has been handled
        window.setTimeout(() => {
            root.unmount();
            container.remove();
            if (toolbarMounts[toolbarMountKey] === container) delete toolbarMounts[toolbarMountKey];
        }, 0);
    };
    // "Exit review": the review ends for this tab and the toolbar leaves the page.
    // "Close toolbar" (`feedback` mode): it leaves until feedback is asked for again.
    const handleExit = mode === 'review'
        ? () => { endReviewSession(); unmount(); }
        : mode === 'feedback' ? unmount : undefined;

    root.render(<CommentsBootstrapper
        mode={mode}
        review={review}
        rootElement={shadowDomContainer}
        onExitReview={handleExit} />);
}

// The loader supplies its captured configuration and in-memory identity through this script's
// symbol property. Register a mount function so feedback can reopen without another download.
runtimeContext.mount = (mode, review) => {
    if (getToolbarHost()) return;
    if (mode === 'feedback') requestFeedbackOnMount();
    MountOnPage(mode, review);
};
