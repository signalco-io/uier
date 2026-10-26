/**
 * A decorative part of the page (an animation, an illustration) that the site marks with
 * `data-uier-decorative`: screenshots keep its box but leave its content out, and changes inside it
 * do not make the toolbar measure the page again. Its size must not depend on those changes.
 */
export const decorativeAttribute = 'data-uier-decorative';

const decorativeSelector = `[${decorativeAttribute}]`;

/** Whether `node` is a decorative element or inside one */
export function isInDecorative(node: Node | null) {
    const element = node instanceof Element ? node : node?.parentElement;
    return Boolean(element?.closest(decorativeSelector));
}
