/**
 * uier brand constants.
 *
 * Hex values here mirror tokens.css and exist for places that cannot read CSS variables:
 * metadata, the web manifest, generated images (OG, icons), emails and documentation.
 * The rules behind them are in BRAND.md.
 */

/** The site; a constant of its own so a bundle that only links to uier.io (the toolbar) skips the rest */
export const BRAND_URL = 'https://uier.io';

export const brand = {
    /** Always lowercase, even at the start of a sentence. Read "you-eye-er". */
    name: 'uier',
    domain: 'uier.io',
    url: BRAND_URL,
    tagline: 'Say it on the page.',
    description: 'Review any live website by leaving comments directly on it. Every comment stays pinned to the element it is about, with the browser and viewport it was left from.',
    shortDescription: 'Review any live website by leaving comments directly on it.',
    pronunciation: 'you-eye-er',
    /** The pricing promise, word for word wherever pricing comes up (landing page, terms) */
    pricing: 'Every feature available today is free and will stay free forever. If we introduce pricing, it will apply only to new features users want.',
    /** Sibling of signalco.io; the UI kit and the minimal theme come from there. */
    parent: { name: 'signalco', url: 'https://signalco.io' },
    repository: 'https://github.com/signalco-io/uier',
    issues: 'https://github.com/signalco-io/uier/issues',
    /** uier has no mailboxes of its own: these are signalco's (listed on signalco.io/contact). */
    contact: {
        email: 'contact@signalco.io',
        security: 'security@signalco.io',
        privacy: 'gdpr@signalco.io'
    },
    /** Public profiles. uier has no social accounts of its own; X is signalco's. */
    social: {
        github: 'https://github.com/signalco-io/uier',
        x: 'https://x.com/signalco_io'
    },
    colors: {
        paper: '#FFFFFF',
        ink: '#0A0A0A',
        black: '#000000',
        ink700: '#404040',
        ink500: '#707070',
        ink300: '#D4D4D4',
        ink200: '#E5E5E5',
        ink100: '#F5F5F5',
        ink50: '#FAFAFA',
        darkElevated: '#171717',
        darkBorder: '#262626',
        darkMuted: '#A3A3A3',
        darkText: '#EDEDED',
        accent: '#2E5BFF',
        accentOnDark: '#7A9BFF',
        success: '#15803D',
        warning: '#B45309',
        destructive: '#DC2626'
    },
    fonts: {
        sans: 'Geist',
        mono: 'Geist Mono'
    },
    /** Corner radii in px. "full" is 999px. */
    radius: {
        tag: 4,
        smallControl: 6,
        control: 8,
        largeControl: 10,
        card: 12,
        panel: 16,
        frame: 24
    },
    /** Values for the web manifest and the browser UI colour. */
    themeColor: {
        light: '#FFFFFF',
        dark: '#000000'
    }
} as const;

/** The mark on a 24-unit grid: three corners at full radius, the top-left one left sharp. */
export const MARK_VIEWBOX = '0 0 24 24';
export const MARK_PATH = 'M0 0h12a12 12 0 0 1 12 12a12 12 0 0 1-12 12a12 12 0 0 1-12-12z';

/** The same shape as the product pin on a 32-unit grid, inset by 1 so a 2px ring fits inside the box. */
export const PIN_VIEWBOX = '0 0 32 32';
export const PIN_PATH = 'M31 16c0 8.284-6.716 15-15 15-8.284 0-15-6.716-15-15V1h15c8.284 0 15 6.716 15 15Z';

/** The Google Fonts stylesheet for Geist and Geist Mono, used where next/font is not available (the toolbar). */
export const GEIST_FONTS_PATH = '/toolbar-fonts/geist.css';
