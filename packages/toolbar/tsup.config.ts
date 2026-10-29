import { readFileSync, writeFileSync } from 'fs';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
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
    esbuildOptions(options) {
        // UI-kit button links need native navigation on arbitrary reviewed sites. Keep the
        // framework router out of the embed and retain room for actionable notices in its budget.
        options.alias = { ...options.alias, 'next/link': './src/components/ToolbarLink.tsx' };
    },
    define: {
        // Dependencies must not read Node's process global on an arbitrary reviewed site.
        // NODE_ENV is still set by `--env`.
        'process.env': '{}',
        // Comments API used by src/hooks/useComments.tsx when it can not be derived from the
        // toolbar script URL (src/config.ts). The dev build (`pnpm dev`, served from localhost:4005
        // into the local web app) calls that app's API on localhost:4004 ('self' in its CSP);
        // production builds fall back to uier.io.
        __UIER_API_URL__: JSON.stringify(env?.NODE_ENV === 'development' ? 'http://localhost:4004' : 'https://uier.io'),
        __UIER_DEV__: JSON.stringify(env?.NODE_ENV === 'development'),
    },
    onSuccess: async () => {
        // Replace the entire literal: esbuild may choose either quote style while minifying.
        const css = readFileSync('./dist/index.css', 'utf8');
        const js = readFileSync('./dist/index.js').toString();
        if (!js.includes('__uier_toolbar_css__')) {
            throw new Error('CSS placeholder __uier_toolbar_css__ not found in dist/index.js');
        }
        // Function replacer so `$` sequences in CSS are not treated as replacement patterns
        const injected = js.replace(/(["'])__uier_toolbar_css__\1/g, () => JSON.stringify(css));
        if (injected === js) throw new Error('CSS placeholder is not a JavaScript string literal');
        new Script(injected); // Parse the final bytes, including CSS, before publishing them.
        writeFileSync('./dist/index.js', injected);
        const hash = createHash('sha256').update(injected).digest('hex');
        const integrity = `sha384-${createHash('sha384').update(injected).digest('base64')}`;
        writeFileSync('./dist/bundle.json', JSON.stringify({ path: `/toolbar/${hash}.js`, integrity }));
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
    entry: { pageState: './src/pageState.ts', screenshotPolicy: './src/screenshotPolicy.ts', mentions: './src/mentions.ts', feedbackContext: './src/feedbackContext.ts' },
    format: ['esm'],
    platform: 'neutral'
}]);
