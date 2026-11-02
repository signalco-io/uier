export { configureToolbarRuntime, type ToolbarAdapters } from './adapters';
// Import runtime only after configureToolbarRuntime: project modules initialize at import time.
export async function mountExtensionToolbar(onExit: () => void, isCurrent = () => true) {
    const { mountToolbar } = await import('./runtime');
    const { toolbarConfig } = await import('./config');
    if (isCurrent()) return mountToolbar('review', { projectCode: toolbarConfig.project }, onExit);
}
