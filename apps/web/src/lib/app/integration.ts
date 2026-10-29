// How a site embeds the toolbar for a project. The install page, the project settings and the
// e2e tests (e2e/review.spec.ts) use the same snippets, so the instructions match the integration.
import toolbarBundle from '@uier/toolbar/bundle' with { type: 'json' };

export type EmbedVersion = 'latest' | 'pinned';

function scriptAttributes(baseUrl: string, version: EmbedVersion) {
    return version === 'pinned'
        ? `src="${baseUrl}${toolbarBundle.path}" integrity="${toolbarBundle.integrity}" crossorigin="anonymous"`
        : `src="${baseUrl}/toolbar.js"`;
}

/** The script tag for a project: loads the toolbar from uier (or the deployment `baseUrl`) */
export function embedScript(baseUrl: string, publicId: string, version: EmbedVersion = 'latest') {
    return `<script ${scriptAttributes(baseUrl, version)} data-uier-project="${publicId}" defer></script>`;
}

/** Next.js (App Router): the same tag through next/script in the root layout */
export function nextJsSnippet(baseUrl: string, publicId: string, version: EmbedVersion = 'latest') {
    return [
        '// app/layout.tsx',
        'import Script from \'next/script\';',
        '',
        '// Inside <body>, after {children}:',
        `<Script ${scriptAttributes(baseUrl, version).replace('crossorigin=', 'crossOrigin=')} data-uier-project="${publicId}" strategy="afterInteractive" />`
    ].join('\n');
}

/**
 * Content-Security-Policy sources the toolbar needs on a site that sends a CSP: the script and the
 * API from uier, the pin cursor of point
 * mode (an inline SVG image) and the Geist web font. e2e/review.spec.ts runs the toolbar on a site
 * with exactly these sources and fails on any CSP violation.
 */
export function cspSources(baseUrl: string) {
    const origin = new URL(baseUrl).origin;
    return [
        { directive: 'script-src', sources: [origin] },
        { directive: 'connect-src', sources: [origin] },
        { directive: 'frame-src', sources: [origin] },
        { directive: 'style-src', sources: ['https://fonts.googleapis.com'] },
        { directive: 'img-src', sources: ['data:'] },
        { directive: 'font-src', sources: ['https://fonts.gstatic.com'] }
    ];
}

/** The sources as lines to add to the matching CSP directives */
export function cspSnippet(baseUrl: string) {
    return cspSources(baseUrl).map(({ directive, sources }) => `${directive} ${sources.join(' ')}`).join('\n');
}
