/**
 * The build side of keeping the reviewed page's styles out of the toolbar's shadow root (docs/host-styles.md),
 * shared by postcss.config.mjs, tsup.config.ts and the browser extension's build (packages/extension/scripts/build.mjs).
 */
import { readFile } from 'node:fs/promises';

/** A length in `rem` in a declaration's value (`.25rem`, `-1.5rem`, `calc(100vw - 2rem)`) */
const remLength = /(^|[^\w.-])(-?(?:\d+\.?\d*|\.\d+))rem\b/g;

/**
 * PostCSS, after Tailwind:
 * - `rem` in a shadow tree is the page's root font size, so every `rem` in a declaration becomes
 *   `--uier-rem`, the person's default font size on `[data-uier-root]` (src/styles/toolbar-theme.css). Media
 *   queries keep `rem`: there it already is the browser's default size, not the page's. The fallback keeps
 *   `rem` for the CSS outside a toolbar root.
 * - A page's rules can set custom properties on the host element (`* { --radius: 0 }`), which win over
 *   the theme's `:host` rules (Tailwind's and the brand tokens'). Those rules apply to `[data-uier-root]` too.
 * - A custom property the toolbar reads without declaring it anywhere would inherit the page's value
 *   (`--width`, `--s-gap`): `[data-uier-root]` sets each one to `initial`, as on a page without it. Not
 *   `--font-geist-sans`, uier.io's own Geist (src/styles/toolbar-theme.css).
 */
export function shadowRootIsolation() {
    return {
        postcssPlugin: 'uier-shadow-root-isolation',
        /** @param {import('postcss').Root} root */
        OnceExit(root) {
            const declared = new Set();
            const read = new Set();
            root.walkDecls((decl) => {
                if (decl.prop.startsWith('--')) declared.add(decl.prop);
                for (const [, name] of decl.value.matchAll(/var\(\s*(--[\w-]+)/g)) read.add(name);
                decl.value = decl.value.replace(remLength, (_, before, value) => `${before}calc(${value} * var(--uier-rem, 1rem))`);
            });
            root.walkRules((rule) => {
                if (rule.selectors.includes(':host')) rule.selectors = [...rule.selectors, '[data-uier-root]'];
            });
            const fromPage = [...read].filter(name => !declared.has(name) && name !== '--font-geist-sans').sort();
            if (fromPage.length) {
                root.append({ selector: '[data-uier-root]', nodes: fromPage.map(prop => ({ prop, value: 'initial' })) });
            }
        },
    };
}
shadowRootIsolation.postcss = true;

/** A template literal that ends a length in `rem`: `${(spacing ?? 0) * .5}rem` */
const inlineRem = /`\$\{([^`{}]+)\}rem`/g;

/**
 * esbuild: the UI kit also writes `rem` into inline styles (`Row` and `Stack` set `--s-gap` to
 * `${spacing / 2}rem`), which no stylesheet can change. This gives them `--uier-rem` too.
 * @type {import('esbuild').Plugin}
 */
export const uiKitInlineRem = {
    name: 'uier-ui-kit-inline-rem',
    setup(build) {
        build.onLoad({ filter: /[\\/]@signalco[\\/]ui[^\\/]*[\\/]dist[\\/].*\.js$/ }, async ({ path }) => {
            const source = await readFile(path, 'utf8');
            const contents = source.replace(inlineRem, (_, value) => `\`calc(\${${value}} * var(--uier-rem, 1rem))\``);
            return contents === source ? undefined : { contents, loader: 'js' };
        });
    }
};

/**
 * Fails the build when a bundle still writes a length in `rem` into an inline style (a new UI kit
 * component, or the toolbar's own code): check it before the CSS is inlined.
 * @param {string} js
 * @param {string} file
 */
export function assertNoInlineRem(js, file) {
    const found = /(?:\d|\})rem[`'"]/.exec(js);
    if (found) throw new Error(`${file} writes a length in rem (${js.slice(Math.max(0, found.index - 60), found.index + 6)}): use --uier-rem, packages/toolbar/docs/host-styles.md`);
}
