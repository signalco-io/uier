/** Browser-safe wire types. Only the server resolves storage names and credentials. */
export const proofFormats = ['image', 'pdf', 'figma', 'video', 'email', 'html'] as const;
export type ProofFormat = (typeof proofFormats)[number];

export const MAX_PROOF_UPLOAD_BYTES = 20 * 1024 * 1024;
export const PROOF_UPLOAD_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export type ProofVersionStatus = 'pending' | 'processing' | 'published' | 'failed';
export type ProofScope = { kind: 'project' } | { kind: 'collection' | 'asset'; id: string };
export type ProofShareScope = Exclude<ProofScope, { kind: 'project' }>;
export type ProofPermissions = {
    view: boolean;
    comment: boolean;
    downloadOriginal: boolean;
    manage: boolean;
};
export type ProofActor = ProofPermissions & (
    | { kind: 'member'; userId: string; name: string; isAdmin: boolean; scope: { kind: 'project' } }
    | { kind: 'guest'; visitorId: string; shareId: string; scope: ProofShareScope }
);

export type ProofArtifact = { id: string; contentType: string; size: number; url: string };
export type ProofSurface = {
    id: string;
    label?: string;
    width?: number;
    height?: number;
    artifactId?: string;
};
export type ProofManifest = {
    format: ProofFormat;
    surfaces: ProofSurface[];
    durationMs?: number;
};
export type ProofVersion = {
    id: string;
    assetId: string;
    number: number | null;
    status: ProofVersionStatus;
    filename: string;
    contentType: string;
    size: number;
    digest?: string;
    manifest?: ProofManifest;
    artifacts: ProofArtifact[];
    originalUrl?: string;
    createdAt: string;
    publishedAt?: string;
    failure?: string;
};
export type ProofAsset = {
    id: string;
    name: string;
    collectionId: string | null;
    position: number;
    currentVersionId: string | null;
    createdAt: string;
    updatedAt: string;
};
export type ProofCollection = { id: string; name: string; position: number; createdAt: string };
export type ProofShare = {
    id: string;
    scope: ProofShareScope;
    permission: 'view' | 'comment';
    downloadOriginal: boolean;
    createdAt: string;
    expiresAt: string | null;
    revokedAt: string | null;
};

export type ProofLibrary = {
    assets: ProofAsset[];
    collections: ProofCollection[];
    permissions: ProofPermissions;
};
export type ProofAssetDetail = {
    asset: ProofAsset;
    versions: ProofVersion[];
    version: ProofVersion | null;
    permissions: ProofPermissions;
};
export type ProofUploadInput = {
    requestId: string;
    expectedVersionId: string | null;
    filename: string;
    contentType: string;
    size: number;
};
export type ProofUploadGrant = {
    version: ProofVersion;
    uploadUrl: string | null;
    headers: Record<string, string>;
    expiresAt: string;
};

export const proofApiPath = (projectId: string) => `/api/proofs/${encodeURIComponent(projectId)}`;
export const proofViewerPath = (projectId: string, assetId: string, versionId?: string) =>
    `/proof/${encodeURIComponent(projectId)}/${encodeURIComponent(assetId)}${versionId ? `?version=${encodeURIComponent(versionId)}` : ''}`;
export const proofCollectionPath = (projectId: string, collectionId: string) =>
    `/proof/${encodeURIComponent(projectId)}/collection/${encodeURIComponent(collectionId)}`;
