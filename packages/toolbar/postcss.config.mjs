import tailwindcss from '@tailwindcss/postcss';

/**
 * Tailwind CSS v4 registers its internal variables (--tw-translate-x, --tw-shadow, ...) with
 * `@property`, which browsers ignore inside shadow roots. Tailwind also emits a fallback that
 * sets their initial values on every element, but only behind an `@supports` check that targets
 * old browsers. The toolbar is rendered inside a shadow root, so always apply that fallback
 * (this matches how Tailwind CSS v3 initialized these variables).
 */
function shadowDomPropertiesFallback() {
    return {
        postcssPlugin: 'uier-shadow-dom-properties-fallback',
        OnceExit(root) {
            root.walkAtRules('layer', (layer) => {
                if (layer.params !== 'properties') return;
                layer.walkAtRules('supports', (supports) => {
                    supports.replaceWith(supports.nodes);
                });
            });
        },
    };
}
shadowDomPropertiesFallback.postcss = true;

export default {
    plugins: [
        // Lightning CSS also merges equivalent rules before tsup inlines the stylesheet.
        tailwindcss({ optimize: { minify: true } }),
        shadowDomPropertiesFallback(),
    ],
};
