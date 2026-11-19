import { proofApiPath, proofViewerPath } from './model';

export type StagingDesignReference = {
    pairingId: string;
    assetId: string;
    versionId: string;
    surfaceId: string;
};

export type StagingPairing = StagingDesignReference & {
    url: string;
    width: number;
    height: number;
};

export const stagingApiPath = (projectId: string) => `${proofApiPath(projectId)}/staging`;
export const stagingDesignPath = (projectId: string, commentId: string) =>
    `${stagingApiPath(projectId)}/thread/${encodeURIComponent(commentId)}`;

export function stagingSurfacePath(projectId: string, design: StagingDesignReference) {
    return `${proofViewerPath(projectId, design.assetId, design.versionId)}&${new URLSearchParams({ surface: design.surfaceId })}`;
}
