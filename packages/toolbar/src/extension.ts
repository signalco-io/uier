export { configureToolbarRuntime, type ToolbarAdapters } from './adapters';
// Import runtime only after configureToolbarRuntime: project modules initialize at import time.
export async function mountExtensionToolbar(onExit: () => void) {
    const { mountToolbar } = await import('./runtime');
    const { toolbarConfig } = await import('./config');
    return mountToolbar('review', { projectCode: toolbarConfig.project }, onExit);
}
