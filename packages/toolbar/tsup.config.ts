import { readFileSync, writeFileSync } from 'fs';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { fileURLToPath } from 'node:url';
import browserslist from 'browserslist';
import { defineConfig } from 'tsup';
import { toolbarLanguages } from './src/languages';

// Share the rolling browser policy with Next.js. A Safari/iOS version can be a range;
// esbuild needs its earliest version, and calls Browserslist's ios_saf engine "ios".
const browserTargets = [...new Set(browserslist(undefined, { path: fileURLToPath(new URL('../../', import.meta.url)) }).map(browser => {
    const [engine, versions] = browser.split(' ');
    return `${engine === 'ios_saf' ? 'ios' : engine}${versions!.split('-')[0]}`;
}))];

/**
 * esbuild ends a bundle with every bundled file's license comment, and the UI kit's bundles repeat
 * lucide-react's notice for each of their icons (over 40 KB of the review bundle). Keeps each distinct
 * notice once in each file's comment, with the first file that has it; the code is unchanged.
 */
function withDistinctLicenses(js: string) {
    const start = js.lastIndexOf('/*! Bundled license information:');
    if (start < 0) return js;
    // One part for each bundled file (a line without indentation), its notices within it
    const licenses = js.slice(start).split(/(?=^\S[^\n]*:\n)/m).map(part => {
        const seen = new Set<string>();
        // An entry: the file, then its comment (`(** … *)`, indented two more), then a blank line
        return part.replace(/^( *)\S[^\n]*:\n\1  \(\*\*\n[\s\S]*?\n\1   \*\)\n(?:\1\n)?/gm, (entry, indent: string) => {
            const notice = entry.slice(entry.indexOf('\n') + 1).split('\n').map(line => line.slice(indent.length)).join('\n').trim();
            if (seen.has(notice)) return '';
            seen.add(notice);
            return entry;
        });
    }).join('');
    return js.slice(0, start) + licenses;
}

// The toolbar's languages but English (src/languages.ts), each built to `language-<code>.js`
const languageEntries = Object.fromEntries(toolbarLanguages.filter(code => code !== 'en').map(code => [`language-${code}`, `./src/i18n/assets/${code}.ts`]));

export default defineConfig(({ env }) => {
    // The watch build (`pnpm dev`) writes to dist-dev/, never to the production output in dist/:
    // `pnpm typecheck`, `build` and `test` build (or restore from cache) dist/ in the same checkout
    // while `pnpm dev` runs. `next dev` reads dist-dev/ through the `development` export condition
    // (package.json); production builds, the extension and Node read dist/.
    const development = env?.NODE_ENV === 'development';
    const outDir = development ? 'dist-dev' : 'dist';
    return [{
        // `audit` is axe-core for the Accessibility panel: a separate asset the review bundle loads only
        // when the panel runs a check (src/checks/axeLoader.ts), never part of its first load.
        // Each language but English is its own asset too (src/i18n/languageHandoff.ts), loaded only when the
        // toolbar shows that language.
        entry: { index: './src/index.ts', review: './src/runtime.tsx', audit: './src/checks/auditEntry.ts', ...languageEntries },
        outDir,
        // The bundle is embedded with a classic <script> tag (it reads `document.currentScript`,
        // see src/config.ts), so it is wrapped in an IIFE to keep its variables out of the page's
        // global scope. Keep the `dist/index.js` file name (tsup names IIFE output `*.global.js`).
        format: ['iife'],
        outExtension: () => ({ js: '.js' }),
        // The bundle runs in the reviewed page, not in Node
        platform: 'browser',
        target: browserTargets,
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
            // toolbar script URL (src/config.ts). The dev build (`pnpm dev`, served on the port after the
            // web app's into the local web app) calls that app's API on PORT, default 4004 ('self' in its
            // CSP); production builds fall back to uier.io.
            __UIER_API_URL__: JSON.stringify(development ? `http://localhost:${process.env.PORT || 4004}` : 'https://uier.io'),
            __UIER_DEV__: JSON.stringify(development),
            __UIER_REVIEW_PATH__: JSON.stringify('__uier_review_path__'),
            __UIER_REVIEW_INTEGRITY__: JSON.stringify('__uier_review_integrity__'),
            __UIER_AUDIT_PATH__: JSON.stringify('__uier_audit_path__'),
            __UIER_AUDIT_INTEGRITY__: JSON.stringify('__uier_audit_integrity__'),
            __UIER_LANGUAGE_ASSETS__: JSON.stringify('__uier_language_assets__'),
        },
        onSuccess: async () => {
            // Replace the entire literal: esbuild may choose either quote style while minifying.
            const css = readFileSync(`./${outDir}/review.css`, 'utf8');
            // The audit asset's final bytes give the path and SRI the review bundle loads it with.
            const audit = readFileSync(`./${outDir}/audit.js`);
            new Script(audit.toString());
            const auditHash = createHash('sha256').update(audit).digest('hex');
            const auditIntegrity = `sha384-${createHash('sha384').update(audit).digest('base64')}`;
            // Likewise each language asset: its path and SRI, as an object literal in place of the placeholder.
            const languageAssets = Object.fromEntries(Object.keys(languageEntries).map(name => {
                const asset = readFileSync(`./${outDir}/${name}.js`);
                new Script(asset.toString());
                const assetHash = createHash('sha256').update(asset).digest('hex');
                return [name.slice('language-'.length), {
                    path: development ? `./${name}.js` : `/toolbar/${assetHash}.js`,
                    integrity: development ? '' : `sha384-${createHash('sha384').update(asset).digest('base64')}`
                }];
            }));
            const js = withDistinctLicenses(readFileSync(`./${outDir}/review.js`).toString())
                .replace(/(["'])__uier_audit_path__\1/g, () => JSON.stringify(development ? './audit.js' : `/toolbar/${auditHash}.js`))
                .replace(/(["'])__uier_audit_integrity__\1/g, () => JSON.stringify(development ? '' : auditIntegrity))
                .replace(/(["'])__uier_language_assets__\1/g, () => `(${JSON.stringify(languageAssets)})`);
            if (!js.includes('__uier_toolbar_css__')) {
                throw new Error(`CSS placeholder __uier_toolbar_css__ not found in ${outDir}/review.js`);
            }
            if (js.includes('__uier_audit_')) throw new Error('Audit placeholder is not a JavaScript string literal');
            if (js.includes('__uier_language_assets__') || !js.includes(JSON.stringify(languageAssets))) throw new Error('Language placeholder is not a JavaScript string literal');
            // Function replacer so `$` sequences in CSS are not treated as replacement patterns
            const injected = js.replace(/(["'])__uier_toolbar_css__\1/g, () => JSON.stringify(css));
            if (injected === js) throw new Error('CSS placeholder is not a JavaScript string literal');
            new Script(injected); // Parse the final bytes, including CSS, before publishing them.
            writeFileSync(`./${outDir}/review.js`, injected);
            // Keep the existing CSS export for workspace consumers.
            writeFileSync(`./${outDir}/index.css`, css);
            const reviewHash = createHash('sha256').update(injected).digest('hex');
            const reviewIntegrity = `sha384-${createHash('sha384').update(injected).digest('base64')}`;
            const loader = readFileSync(`./${outDir}/index.js`, 'utf8')
                .replace(/(["'])__uier_review_path__\1/g, () => JSON.stringify(development ? './review.js' : `/toolbar/${reviewHash}.js`))
                .replace(/(["'])__uier_review_integrity__\1/g, () => JSON.stringify(development ? '' : reviewIntegrity));
            new Script(loader);
            writeFileSync(`./${outDir}/index.js`, loader);
            const hash = createHash('sha256').update(loader).digest('hex');
            const integrity = `sha384-${createHash('sha384').update(loader).digest('base64')}`;
            writeFileSync(`./${outDir}/bundle.json`, JSON.stringify({ path: `/toolbar/${hash}.js`, integrity }));
        }
    }, {
        // `@uier/toolbar/react` (src/react.ts): the React component that adds the script above to a page.
        // An ES module for bundlers; React comes from the site. `@uier/toolbar/editor` is the message editor the
        // app shares with the review script; its ProseMirror packages stay imports, for the app's bundler.
        entry: { recordings: './src/recordings.ts', attachments: './src/useAttachedImage.ts', react: './src/react.ts', agentWorking: './src/useAgentWorking.ts', editor: './src/editor/index.ts' },
        outDir,
        format: ['esm'],
        outExtension: () => ({ js: '.js' }),
        platform: 'browser',
        target: browserTargets,
        external: ['react'],
        // A client component in React Server Components apps (Next.js App Router)
        banner: { js: '\'use client\';' }
    }, {
        // `@uier/toolbar/device-details`: the device details popover's content, shared with the app. No hooks, so no
        // client boundary: the app's server-rendered pages (the landing page's specimens) use its marks too.
        entry: { deviceDetails: './src/deviceDetails/index.tsx' },
        outDir,
        format: ['esm'],
        platform: 'neutral'
    }, {
        // Pure browser/server page identity contract; no React client boundary.
        entry: { toolbarFeatures: './src/toolbarFeatures.ts', languages: './src/languages.ts', feedbackTypes: './src/feedbackTypes.ts', drawing: './src/drawing.ts', realtime: './src/realtime.ts', verification: './src/verification.ts', extensionContract: './src/extensionContract.ts', triage: './src/triage.ts', reactions: './src/reactions.ts', agents: './src/agents.ts', devices: './src/devices.ts', pageState: './src/pageState.ts', pageSections: './src/pageSections.ts', screenshotPolicy: './src/screenshotPolicy.ts', mentions: './src/mentions.ts', markdown: './src/markdown.ts', colorValues: './src/colorValues.ts', draftStorage: './src/hooks/draftStorage.ts', feedbackContext: './src/feedbackContext.ts', keyboard: './src/keyboard.ts' },
        outDir,
        format: ['esm'],
        platform: 'neutral'
    }];
});
