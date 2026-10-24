import { readFileSync, writeFileSync } from 'fs';
import { defineConfig } from 'tsup';

export default defineConfig(({ env }) => ({
    entry: ['./src/index.tsx'],
    format: ['esm'],
    // The bundle runs in the reviewed page (classic or module script), not in Node
    platform: 'browser',
    define: {
        // Bundled `next/link` (via @signalco/ui-primitives) reads `process.env.__NEXT_*` at load time,
        // which throws "process is not defined" outside of Next.js. NODE_ENV is still set by `--env`.
        'process.env': '{}',
        // Comments API used by src/hooks/useComments.tsx. The dev build (`pnpm dev`, served from
        // localhost:4005 into the local web app) calls that app's API on localhost:4004 ('self' in
        // its CSP); production builds call uier.io.
        __UIER_API_URL__: JSON.stringify(env?.NODE_ENV === 'development' ? 'http://localhost:4004' : 'https://uier.io'),
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
}));
