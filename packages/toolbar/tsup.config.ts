import { readFileSync, writeFileSync } from 'fs';
import { defineConfig } from 'tsup';

export default defineConfig(({ env }) => [{
    entry: ['./src/index.tsx'],
    // The bundle is embedded with a classic <script> tag (it reads `document.currentScript`,
    // see src/config.ts), so it is wrapped in an IIFE to keep its variables out of the page's
    // global scope. Keep the `dist/index.js` file name (tsup names IIFE output `*.global.js`).
    format: ['iife'],
    outExtension: () => ({ js: '.js' }),
    // The bundle runs in the reviewed page, not in Node
    platform: 'browser',
    define: {
        // Bundled `next/link` (via @signalco/ui-primitives) reads `process.env.__NEXT_*` at load time,
        // which throws "process is not defined" outside of Next.js. NODE_ENV is still set by `--env`.
        'process.env': '{}',
        // Comments API used by src/hooks/useComments.tsx when it can not be derived from the
        // toolbar script URL (src/config.ts). The dev build (`pnpm dev`, served from localhost:4005
        // into the local web app) calls that app's API on localhost:4004 ('self' in its CSP);
        // production builds fall back to uier.io.
        __UIER_API_URL__: JSON.stringify(env?.NODE_ENV === 'development' ? 'http://localhost:4004' : 'https://uier.io'),
        __UIER_DEV__: JSON.stringify(env?.NODE_ENV === 'development'),
    },
    onSuccess: async () => {
        // Read dist/index.css and inject content into dist/index.js where templated __uier_toolbar_css__ is
        // Make sure we can inject css into js as string
        const css = readFileSync('./dist/index.css', 'utf8').replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/\r?\n|\r/g, '\\n');
        const js = readFileSync('./dist/index.js').toString();
        if (!js.includes('__uier_toolbar_css__')) {
            throw new Error('CSS placeholder __uier_toolbar_css__ not found in dist/index.js');
        }
        // Function replacer so `$` sequences in CSS are not treated as replacement patterns
        const injected = js.replace(/__uier_toolbar_css__/g, () => css);
        writeFileSync('./dist/index.js', injected);
    }
}, {
    // `@uier/toolbar/react` (src/react.ts): the React component that adds the script above to a page.
    // An ES module for bundlers; React comes from the site.
    entry: { react: './src/react.ts' },
    format: ['esm'],
    outExtension: () => ({ js: '.js' }),
    platform: 'browser',
    external: ['react'],
    // A client component in React Server Components apps (Next.js App Router)
    banner: { js: '\'use client\';' }
}, {
    // Pure browser/server page identity contract; no React client boundary.
    entry: { pageState: './src/pageState.ts', screenshotPolicy: './src/screenshotPolicy.ts', mentions: './src/mentions.ts' },
    format: ['esm'],
    platform: 'neutral'
}]);
