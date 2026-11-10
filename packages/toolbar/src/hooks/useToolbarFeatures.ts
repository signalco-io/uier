import { useProjectViewer } from '../project/ProjectGate';
import { toolbarFeatures } from '../toolbarFeatures';

/** Older servers and the standalone showcase keep all tools. Project gates supply the effective list. */
export function useToolbarFeatures() {
    return useProjectViewer().toolbarFeatures ?? toolbarFeatures;
}
