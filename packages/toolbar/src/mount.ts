// Named page elements cannot create a symbol property. Share the actual host across repeated
// script loads, and across helpers that must not mistake a page's own #uier-toolbar for ours.
export const toolbarMountKey = Symbol.for('uier.toolbar.host');
export const toolbarMounts = window as unknown as { [key: symbol]: HTMLElement | undefined };

export function getToolbarHost() {
    const host = toolbarMounts[toolbarMountKey];
    return host?.isConnected ? host : undefined;
}
