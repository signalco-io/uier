/** Optional tools. Core feedback, the inbox and account/options controls always stay available. */
export const toolbarFeatures = ['accessibility', 'seo', 'consent', 'rewrite', 'draw'] as const;
export type ToolbarFeature = typeof toolbarFeatures[number];

/** Missing lists follow all current/future tools; an explicit (even empty) list stays customized. */
export type ToolbarFeatureVisibility = {
    enabled?: ToolbarFeature[];
    signedOut?: ToolbarFeature[];
};

export function resolveToolbarFeatures(visibility: ToolbarFeatureVisibility | undefined, isMember: boolean): ToolbarFeature[] {
    return toolbarFeatures.filter(feature =>
        (visibility?.enabled === undefined || visibility.enabled.includes(feature)) &&
        (isMember || visibility?.signedOut === undefined || visibility.signedOut.includes(feature)));
}
